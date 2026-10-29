/**
 * Salary dashboard (payroll.read): the school's pay bill from payroll runs and payslips —
 * monthly trend, the latest month against the one before, financial-year-to-date totals,
 * cost by department, earnings and deduction components, how pay is spread across bands,
 * and where each campus's latest run stands. Optionally scoped to one campus.
 */
import type { Request } from 'express';
import { many, one, query, tx } from '../config/db.js';
import { badRequest, notFound } from '../utils/errors.js';
import { audit } from './audit.service.js';
import { calculatePayslip, workingDaysInMonth } from './workforce-paycalc.js';
import { schoolToday } from './academics.service.js';

const n = (v: unknown) => Number(v ?? 0);

/** Gross monthly pay bands, in rupees. */
const BANDS: [string, number, number | null][] = [
  ['Under ₹25k', 0, 25_000], ['₹25k–50k', 25_000, 50_000], ['₹50k–75k', 50_000, 75_000],
  ['₹75k–1L', 75_000, 100_000], ['₹1L and above', 100_000, null],
];

export async function salaryDashboard(campusId?: string) {
  const p = [campusId ?? null];
  const runScope = '($1::uuid IS NULL OR r.campus_id = $1::uuid)';

  // Monthly totals across the campuses in scope (last 12 pay months on record).
  const months = (await many(
    `SELECT to_char(r.pay_month, 'YYYY-MM-DD') AS month, sum(r.gross_total) AS gross, sum(r.deductions_total) AS deductions,
            sum(r.net_total) AS net, sum(r.overtime_total) AS overtime, sum(r.allowances_total) AS allowances,
            sum(r.employee_count)::int AS employees,
            bool_and(r.status IN ('Approved', 'Released', 'Paid')) AS final
       FROM payroll_runs r WHERE ${runScope}
      GROUP BY r.pay_month ORDER BY r.pay_month DESC LIMIT 12`, p)).reverse().map((m) => ({
    month: m.month as string, gross: n(m.gross), deductions: n(m.deductions), net: n(m.net), overtime: n(m.overtime),
    allowances: n(m.allowances), employees: n(m.employees), final: !!m.final,
  }));
  const latest = months.at(-1) ?? null;
  const previous = months.at(-2) ?? null;
  if (!latest) return { latest: null, previous: null, months, yearToDate: null, runs: [], departments: [], categories: [], earnings: [], deductions: [], bands: [], pending: null };

  // Payslips of the latest pay month in scope.
  const slips = `FROM payslips ps JOIN payroll_runs r ON r.id = ps.payroll_run_id JOIN employees e ON e.id = ps.employee_id
                 WHERE ${runScope} AND r.pay_month = $2::date`;
  const lp = [campusId ?? null, latest.month];

  // Indian financial year (April–March) containing the latest pay month.
  const [y, m] = latest.month.split('-').map(Number);
  const fyStart = `${m >= 4 ? y : y - 1}-04-01`;

  const [ytd, runs, departments, categories, earnings, deductions, bands, pending] = await Promise.all([
    one(
      `SELECT sum(r.gross_total) AS gross, sum(r.deductions_total) AS deductions, sum(r.net_total) AS net,
              count(DISTINCT r.pay_month)::int AS months
         FROM payroll_runs r WHERE ${runScope} AND r.pay_month BETWEEN $2::date AND $3::date`, [campusId ?? null, fyStart, latest.month]),
    many(
      `SELECT r.id, cp.short_name AS campus, r.status, r.employee_count AS employees, r.net_total AS net, r.gross_total AS gross
         FROM payroll_runs r LEFT JOIN campuses cp ON cp.id = r.campus_id
        WHERE ${runScope} AND r.pay_month = $2::date ORDER BY cp.short_name`, lp),
    many(
      `SELECT COALESCE(NULLIF(e.department, ''), 'Unassigned') AS label, count(*)::int AS employees,
              sum(ps.gross) AS gross, sum(ps.net) AS net ${slips}
        GROUP BY 1 ORDER BY sum(ps.gross) DESC`, lp),
    many(
      `SELECT COALESCE(NULLIF(e.category, ''), 'Other') AS label, count(*)::int AS employees, sum(ps.gross) AS gross ${slips}
        GROUP BY 1 ORDER BY sum(ps.gross) DESC`, lp),
    // Components are labelled per payslip (e.g. "Overtime (6 hrs)"); group them by name.
    many(
      `SELECT regexp_replace(c->>'label', '\\s*\\(.*\\)$', '') AS label, sum((c->>'amount')::numeric) AS amount
         ${slips.replace('FROM payslips ps', 'FROM payslips ps CROSS JOIN LATERAL jsonb_array_elements(ps.earnings) c')}
        GROUP BY 1 HAVING sum((c->>'amount')::numeric) > 0 ORDER BY 2 DESC`, lp),
    many(
      `SELECT regexp_replace(c->>'label', '\\s*\\(.*\\)$', '') AS label, sum((c->>'amount')::numeric) AS amount
         ${slips.replace('FROM payslips ps', 'FROM payslips ps CROSS JOIN LATERAL jsonb_array_elements(ps.deductions) c')}
        GROUP BY 1 HAVING sum((c->>'amount')::numeric) > 0 ORDER BY 2 DESC`, lp),
    many(`SELECT ps.gross ${slips}`, lp),
    one(
      `SELECT (SELECT count(*) FROM payroll_runs r WHERE ${runScope} AND r.status = 'Under Review')::int AS "runsAwaitingApproval",
              (SELECT count(*) FROM reimbursements x JOIN employees e ON e.id = x.employee_id
                WHERE ($1::uuid IS NULL OR e.campus_id = $1::uuid) AND x.status = 'Approved')::int AS "claimsToPay",
              (SELECT COALESCE(sum(x.amount), 0) FROM reimbursements x JOIN employees e ON e.id = x.employee_id
                WHERE ($1::uuid IS NULL OR e.campus_id = $1::uuid) AND x.status = 'Approved') AS "claimsToPayValue"`, p),
  ]);

  const grossList = bands.map((b) => n(b.gross));
  return {
    latest: { ...latest, averageGross: latest.employees ? Math.round(latest.gross / latest.employees) : 0 },
    previous,
    months,
    yearToDate: { from: fyStart, gross: n(ytd?.gross), deductions: n(ytd?.deductions), net: n(ytd?.net), months: n(ytd?.months) },
    runs: runs.map((r) => ({ ...r, net: n(r.net), gross: n(r.gross) })),
    departments: departments.map((d) => ({ label: d.label, employees: d.employees, gross: n(d.gross), net: n(d.net), average: d.employees ? Math.round(n(d.gross) / d.employees) : 0 })),
    categories: categories.map((c) => ({ label: c.label, employees: c.employees, gross: n(c.gross) })),
    earnings: earnings.map((x) => ({ label: x.label, amount: n(x.amount) })),
    deductions: deductions.map((x) => ({ label: x.label, amount: n(x.amount) })),
    bands: BANDS.map(([label, lo, hi]) => ({ label, employees: grossList.filter((g) => g >= lo && (hi == null || g < hi)).length })),
    pending: { runsAwaitingApproval: n(pending?.runsAwaitingApproval), claimsToPay: n(pending?.claimsToPay), claimsToPayValue: n(pending?.claimsToPayValue) },
  };
}

/**
 * Every payslip of one pay month (the latest when none is given): who, what they earn,
 * and the payslip to open. Optionally scoped to one campus.
 */
export async function salaryEmployees(campusId?: string, month?: string) {
  const scope = '($1::uuid IS NULL OR r.campus_id = $1::uuid)';
  const target = month ?? (await one<{ m: string }>(
    `SELECT to_char(max(r.pay_month), 'YYYY-MM-DD') AS m FROM payroll_runs r WHERE ${scope}`, [campusId ?? null]))?.m;
  if (!target) return { month: null, rows: [] };
  const rows = await many(
    `SELECT ps.id AS "payslipId", e.id AS "employeeId", e.employee_code AS code, e.full_name AS name, e.designation,
            COALESCE(NULLIF(e.department, ''), 'Unassigned') AS department, cp.short_name AS campus,
            ps.gross, ps.total_deductions AS deductions, ps.net, ps.days_worked AS "daysWorked",
            ps.status AS "payslipStatus", r.status AS "runStatus"
       FROM payslips ps JOIN payroll_runs r ON r.id = ps.payroll_run_id JOIN employees e ON e.id = ps.employee_id
       LEFT JOIN campuses cp ON cp.id = r.campus_id
      WHERE ${scope} AND r.pay_month = $2::date
      ORDER BY e.full_name`, [campusId ?? null, target]);
  return {
    month: target,
    rows: rows.map((r) => ({ ...r, gross: n(r.gross), deductions: n(r.deductions), net: n(r.net), daysWorked: r.daysWorked == null ? null : n(r.daysWorked) })),
  };
}

// =============================================================================
// Set an employee's salary: basic pay and monthly allowances
// =============================================================================
interface AllowanceInput { type: string; amount: number }

export interface MonthAttendance {
  month: string; workingDays: number; present: number; late: number; onLeave: number; halfDay: number; absent: number;
  unmarked: number; unpaidDays: number;
}

/**
 * One employee's staff attendance for a month: what is marked, what is still unmarked among the
 * working days so far, and the unpaid days (Absent 1, Half Day ½) that loss of pay is based on.
 */
export async function attendanceFor(employeeId: string, month: string): Promise<MonthAttendance> {
  const m = `${month.slice(0, 7)}-01`;
  const a = await one<{ present: number; late: number; on_leave: number; half_day: number; absent: number; elapsed: number }>(
    `SELECT count(*) FILTER (WHERE status = 'Present')::int AS present, count(*) FILTER (WHERE status = 'Late')::int AS late,
            count(*) FILTER (WHERE status = 'On Leave')::int AS on_leave, count(*) FILTER (WHERE status = 'Half Day')::int AS half_day,
            count(*) FILTER (WHERE status = 'Absent')::int AS absent,
            (SELECT count(*)::int FROM generate_series($2::date, LEAST(($2::date + interval '1 month - 1 day')::date, current_date), interval '1 day') d
              WHERE extract(dow FROM d) <> 0) AS elapsed
       FROM staff_attendance WHERE employee_id = $1 AND attendance_date >= $2::date AND attendance_date < ($2::date + interval '1 month')`,
    [employeeId, m]);
  const marked = (a?.present ?? 0) + (a?.late ?? 0) + (a?.on_leave ?? 0) + (a?.half_day ?? 0) + (a?.absent ?? 0);
  return {
    month: m, workingDays: workingDaysInMonth(m), present: a?.present ?? 0, late: a?.late ?? 0, onLeave: a?.on_leave ?? 0,
    halfDay: a?.half_day ?? 0, absent: a?.absent ?? 0, unmarked: Math.max(0, (a?.elapsed ?? 0) - marked),
    unpaidDays: (a?.absent ?? 0) + (a?.half_day ?? 0) * 0.5,
  };
}

/** A month's regular pay (no overtime or claims) for a basic and allowances, less loss of pay for the month's attendance. */
export function previewPay(basic: number, allowances: AllowanceInput[], attendance?: MonthAttendance) {
  const p = calculatePayslip({
    basic, allowances: allowances.filter((a) => a.amount > 0).map((a) => ({ label: a.type, amount: a.amount })),
    overtimeHours: 0, overtimeAmount: 0, reimbursements: 0,
    unpaidDays: attendance?.unpaidDays ?? 0, workingDays: attendance?.workingDays ?? 0,
  });
  return {
    earnings: p.earnings.filter((e) => !e.label.startsWith('Overtime')),
    deductions: p.deductions.filter((x) => x.amount > 0),
    gross: p.gross, totalDeductions: p.totalDeductions, net: p.net,
  };
}

/** The employee's basic, their monthly allowances (approved and awaiting approval) and the pay they make. */
export async function getSalary(employeeId: string, month?: string) {
  const e = await one<{ id: string; name: string; code: string; designation: string; department: string; campus: string | null; basic: number }>(
    `SELECT e.id, e.full_name AS name, e.employee_code AS code, e.designation, e.department, cp.short_name AS campus, e.basic_salary::float AS basic
       FROM employees e LEFT JOIN campuses cp ON cp.id = e.campus_id WHERE e.id = $1 AND e.deleted_at IS NULL`, [employeeId]);
  if (!e) throw notFound('Employee not found', 'EMPLOYEE_NOT_FOUND');
  const allowances = await many<{ id: string; type: string; amount: number; status: string; effectiveMonth: string }>(
    `SELECT id, allowance_type AS type, amount::float AS amount, status, to_char(effective_month, 'YYYY-MM-DD') AS "effectiveMonth"
       FROM allowances WHERE employee_id = $1 AND frequency = 'Monthly' AND status IN ('Approved', 'Submitted')
      ORDER BY allowance_type, status`, [employeeId]);
  const current = allowances.filter((a) => a.status === 'Approved');
  const attendance = await attendanceFor(employeeId, month ?? schoolToday());
  return { employee: e, basic: e.basic, allowances, attendance, current: previewPay(e.basic, current, attendance) };
}

/**
 * Sets basic pay (applies at the next payroll calculation) and the monthly allowances.
 * Allowances follow the approval rule: an approver's changes apply at once; anyone else's are
 * proposed (the current amount keeps being paid until the Super Admin approves the new one).
 * Removing an allowance stops it straight away, as in the Allowances module.
 */
export async function setSalary(req: Request, employeeId: string, b: { basicSalary: number; allowances: AllowanceInput[]; effectiveMonth: string }) {
  const key = (t: string) => t.trim().toLowerCase();
  const types = b.allowances.map((a) => key(a.type));
  if (new Set(types).size !== types.length) throw badRequest('Each allowance can be listed once', 'DUPLICATE_ALLOWANCE');
  const approver = req.user!.permissions.has('approvals.decide') && req.user!.employeeId !== employeeId;
  const month = `${b.effectiveMonth.slice(0, 7)}-01`;
  return tx(async (db) => {
    const e = await one<{ full_name: string; basic: number }>(
      'SELECT full_name, basic_salary::float AS basic FROM employees WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [employeeId], db);
    if (!e) throw notFound('Employee not found', 'EMPLOYEE_NOT_FOUND');
    const out = { basicChanged: false, applied: [] as string[], proposed: [] as string[], stopped: [] as string[] };
    if (Math.abs(e.basic - b.basicSalary) > 0.004) {
      await query('UPDATE employees SET basic_salary = $2 WHERE id = $1', [employeeId, b.basicSalary], db);
      out.basicChanged = true;
    }
    const existing = await many<{ id: string; type: string; amount: number; status: string }>(
      `SELECT id, allowance_type AS type, amount::float AS amount, status FROM allowances
        WHERE employee_id = $1 AND frequency = 'Monthly' AND status IN ('Approved', 'Submitted') FOR UPDATE`, [employeeId], db);
    const wanted = new Map(b.allowances.filter((a) => a.amount > 0).map((a) => [key(a.type), { type: a.type.trim(), amount: a.amount }]));
    const same = (x: number, y: number) => Math.abs(x - y) < 0.005;
    // Removed (or set to zero): stop the approved one and withdraw any proposal.
    for (const x of existing) {
      if (wanted.has(key(x.type))) continue;
      await query('UPDATE allowances SET status = $2 WHERE id = $1', [x.id, x.status === 'Approved' ? 'Stopped' : 'Rejected'], db);
      if (!out.stopped.includes(x.type)) out.stopped.push(x.type);
    }
    for (const [k, w] of wanted) {
      const approved = existing.find((x) => key(x.type) === k && x.status === 'Approved');
      const proposed = existing.find((x) => key(x.type) === k && x.status === 'Submitted');
      if (approved && same(approved.amount, w.amount) && !proposed) continue; // unchanged
      if (proposed && same(proposed.amount, w.amount) && (!approver || !approved)) continue; // already proposed: left for the approval step
      if (approved && same(approved.amount, w.amount) && proposed) {
        // Back to the current amount: withdraw the pending change.
        await query(`UPDATE allowances SET status = 'Rejected' WHERE id = $1`, [proposed.id], db);
        continue;
      }
      if (proposed) await query(`UPDATE allowances SET status = 'Rejected' WHERE id = $1`, [proposed.id], db);
      if (approver && approved) await query(`UPDATE allowances SET status = 'Stopped' WHERE id = $1`, [approved.id], db);
      await query(
        `INSERT INTO allowances (employee_id, allowance_type, amount, frequency, effective_month, status) VALUES ($1, $2, $3, 'Monthly', $4, $5)`,
        [employeeId, w.type, w.amount, month, approver ? 'Approved' : 'Submitted'], db);
      (approver ? out.applied : out.proposed).push(w.type);
    }
    await audit(req, {
      action: 'update', module: 'payroll', entityType: 'employee', entityId: employeeId,
      description: `Set salary for ${e.full_name}`
        + (out.basicChanged ? ` · basic ${e.basic} -> ${b.basicSalary}` : '')
        + (out.applied.length ? ` · applied ${out.applied.join(', ')}` : '')
        + (out.proposed.length ? ` · proposed ${out.proposed.join(', ')} for approval` : '')
        + (out.stopped.length ? ` · stopped ${out.stopped.join(', ')}` : ''),
      metadata: { ...out, effectiveMonth: month },
    }, db);
    return out;
  });
}
