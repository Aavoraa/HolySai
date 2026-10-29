import type { Request } from 'express';
import { many, one, query, tx, type Queryable } from '../config/db.js';
import { Where } from '../utils/sql.js';
import { likeTerm, limitOffset, orderBy, type Pagination } from '../utils/pagination.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { audit } from './audit.service.js';
import { notifyRoles, notifyUsers } from './notification.service.js';
import { ACTIVE, guardUnique, todayKolkata } from './workforce.service.js';
import { calculatePayslip, workingDaysInMonth } from './workforce-paycalc.js';

export const STAGES = ['Draft', 'Inputs', 'Calculated', 'Under Review', 'Approved', 'Released', 'Paid'] as const;
type Stage = (typeof STAGES)[number];

const monthEndSql = `(r.pay_month + interval '1 month' - interval '1 day')::date`;

const RUN_SQL = `
  SELECT r.id, r.campus_id AS "campusId", cp.short_name AS "campusName", cp.code AS "campusCode",
         r.pay_month AS "payMonth", to_char(r.pay_month, 'FMMonth YYYY') AS "monthLabel", r.status,
         r.employee_count AS "employeeCount", r.gross_total::float AS gross, r.deductions_total::float AS deductions,
         r.overtime_total::float AS overtime, r.allowances_total::float AS allowances, r.net_total::float AS net,
         r.created_at AS "createdAt", cu.full_name AS "createdBy",
         r.calculated_by AS "calculatedById", ca.full_name AS "calculatedBy", r.calculated_at AS "calculatedAt",
         su.full_name AS "submittedBy", r.submitted_at AS "submittedAt",
         ap.full_name AS "approvedBy", r.approved_at AS "approvedAt",
         rl.full_name AS "releasedBy", r.released_at AS "releasedAt", r.paid_at AS "paidAt", r.review_note AS "reviewNote",
         (SELECT count(*) FROM payslips p WHERE p.payroll_run_id = r.id AND p.status = 'Released')::int AS "releasedSlips"
    FROM payroll_runs r
    LEFT JOIN campuses cp ON cp.id = r.campus_id
    LEFT JOIN users cu ON cu.id = r.created_by
    LEFT JOIN users ca ON ca.id = r.calculated_by
    LEFT JOIN users su ON su.id = r.submitted_by
    LEFT JOIN users ap ON ap.id = r.approved_by
    LEFT JOIN users rl ON rl.id = r.released_by`;

const RUN_SORTS: Record<string, string> = { month: 'r.pay_month', campus: 'cp.short_name', net: 'r.net_total', status: 'r.status' };

export async function listRuns(f: Pagination & { campusId?: string; status?: string }) {
  const w = new Where();
  w.addIf(f.campusId, 'r.campus_id = ?');
  w.addIf(f.status, 'r.status = ?');
  if (f.q) w.add(`to_char(r.pay_month, 'FMMonth YYYY') ILIKE ?`, likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `${RUN_SQL.replace('SELECT r.id,', 'SELECT count(*) OVER() AS total, r.id,')} ${w.sql}
      ORDER BY ${orderBy(f.sort, f.sort ? f.dir : 'desc', RUN_SORTS, 'month')}, cp.short_name
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

async function runInputs(campusId: string, payMonth: string, runId: string, db?: Queryable) {
  const p = [campusId, payMonth, runId];
  const scope = `SELECT e.id FROM employees e WHERE e.campus_id = $1 AND ${ACTIVE}`;
  const end = `($2::date + interval '1 month' - interval '1 day')::date`;
  const [attendance, leave, overtime, overtimePending, allowances, reimbursements] = await Promise.all([
    one(`SELECT count(*)::int AS marked, count(*) FILTER (WHERE status = 'Absent')::int AS absent,
                count(*) FILTER (WHERE status = 'On Leave')::int AS leave, max(attendance_date) AS "lastMarked"
           FROM staff_attendance WHERE employee_id IN (${scope}) AND attendance_date BETWEEN $2 AND ${end} AND $3::uuid IS NOT NULL`, p, db),
    one(`SELECT COALESCE(sum(days) FILTER (WHERE status = 'Approved'), 0)::float AS "approvedDays",
                count(*) FILTER (WHERE status IN ('Submitted', 'Under Review'))::int AS pending
           FROM leave_requests WHERE employee_id IN (${scope}) AND from_date <= ${end} AND to_date >= $2 AND $3::uuid IS NOT NULL`, p, db),
    one(`SELECT COALESCE(sum(hours), 0)::float AS hours, COALESCE(sum(hours * rate_per_hour), 0)::float AS value, count(*)::int AS items
           FROM overtime_entries WHERE employee_id IN (${scope})
            AND ((status = 'Approved' AND work_date <= ${end} AND (payroll_run_id IS NULL OR payroll_run_id = $3))
                 OR (status = 'Paid' AND payroll_run_id = $3))`, p, db),
    many(`SELECT 'Overtime — ' || lower(e.department) AS what, count(*)::int AS count, sum(o.hours)::float AS hours,
                 sum(o.hours * o.rate_per_hour)::float AS value
            FROM overtime_entries o JOIN employees e ON e.id = o.employee_id
           WHERE o.employee_id IN (${scope}) AND o.status IN ('Submitted', 'Under Review') AND o.work_date <= ${end} AND $3::uuid IS NOT NULL
           GROUP BY e.department ORDER BY sum(o.hours) DESC`, p, db),
    one(`SELECT COALESCE(sum(amount) FILTER (WHERE status = 'Approved'), 0)::float AS approved,
                count(*) FILTER (WHERE status = 'Submitted')::int AS pending,
                COALESCE(sum(amount) FILTER (WHERE status = 'Submitted'), 0)::float AS "pendingValue"
           FROM allowances WHERE employee_id IN (${scope}) AND $3::uuid IS NOT NULL
            AND ((frequency = 'Monthly' AND effective_month <= $2) OR (frequency = 'One-time' AND effective_month = $2))`, p, db),
    one(`SELECT COALESCE(sum(amount) FILTER (WHERE status = 'Approved' AND (paid_in_run_id IS NULL OR paid_in_run_id = $3)), 0)::float AS approved,
                count(*) FILTER (WHERE status IN ('Submitted', 'Under Review'))::int AS pending,
                COALESCE(sum(amount) FILTER (WHERE status IN ('Submitted', 'Under Review')), 0)::float AS "pendingValue"
           FROM reimbursements WHERE employee_id IN (${scope}) AND claim_date <= ${end}
            AND (status IN ('Approved', 'Submitted', 'Under Review') OR paid_in_run_id = $3)`, p, db),
  ]);
  const pendingItems = [
    ...overtimePending.map((o) => ({ what: o.what, count: o.count, value: o.value })),
    ...(allowances!.pending ? [{ what: 'Allowances awaiting approval', count: allowances!.pending, value: allowances!.pendingValue }] : []),
    ...(reimbursements!.pending ? [{ what: 'Reimbursements awaiting approval', count: reimbursements!.pending, value: reimbursements!.pendingValue }] : []),
    ...(leave!.pending ? [{ what: 'Leave requests awaiting a decision', count: leave!.pending, value: 0 }] : []),
  ];
  return {
    attendance, leave, overtime, allowances, reimbursements,
    pendingItems,
    pendingCount: pendingItems.reduce((a, x) => a + x.count, 0),
  };
}

export async function getRun(req: Request, id: string) {
  const run = await one(`${RUN_SQL} WHERE r.id = $1`, [id]);
  if (!run) throw notFound('Payroll run not found', 'PAYROLL_RUN_NOT_FOUND');
  const [byCategory, inputs] = await Promise.all([
    many(`SELECT e.category AS label, count(*)::int AS count, sum(p.gross)::float AS gross, sum(p.net)::float AS net
            FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE p.payroll_run_id = $1
           GROUP BY e.category ORDER BY sum(p.gross) DESC`, [id]),
    run.campusId ? runInputs(run.campusId, run.payMonth, id) : null,
  ]);
  const u = req.user!;
  const stage = STAGES.indexOf(run.status as Stage);
  return {
    run,
    stage,
    stages: STAGES,
    byCategory,
    inputs,
    actions: {
      canPrepare: u.permissions.has('payroll.manage') && ['Draft', 'Inputs', 'Calculated'].includes(run.status),
      canSubmit: u.permissions.has('payroll.manage') && run.status === 'Calculated',
      canApprove: u.permissions.has('approvals.decide') && run.status === 'Under Review' && run.calculatedById !== u.id,
      makerChecker: run.status === 'Under Review' && run.calculatedById === u.id,
      canReturn: u.permissions.has('approvals.decide') && ['Under Review', 'Approved'].includes(run.status),
      canRelease: (u.permissions.has('approvals.decide') || u.permissions.has('payroll.manage')) && run.status === 'Approved',
      canPay: (u.permissions.has('approvals.decide') || u.permissions.has('payroll.manage')) && run.status === 'Released',
    },
  };
}

export async function createRun(req: Request, campusId: string, payMonth: string) {
  const month = `${payMonth}-01`;
  const next = new Date(`${todayKolkata().slice(0, 7)}-01T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  if (month > next.toISOString().slice(0, 10)) throw badRequest('Runs can be opened up to one month ahead', 'MONTH_TOO_FAR');
  const campus = await one<{ short_name: string }>('SELECT short_name FROM campuses WHERE id = $1', [campusId]);
  if (!campus) throw badRequest('Campus not found', 'CAMPUS_NOT_FOUND');
  return guardUnique(async () => {
    const r = await one<{ id: string }>(
      `INSERT INTO payroll_runs (campus_id, pay_month, status, created_by) VALUES ($1, $2, 'Draft', $3) RETURNING id`,
      [campusId, month, req.user!.id],
    );
    await audit(req, { action: 'create', module: 'payroll', description: `Opened payroll run ${payMonth} for ${campus.short_name}`, entityType: 'payroll_run', entityId: r!.id });
    return r;
  }, 'A payroll run already exists for this campus and month');
}

async function lockRun(id: string, db: Queryable) {
  const r = await one(
    `SELECT r.*, to_char(r.pay_month, 'FMMonth YYYY') AS label, to_char(r.pay_month, 'YYYY-MM-DD') AS pay_month_text, ${monthEndSql} AS month_end, cp.short_name AS campus_name
       FROM payroll_runs r LEFT JOIN campuses cp ON cp.id = r.campus_id WHERE r.id = $1 FOR UPDATE OF r`, [id], db);
  if (!r) throw notFound('Payroll run not found', 'PAYROLL_RUN_NOT_FOUND');
  return r;
}

function expect(run: { status: string }, allowed: Stage[], action: string) {
  if (!allowed.includes(run.status as Stage)) {
    throw badRequest(`Cannot ${action} a run that is ${run.status} (allowed from: ${allowed.join(', ')})`, 'INVALID_STAGE');
  }
}

export async function collectInputs(req: Request, id: string) {
  return tx(async (db) => {
    const run = await lockRun(id, db);
    expect(run, ['Draft'], 'collect inputs for');
    await query(`UPDATE payroll_runs SET status = 'Inputs' WHERE id = $1`, [id], db);
    const inputs = await runInputs(run.campus_id, run.pay_month, id, db);
    await audit(req, { action: 'update', module: 'payroll', description: `Payroll ${run.label} (${run.campus_name}) moved to Inputs`, entityType: 'payroll_run', entityId: id, metadata: { pending: inputs.pendingCount } }, db);
    return inputs;
  });
}

/**
 * Generates a payslip for every active employee of the campus from the
 * approved inputs. Recalculating replaces the run's previous payslips and
 * re-reserves overtime and reimbursements.
 */
export async function calculateRun(req: Request, id: string) {
  return tx(async (db) => {
    const run = await lockRun(id, db);
    expect(run, ['Draft', 'Inputs', 'Calculated'], 'calculate');
    if (!run.campus_id) throw badRequest('Group-level runs cannot be calculated', 'NO_CAMPUS');
    await query('DELETE FROM payslips WHERE payroll_run_id = $1', [id], db);
    await query(`UPDATE overtime_entries SET payroll_run_id = NULL WHERE payroll_run_id = $1 AND status = 'Approved'`, [id], db);
    await query(`UPDATE reimbursements SET paid_in_run_id = NULL WHERE paid_in_run_id = $1 AND status = 'Approved'`, [id], db);

    const employees = await many<{ id: string; basic: number }>(
      `SELECT e.id, e.basic_salary::float AS basic FROM employees e
        WHERE e.campus_id = $1 AND e.deleted_at IS NULL AND e.employment_status IN ('active', 'on_notice')
          AND (e.join_date IS NULL OR e.join_date <= $2)
        ORDER BY e.employee_code`,
      [run.campus_id, run.month_end], db,
    );
    if (!employees.length) throw badRequest('There are no active employees on this campus', 'NO_EMPLOYEES');
    const ids = employees.map((e) => e.id);

    const ot = await many<{ id: string; employee_id: string; hours: number; value: number }>(
      `SELECT id, employee_id, hours::float, (hours * rate_per_hour)::float AS value FROM overtime_entries
        WHERE employee_id = ANY($1) AND status = 'Approved' AND work_date <= $2 AND payroll_run_id IS NULL`,
      [ids, run.month_end], db);
    const allowances = await many<{ employee_id: string; label: string; amount: number }>(
      `SELECT employee_id, allowance_type AS label, amount::float FROM allowances
        WHERE employee_id = ANY($1) AND status = 'Approved'
          AND ((frequency = 'Monthly' AND effective_month <= $2) OR (frequency = 'One-time' AND effective_month = $2))
        ORDER BY employee_id, frequency DESC, created_at`,
      [ids, run.pay_month], db);
    const reimb = await many<{ id: string; employee_id: string; amount: number }>(
      `SELECT id, employee_id, amount::float FROM reimbursements
        WHERE employee_id = ANY($1) AND status = 'Approved' AND paid_in_run_id IS NULL AND claim_date <= $2`,
      [ids, run.month_end], db);
    const days = await many<{ employee_id: string; days: number; unpaid: number }>(
      `SELECT employee_id, sum(CASE WHEN status IN ('Present', 'Late', 'On Leave') THEN 1 WHEN status = 'Half Day' THEN 0.5 ELSE 0 END)::float AS days,
              sum(CASE WHEN status = 'Absent' THEN 1 WHEN status = 'Half Day' THEN 0.5 ELSE 0 END)::float AS unpaid
         FROM staff_attendance WHERE employee_id = ANY($1) AND attendance_date BETWEEN $2 AND $3 GROUP BY employee_id`,
      [ids, run.pay_month, run.month_end], db);
    const workingDays = workingDaysInMonth(run.pay_month_text);

    const sum = <T extends { employee_id: string }>(rows: T[], id: string, f: (r: T) => number) =>
      rows.filter((r) => r.employee_id === id).reduce((a, r) => a + f(r), 0);
    const totals = { gross: 0, ded: 0, ot: 0, allow: 0, net: 0 };
    for (const e of employees) {
      const slip = calculatePayslip({
        basic: e.basic,
        allowances: allowances.filter((a) => a.employee_id === e.id).map((a) => ({ label: a.label, amount: a.amount })),
        overtimeHours: sum(ot, e.id, (r) => r.hours),
        overtimeAmount: sum(ot, e.id, (r) => r.value),
        reimbursements: sum(reimb, e.id, (r) => r.amount),
        // Loss of pay for unpaid absences recorded in staff attendance.
        unpaidDays: days.find((d) => d.employee_id === e.id)?.unpaid ?? 0,
        workingDays,
      });
      await query(
        `INSERT INTO payslips (payroll_run_id, employee_id, earnings, deductions, gross, total_deductions, net, days_worked, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Draft')`,
        [id, e.id, JSON.stringify(slip.earnings), JSON.stringify(slip.deductions), slip.gross, slip.totalDeductions, slip.net,
          days.find((d) => d.employee_id === e.id)?.days ?? 0], db,
      );
      totals.gross += slip.gross; totals.ded += slip.totalDeductions; totals.ot += slip.overtimeTotal;
      totals.allow += slip.allowancesTotal; totals.net += slip.net;
    }
    if (ot.length) await query('UPDATE overtime_entries SET payroll_run_id = $1 WHERE id = ANY($2)', [id, ot.map((o) => o.id)], db);
    if (reimb.length) await query('UPDATE reimbursements SET paid_in_run_id = $1 WHERE id = ANY($2)', [id, reimb.map((o) => o.id)], db);
    const r2 = (n: number) => Math.round(n * 100) / 100;
    await query(
      `UPDATE payroll_runs SET status = 'Calculated', employee_count = $2, gross_total = $3, deductions_total = $4,
              overtime_total = $5, allowances_total = $6, net_total = $7, calculated_by = $8, calculated_at = now(),
              submitted_by = NULL, submitted_at = NULL, approved_by = NULL, approved_at = NULL
        WHERE id = $1`,
      [id, employees.length, r2(totals.gross), r2(totals.ded), r2(totals.ot), r2(totals.allow), r2(totals.net), req.user!.id], db,
    );
    await audit(req, {
      action: 'update', module: 'payroll', entityType: 'payroll_run', entityId: id,
      description: `Calculated payroll ${run.label} (${run.campus_name}): ${employees.length} payslips, net ₹${r2(totals.net)}`,
      metadata: { employees: employees.length, overtimeItems: ot.length, reimbursements: reimb.length },
    }, db);
    return { employees: employees.length, net: r2(totals.net), gross: r2(totals.gross) };
  });
}

export async function submitRun(req: Request, id: string) {
  return tx(async (db) => {
    const run = await lockRun(id, db);
    expect(run, ['Calculated'], 'submit');
    await query(`UPDATE payroll_runs SET status = 'Under Review', submitted_by = $2, submitted_at = now(), review_note = NULL WHERE id = $1`, [id, req.user!.id], db);
    await audit(req, { action: 'update', module: 'payroll', description: `Submitted payroll ${run.label} (${run.campus_name}) for approval`, entityType: 'payroll_run', entityId: id }, db);
    await notifyRoles(['principal', 'super_admin'], {
      category: 'Attention', icon: 'wallet', topic: 'payroll', route: '/payroll', entityType: 'payroll_run', entityId: id,
      title: `Payroll ${run.label} awaits your approval`, body: `${run.campus_name} · ${run.employee_count} employees · net ₹${Number(run.net_total).toLocaleString('en-IN')}`,
    }, db);
  });
}

/** Maker-checker: the approver must not be the user who calculated the run. */
export async function approveRun(req: Request, id: string) {
  return tx(async (db) => {
    const run = await lockRun(id, db);
    expect(run, ['Under Review'], 'approve');
    if (run.calculated_by === req.user!.id) {
      throw forbidden('The person who calculated this payroll cannot approve it. Another approver must review it.', 'MAKER_CHECKER');
    }
    await query(`UPDATE payroll_runs SET status = 'Approved', approved_by = $2, approved_at = now() WHERE id = $1`, [id, req.user!.id], db);
    await audit(req, { action: 'approve', module: 'payroll', description: `Approved payroll ${run.label} (${run.campus_name}), net ₹${run.net_total}`, entityType: 'payroll_run', entityId: id }, db);
    const makers = [run.calculated_by, run.submitted_by].filter(Boolean);
    await notifyUsers(makers, {
      category: 'Completed', icon: 'check', topic: 'payroll', route: '/payroll', entityType: 'payroll_run', entityId: id,
      title: `Payroll ${run.label} approved`, body: `${run.campus_name} · ready to release payslips`,
    }, db);
  });
}

export async function returnRun(req: Request, id: string, note: string) {
  return tx(async (db) => {
    const run = await lockRun(id, db);
    expect(run, ['Under Review', 'Approved'], 'return');
    await query(
      `UPDATE payroll_runs SET status = 'Inputs', review_note = $2, approved_by = NULL, approved_at = NULL WHERE id = $1`,
      [id, note], db);
    await audit(req, { action: 'reject', module: 'payroll', description: `Returned payroll ${run.label} (${run.campus_name}) for changes: ${note}`, entityType: 'payroll_run', entityId: id }, db);
    await notifyUsers([run.calculated_by, run.submitted_by].filter(Boolean), {
      category: 'Attention', icon: 'alert', topic: 'payroll', route: '/payroll', entityType: 'payroll_run', entityId: id,
      title: `Payroll ${run.label} returned for changes`, body: note,
    }, db);
  });
}

export async function releaseRun(req: Request, id: string) {
  return tx(async (db) => {
    const run = await lockRun(id, db);
    expect(run, ['Approved'], 'release');
    await query(`UPDATE payslips SET status = 'Released', released_at = now() WHERE payroll_run_id = $1`, [id], db);
    await query(`UPDATE payroll_runs SET status = 'Released', released_at = now(), released_by = $2 WHERE id = $1`, [id, req.user!.id], db);
    const users = await many<{ user_id: string }>(
      `SELECT e.user_id FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE p.payroll_run_id = $1 AND e.user_id IS NOT NULL`, [id], db);
    await notifyUsers(users.map((u) => u.user_id), {
      category: 'Information', icon: 'receipt', topic: 'payroll', route: '/staff-self', entityType: 'payroll_run', entityId: id,
      title: `Your ${run.label} payslip is available`, body: 'Open Staff Self-Service to view or print it', channels: ['push', 'email'],
    }, db);
    await audit(req, { action: 'update', module: 'payroll', description: `Released ${run.employee_count} payslips for ${run.label} (${run.campus_name})`, entityType: 'payroll_run', entityId: id, metadata: { notified: users.length } }, db);
    return { released: run.employee_count, notified: users.length };
  });
}

export async function markPaid(req: Request, id: string) {
  return tx(async (db) => {
    const run = await lockRun(id, db);
    expect(run, ['Released'], 'mark paid');
    await query(`UPDATE payroll_runs SET status = 'Paid', paid_at = now() WHERE id = $1`, [id], db);
    const ot = await query(`UPDATE overtime_entries SET status = 'Paid' WHERE payroll_run_id = $1 AND status = 'Approved'`, [id], db);
    const rb = await query(`UPDATE reimbursements SET status = 'Paid' WHERE paid_in_run_id = $1 AND status = 'Approved'`, [id], db);
    await audit(req, {
      action: 'update', module: 'payroll', entityType: 'payroll_run', entityId: id,
      description: `Marked payroll ${run.label} (${run.campus_name}) as paid (${ot.rowCount} overtime, ${rb.rowCount} reimbursements settled)`,
    }, db);
  });
}

// ---------------------------------------------------------------------------
// Payslips
// ---------------------------------------------------------------------------
const SLIP_SORTS: Record<string, string> = {
  name: 'e.full_name', code: 'e.employee_code', category: 'e.category', gross: 'p.gross', net: 'p.net', month: 'r.pay_month', status: 'p.status',
};

export async function listPayslips(f: Pagination & { runId?: string; campusId?: string; employeeType?: string; status?: string }) {
  const w = new Where();
  w.addIf(f.runId, 'p.payroll_run_id = ?');
  w.addIf(f.campusId, 'r.campus_id = ?');
  w.addIf(f.employeeType, 'e.employee_type = ?');
  w.addIf(f.status, 'p.status = ?');
  if (f.q) w.add('(e.full_name ILIKE ? OR e.employee_code ILIKE ?)', likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT count(*) OVER() AS total, p.id, p.employee_id AS "employeeId", e.full_name AS "employeeName", e.employee_code AS "employeeCode",
            e.designation, e.employee_type AS "employeeType", e.category, r.id AS "runId", r.pay_month AS "payMonth",
            to_char(r.pay_month, 'FMMonth YYYY') AS "monthLabel", r.status AS "runStatus", cp.short_name AS "campusName",
            p.gross::float AS gross, p.total_deductions::float AS deductions, p.net::float AS net, p.status, p.released_at AS "releasedAt",
            prev.status AS "previousStatus"
       FROM payslips p
       JOIN payroll_runs r ON r.id = p.payroll_run_id
       JOIN employees e ON e.id = p.employee_id
       LEFT JOIN campuses cp ON cp.id = r.campus_id
       LEFT JOIN LATERAL (
         SELECT p2.status FROM payslips p2 JOIN payroll_runs r2 ON r2.id = p2.payroll_run_id
          WHERE p2.employee_id = p.employee_id AND r2.pay_month < r.pay_month ORDER BY r2.pay_month DESC LIMIT 1) prev ON true
      ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, SLIP_SORTS, 'name')}, r.pay_month DESC, e.full_name
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export async function payslipSummary(campusId?: string) {
  const [k, runs] = await Promise.all([
    one(`SELECT count(*) FILTER (WHERE p.status = 'Released' AND r.pay_month >= date_trunc('year', now())::date)::int AS "releasedThisYear",
                count(*) FILTER (WHERE p.status = 'Released')::int AS "releasedTotal"
           FROM payslips p JOIN payroll_runs r ON r.id = p.payroll_run_id WHERE ($1::uuid IS NULL OR r.campus_id = $1)`, [campusId ?? null]),
    many(`SELECT r.id, r.pay_month AS "payMonth", to_char(r.pay_month, 'FMMonth YYYY') AS "monthLabel", r.status,
                 cp.short_name AS "campusName", r.employee_count AS "employeeCount", r.net_total::float AS net
            FROM payroll_runs r LEFT JOIN campuses cp ON cp.id = r.campus_id
           WHERE ($1::uuid IS NULL OR r.campus_id = $1) ORDER BY r.pay_month DESC, cp.short_name LIMIT 24`, [campusId ?? null]),
  ]);
  return { kpis: k, runs };
}

/**
 * One payslip with everything a printed slip shows. `employeeId` restricts to
 * the signed-in employee (self-service) and then only released slips are visible.
 */
export async function getPayslip(req: Request, id: string, employeeId?: string) {
  const w = new Where().add('p.id = ?', id);
  if (employeeId) w.add('p.employee_id = ?', employeeId).add(`p.status = 'Released'`);
  const slip = await one(
    `SELECT p.id, p.employee_id AS "employeeId", e.full_name AS "employeeName", e.employee_code AS "employeeCode",
            e.designation, e.department, e.bank_account_masked AS "bankAccount", e.join_date AS "joinDate",
            cp.name AS "campusName", cp.address AS "campusAddress",
            r.id AS "runId", r.pay_month AS "payMonth", to_char(r.pay_month, 'FMMonth YYYY') AS "monthLabel", r.status AS "runStatus",
            COALESCE(r.paid_at, r.released_at) AS "paymentDate",
            (r.pay_month + interval '1 month' - interval '1 day')::date AS "monthEnd",
            p.earnings, p.deductions, p.gross::float AS gross, p.total_deductions::float AS "totalDeductions", p.net::float AS net,
            p.days_worked::float AS "daysWorked", p.status, p.released_at AS "releasedAt",
            (SELECT count(*) FROM generate_series(r.pay_month, (r.pay_month + interval '1 month' - interval '1 day')::date, interval '1 day') d
              WHERE extract(isodow FROM d) < 7)::int AS "workingDays",
            (SELECT count(*) FROM staff_attendance sa WHERE sa.employee_id = p.employee_id AND sa.status = 'On Leave'
              AND sa.attendance_date BETWEEN r.pay_month AND (r.pay_month + interval '1 month' - interval '1 day')::date)::int AS "leaveDays",
            (SELECT COALESCE(sum(o.hours), 0) FROM overtime_entries o WHERE o.payroll_run_id = r.id AND o.employee_id = p.employee_id)::float AS "overtimeHours"
       FROM payslips p
       JOIN payroll_runs r ON r.id = p.payroll_run_id
       JOIN employees e ON e.id = p.employee_id
       LEFT JOIN campuses cp ON cp.id = r.campus_id
      ${w.sql}`,
    w.params,
  );
  if (!slip) throw notFound('Payslip not found', 'PAYSLIP_NOT_FOUND');
  await audit(req, { action: 'view', module: 'payroll', description: `Viewed payslip ${slip.monthLabel} for ${slip.employeeName}`, entityType: 'payslip', entityId: id });
  return slip;
}
