import type { Request } from 'express';
import { many, one, query, tx } from '../config/db.js';
import { Where } from '../utils/sql.js';
import { likeTerm, limitOffset, orderBy } from '../utils/pagination.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { nextCode } from '../utils/codes.js';
import { audit } from './audit.service.js';
import { notifyRoles, notifyUsers } from './notification.service.js';
import { BAL, NET } from './finance-fees.service.js';

/**
 * Finance — operations side: expenses, reimbursements, allowances, budgets,
 * scholarships, bank reconciliation and standard reports.
 * Workflow vocabulary: Draft → Submitted → Under Review → Approved / Rejected → Paid.
 */

const YEAR = `(SELECT id FROM academic_years WHERE is_current)`;
const inr = (v: number) => '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const page = <T extends { total?: number }>(rows: T[]) => ({ rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 });

type Transition = 'submit' | 'review' | 'approve' | 'reject' | 'pay';
const FROM_STATES: Record<Transition, string[]> = {
  submit: ['Draft'],
  review: ['Submitted'],
  approve: ['Submitted', 'Under Review'],
  reject: ['Submitted', 'Under Review'],
  pay: ['Approved'],
};
const TO_STATE: Record<Transition, string> = { submit: 'Submitted', review: 'Under Review', approve: 'Approved', reject: 'Rejected', pay: 'Paid' };

async function employeeUser(employeeId: string | null) {
  if (!employeeId) return null;
  const r = await one<{ user_id: string | null }>('SELECT user_id FROM employees WHERE id = $1', [employeeId]);
  return r?.user_id ?? null;
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------
const EXP_SORT: Record<string, string> = { date: 'e.expense_date', amount: 'e.amount', code: 'e.code', status: 'e.status', category: 'e.category' };

export async function listExpenses(f: any) {
  const w = new Where();
  w.addIf(f.campusId, 'e.campus_id = ?');
  w.addIf(f.status, 'e.status = ?');
  w.addIf(f.category, 'e.category = ?');
  w.addIf(f.from, 'e.expense_date >= ?');
  w.addIf(f.to, 'e.expense_date <= ?');
  if (f.q) w.add('(e.code ILIKE ? OR e.description ILIKE ? OR e.category ILIKE ?)', likeTerm(f.q), likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT e.id, e.code, e.category, e.description, e.amount, e.expense_date AS "expenseDate", e.status,
            e.rejection_reason AS "rejectionReason", e.approved_at AS "decidedAt", au.full_name AS "decidedBy",
            emp.full_name AS "raisedBy", emp.department, v.name AS vendor, cp.short_name AS campus, e.created_at AS "createdAt",
            count(*) OVER() AS total
       FROM expenses e JOIN campuses cp ON cp.id = e.campus_id
       LEFT JOIN employees emp ON emp.id = e.submitted_by
       LEFT JOIN vendors v ON v.id = e.vendor_id
       LEFT JOIN users au ON au.id = e.approved_by
       ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, EXP_SORT, 'date')}, e.code DESC
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`, w.params);
  return page(rows);
}

export async function expenseSummary(campusId?: string) {
  const w = new Where();
  w.addIf(campusId, 'e.campus_id = ?');
  const yw = new Where().add(`e.expense_date >= (SELECT starts_on FROM academic_years WHERE is_current)`).add(`e.status IN ('Approved', 'Paid')`);
  yw.addIf(campusId, 'e.campus_id = ?');
  const [flow, byCategory] = await Promise.all([
    one(
      `SELECT count(*) FILTER (WHERE e.status = 'Draft')::int AS draft,
              count(*) FILTER (WHERE e.status = 'Submitted')::int AS submitted,
              count(*) FILTER (WHERE e.status = 'Under Review')::int AS "underReview",
              count(*) FILTER (WHERE e.status = 'Approved' AND e.approved_at >= date_trunc('week', now()))::int AS "approvedThisWeek",
              count(*) FILTER (WHERE e.status = 'Approved')::int AS approved,
              count(*) FILTER (WHERE e.status = 'Rejected' AND e.approved_at >= now() - interval '30 days')::int AS "rejected30d",
              count(*) FILTER (WHERE e.status = 'Paid')::int AS paid,
              COALESCE(sum(e.amount) FILTER (WHERE e.status IN ('Submitted', 'Under Review')), 0) AS "pendingValue"
         FROM expenses e ${w.sql}`, w.params),
    many(`SELECT e.category AS label, sum(e.amount) AS value FROM expenses e ${yw.sql} GROUP BY 1 ORDER BY 2 DESC`, yw.params),
  ]);
  return { flow, byCategory };
}

export async function createExpense(req: Request, input: any) {
  const submittedBy = input.submittedBy ?? req.user!.employeeId;
  if (!submittedBy) throw badRequest('Choose the employee who raised this expense', 'SUBMITTER_REQUIRED', [{ field: 'submittedBy', message: 'Required' }]);
  return tx(async (db) => {
    await query(`SELECT pg_advisory_xact_lock(hashtext('expenses.code'))`, [], db);
    const code = await nextCode('expenses', 'code', 'EXP-', db);
    const row = await one(
      `INSERT INTO expenses (code, campus_id, category, description, amount, vendor_id, expense_date, status, submitted_by, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, code, status`,
      [code, input.campusId, input.category, input.description, input.amount, input.vendorId ?? null, input.expenseDate,
        input.submit ? 'Submitted' : 'Draft', submittedBy, req.user!.id], db);
    await audit(req, { action: 'create', module: 'finance', entityType: 'expense', entityId: row!.id, description: `Raised expense ${code} — ${input.description} (${inr(input.amount)})` }, db);
    if (input.submit) {
      await notifyRoles(['finance', 'super_admin'], {
        category: 'Attention', topic: 'finance', icon: 'fileText', title: `Expense ${code} awaiting approval`,
        body: `${input.description} — ${inr(input.amount)}`, route: '/expenses', entityType: 'expense', entityId: row!.id,
      }, db);
    }
    return row;
  });
}

export async function transitionExpense(req: Request, id: string, t: Transition, reason?: string) {
  return tx(async (db) => {
    const e = await one('SELECT * FROM expenses WHERE id = $1 FOR UPDATE', [id], db);
    if (!e) throw notFound('Expense not found');
    if (!FROM_STATES[t].includes(e.status)) throw conflict(`Expense ${e.code} is ${e.status} and cannot be moved to ${TO_STATE[t]}`, 'INVALID_STATE');
    const decided = t === 'approve' || t === 'reject';
    const row = await one(
      `UPDATE expenses SET status = $2,
              approved_by = CASE WHEN $3 THEN $4::uuid ELSE approved_by END,
              approved_at = CASE WHEN $3 THEN now() ELSE approved_at END,
              rejection_reason = CASE WHEN $2 = 'Rejected' THEN $5 ELSE rejection_reason END
        WHERE id = $1 RETURNING id, code, status`,
      [id, TO_STATE[t], decided, req.user!.id, reason ?? null], db);
    await audit(req, {
      action: t === 'approve' ? 'approve' : t === 'reject' ? 'reject' : 'update', module: 'finance', entityType: 'expense', entityId: id,
      description: `Expense ${e.code} ${TO_STATE[t].toLowerCase()}${reason ? `: ${reason}` : ''}`,
    }, db);
    const uid = await employeeUser(e.submitted_by);
    if (uid && t !== 'submit') {
      await notifyUsers([uid], {
        category: t === 'reject' ? 'Attention' : 'Information', topic: 'finance', icon: 'fileText',
        title: `Expense ${e.code} ${TO_STATE[t].toLowerCase()}`, body: reason ?? e.description, route: '/expenses', entityType: 'expense', entityId: id,
      }, db);
    }
    return row;
  });
}

// ---------------------------------------------------------------------------
// Reimbursements
// ---------------------------------------------------------------------------
const RMB_SORT: Record<string, string> = { date: 'r.claim_date', amount: 'r.amount', code: 'r.code', status: 'r.status', employee: 'emp.full_name' };

export async function listReimbursements(f: any) {
  const w = new Where();
  w.addIf(f.campusId, 'emp.campus_id = ?');
  w.addIf(f.status, 'r.status = ?');
  w.addIf(f.claimType, 'r.claim_type = ?');
  if (f.q) w.add('(r.code ILIKE ? OR r.description ILIKE ? OR emp.full_name ILIKE ?)', likeTerm(f.q), likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT r.id, r.code, r.claim_type AS "claimType", r.description, r.amount, r.claim_date AS "claimDate", r.status,
            r.approved_at AS "decidedAt", au.full_name AS "decidedBy", r.paid_in_run_id AS "payrollRunId",
            emp.id AS "employeeId", emp.full_name AS employee, emp.department, cp.short_name AS campus,
            count(*) OVER() AS total
       FROM reimbursements r JOIN employees emp ON emp.id = r.employee_id JOIN campuses cp ON cp.id = emp.campus_id
       LEFT JOIN users au ON au.id = r.approved_by
       ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, RMB_SORT, 'date')}, r.code DESC
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`, w.params);
  return page(rows);
}

export async function reimbursementSummary(campusId?: string) {
  const w = new Where();
  w.addIf(campusId, 'emp.campus_id = ?');
  return one(
    `SELECT count(*) FILTER (WHERE r.status IN ('Submitted', 'Under Review'))::int AS pending,
            COALESCE(sum(r.amount) FILTER (WHERE r.status IN ('Submitted', 'Under Review')), 0) AS "pendingValue",
            COALESCE(sum(r.amount) FILTER (WHERE r.status = 'Approved'), 0) AS "approvedUnpaid",
            COALESCE(sum(r.amount) FILTER (WHERE r.status = 'Paid' AND r.updated_at >= date_trunc('month', now())), 0) AS "paidThisMonth",
            count(*) FILTER (WHERE r.status = 'Rejected')::int AS rejected
       FROM reimbursements r JOIN employees emp ON emp.id = r.employee_id ${w.sql}`, w.params);
}

export async function createReimbursement(req: Request, input: any) {
  return tx(async (db) => {
    const emp = await one('SELECT id, full_name FROM employees WHERE id = $1 AND deleted_at IS NULL', [input.employeeId], db);
    if (!emp) throw badRequest('Employee not found', 'EMPLOYEE_NOT_FOUND');
    await query(`SELECT pg_advisory_xact_lock(hashtext('reimbursements.code'))`, [], db);
    const code = await nextCode('reimbursements', 'code', 'RMB-', db, 3);
    const row = await one(
      `INSERT INTO reimbursements (code, employee_id, claim_type, description, amount, claim_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,'Submitted') RETURNING id, code, status`,
      [code, input.employeeId, input.claimType, input.description, input.amount, input.claimDate], db);
    await audit(req, { action: 'create', module: 'finance', entityType: 'reimbursement', entityId: row!.id, description: `Recorded claim ${code} for ${emp.full_name} (${inr(input.amount)})` }, db);
    return row;
  });
}

export async function transitionReimbursement(req: Request, id: string, t: Transition, opts: { reason?: string; payrollRunId?: string } = {}) {
  return tx(async (db) => {
    const r = await one('SELECT * FROM reimbursements WHERE id = $1 FOR UPDATE', [id], db);
    if (!r) throw notFound('Reimbursement not found');
    if (!FROM_STATES[t].includes(r.status)) throw conflict(`Claim ${r.code} is ${r.status} and cannot be moved to ${TO_STATE[t]}`, 'INVALID_STATE');
    if (opts.payrollRunId) {
      const run = await one('SELECT id FROM payroll_runs WHERE id = $1', [opts.payrollRunId], db);
      if (!run) throw badRequest('Payroll run not found', 'PAYROLL_RUN_NOT_FOUND');
    }
    const decided = t === 'approve' || t === 'reject';
    const row = await one(
      `UPDATE reimbursements SET status = $2,
              approved_by = CASE WHEN $3 THEN $4::uuid ELSE approved_by END,
              approved_at = CASE WHEN $3 THEN now() ELSE approved_at END,
              paid_in_run_id = COALESCE($5::uuid, paid_in_run_id)
        WHERE id = $1 RETURNING id, code, status`,
      [id, TO_STATE[t], decided, req.user!.id, opts.payrollRunId ?? null], db);
    await audit(req, {
      action: t === 'approve' ? 'approve' : t === 'reject' ? 'reject' : 'update', module: 'finance', entityType: 'reimbursement', entityId: id,
      description: `Claim ${r.code} ${TO_STATE[t].toLowerCase()}${opts.reason ? `: ${opts.reason}` : ''}`,
    }, db);
    const uid = await employeeUser(r.employee_id);
    if (uid) {
      await notifyUsers([uid], {
        category: t === 'reject' ? 'Attention' : 'Information', topic: 'finance', icon: 'refresh',
        title: `Reimbursement ${r.code} ${TO_STATE[t].toLowerCase()}`, body: opts.reason ?? `${r.description} — ${inr(r.amount)}`,
        entityType: 'reimbursement', entityId: id,
      }, db);
    }
    return row;
  });
}

// ---------------------------------------------------------------------------
// Allowances (feed the monthly payroll run)
// ---------------------------------------------------------------------------
export async function allowanceSummary(campusId?: string) {
  const w = new Where().add(`a.status <> 'Stopped'`);
  w.addIf(campusId, 'e.campus_id = ?');
  return many(
    `SELECT a.allowance_type AS "allowanceType",
            string_agg(DISTINCT e.category, ', ' ORDER BY e.category) AS "appliesTo",
            count(DISTINCT a.employee_id)::int AS employees,
            min(a.amount) AS "minAmount", max(a.amount) AS "maxAmount",
            round(avg(CASE WHEN e.basic_salary > 0 THEN a.amount / e.basic_salary * 100 END)) AS "pctOfBasic",
            COALESCE(sum(a.amount) FILTER (WHERE a.frequency = 'Monthly' AND a.status = 'Approved'), 0) AS "monthlyCost",
            COALESCE(sum(a.amount) FILTER (WHERE a.status = 'Submitted'), 0) AS "pendingCost",
            max(a.frequency) AS frequency, max(a.effective_month) AS "effectiveMonth",
            CASE WHEN bool_or(a.status = 'Submitted') THEN 'Under Review'
                 WHEN bool_and(a.status = 'Rejected') THEN 'Rejected' ELSE 'Active' END AS status,
            count(*) FILTER (WHERE a.status = 'Submitted')::int AS "pendingCount"
       FROM allowances a JOIN employees e ON e.id = a.employee_id
       ${w.sql}
      GROUP BY a.allowance_type
      ORDER BY "monthlyCost" DESC, a.allowance_type`, w.params);
}

export async function listAllowances(f: any) {
  const w = new Where();
  w.addIf(f.campusId, 'e.campus_id = ?');
  w.addIf(f.allowanceType, 'a.allowance_type = ?');
  w.addIf(f.status, 'a.status = ?');
  if (f.q) w.add('(e.full_name ILIKE ? OR a.allowance_type ILIKE ?)', likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT a.id, a.allowance_type AS "allowanceType", a.amount, a.frequency, a.effective_month AS "effectiveMonth", a.status,
            e.id AS "employeeId", e.full_name AS employee, e.category, e.department, count(*) OVER() AS total
       FROM allowances a JOIN employees e ON e.id = a.employee_id ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, { employee: 'e.full_name', amount: 'a.amount', type: 'a.allowance_type', status: 'a.status' }, 'employee')}
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`, w.params);
  return page(rows);
}

export async function createAllowance(req: Request, input: any) {
  const w = new Where().add('e.deleted_at IS NULL').add(`e.employment_status = 'active'`);
  if (input.employeeIds) w.add('e.id = ANY(?)', input.employeeIds);
  w.addIf(input.category, 'e.category = ?');
  if (input.employeeType && input.employeeType !== 'all') w.add('e.employee_type = ?', input.employeeType);
  w.addIf(input.campusId, 'e.campus_id = ?');
  const emps = await many<{ id: string; basic_salary: number }>(`SELECT e.id, e.basic_salary FROM employees e ${w.sql}`, w.params);
  if (!emps.length) throw badRequest('No active employees match this selection', 'NO_EMPLOYEES');
  const month = String(input.effectiveMonth).slice(0, 7) + '-01';
  return tx(async (db) => {
    const dup = await one(
      `SELECT count(*)::int AS n FROM allowances WHERE allowance_type = $1 AND employee_id = ANY($2) AND status IN ('Submitted', 'Approved')`,
      [input.allowanceType, emps.map((e) => e.id)], db);
    if (dup!.n > 0) throw conflict(`${dup!.n} of these employees already receive "${input.allowanceType}"`, 'ALLOWANCE_EXISTS');
    for (const e of emps) {
      const amount = input.amount ?? Math.round(Number(e.basic_salary) * input.percentOfBasic) / 100;
      await query(
        `INSERT INTO allowances (employee_id, allowance_type, amount, frequency, effective_month, status) VALUES ($1,$2,$3,$4,$5,'Submitted')`,
        [e.id, input.allowanceType, amount, input.frequency, month], db);
    }
    await audit(req, {
      action: 'create', module: 'finance', entityType: 'allowance',
      description: `Proposed "${input.allowanceType}" for ${emps.length} employee(s)`, metadata: { ...input, employees: emps.length },
    }, db);
    return { employees: emps.length, status: 'Submitted' };
  });
}

export async function decideAllowance(req: Request, input: { allowanceType: string; decision: string; campusId?: string }) {
  const from = input.decision === 'Stopped' ? ['Approved'] : ['Submitted'];
  return tx(async (db) => {
    const r = await query(
      `UPDATE allowances a SET status = $1 FROM employees e
        WHERE e.id = a.employee_id AND a.allowance_type = $2 AND a.status = ANY($3) AND ($4::uuid IS NULL OR e.campus_id = $4)`,
      [input.decision, input.allowanceType, from, input.campusId ?? null], db);
    if (!r.rowCount) throw conflict(`There are no ${from.join('/').toLowerCase()} "${input.allowanceType}" allowances to update`, 'INVALID_STATE');
    await audit(req, {
      action: input.decision === 'Approved' ? 'approve' : input.decision === 'Rejected' ? 'reject' : 'update', module: 'finance',
      entityType: 'allowance', description: `${input.decision} "${input.allowanceType}" for ${r.rowCount} employee(s)`,
    }, db);
    return { updated: r.rowCount };
  });
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------
export async function budgets(campusId?: string) {
  const y = await one<{ starts_on: string; ends_on: string; elapsed: number }>(
    `SELECT starts_on, ends_on,
            LEAST(1, GREATEST(0.01, (current_date - starts_on)::numeric / NULLIF(ends_on - starts_on, 0))) AS elapsed
       FROM academic_years WHERE is_current`);
  if (!y) throw badRequest('No current academic year is configured', 'NO_CURRENT_YEAR');
  const rows = await many(
    `WITH b AS (
       SELECT category, sum(allocated) AS allocated, string_agg(DISTINCT owner, ', ') AS owner,
              CASE WHEN count(*) = 1 THEN min(id::text) END AS id
         FROM budgets WHERE academic_year_id = ${YEAR} AND ($1::uuid IS NULL OR campus_id = $1)
        GROUP BY category),
     x AS (
       SELECT category,
              sum(amount) FILTER (WHERE status IN ('Approved', 'Paid')) AS actual,
              sum(amount) FILTER (WHERE status IN ('Submitted', 'Under Review')) AS committed
         FROM expenses WHERE expense_date >= $2 AND expense_date <= $3 AND ($1::uuid IS NULL OR campus_id = $1)
        GROUP BY category)
     SELECT COALESCE(b.category, x.category) AS category, b.id, COALESCE(b.allocated, 0) AS allocated, b.owner,
            COALESCE(x.actual, 0) AS actual, COALESCE(x.committed, 0) AS committed
       FROM b FULL JOIN x ON x.category = b.category
      ORDER BY COALESCE(b.allocated, 0) DESC`,
    [campusId ?? null, y.starts_on, y.ends_on]);
  const elapsed = Number(y.elapsed);
  const out = rows.map((r) => {
    const projected = Math.round(Number(r.actual) / elapsed);
    return { ...r, projected, variance: projected - Number(r.allocated), utilisation: r.allocated ? Math.round((Number(r.actual) / Number(r.allocated)) * 100) : null };
  });
  const sum = (k: string) => out.reduce((a, r: any) => a + Number(r[k]), 0);
  const worst = [...out].sort((a, b) => b.variance - a.variance)[0];
  return {
    kpis: {
      allocated: sum('allocated'), spent: sum('actual'), committed: sum('committed'),
      projectedVariance: sum('projected') - sum('allocated'),
      yearElapsedPct: Math.round(elapsed * 100),
      overBudget: worst && worst.variance > 0 ? { category: worst.category, variance: worst.variance } : null,
    },
    rows: out,
  };
}

export async function upsertBudget(req: Request, input: any) {
  return tx(async (db) => {
    const row = await one(
      `INSERT INTO budgets (academic_year_id, campus_id, category, allocated, owner)
       VALUES (${YEAR}, $1, $2, $3, $4)
       ON CONFLICT (academic_year_id, campus_id, category) DO UPDATE SET allocated = EXCLUDED.allocated, owner = COALESCE(EXCLUDED.owner, budgets.owner)
       RETURNING id, category, allocated, owner`,
      [input.campusId, input.category, input.allocated, input.owner ?? null], db);
    await audit(req, { action: 'update', module: 'finance', entityType: 'budget', entityId: row!.id, description: `Set ${input.category} budget to ${inr(input.allocated)}` }, db);
    return row;
  });
}

export async function updateBudget(req: Request, id: string, input: any) {
  return tx(async (db) => {
    const row = await one(
      `UPDATE budgets SET allocated = COALESCE($2, allocated), owner = COALESCE($3, owner) WHERE id = $1 RETURNING id, category, allocated, owner`,
      [id, input.allocated ?? null, input.owner ?? null], db);
    if (!row) throw notFound('Budget not found');
    await audit(req, { action: 'update', module: 'finance', entityType: 'budget', entityId: id, description: `Updated ${row.category} budget`, metadata: input }, db);
    return row;
  });
}

// ---------------------------------------------------------------------------
// Scholarships (schemes; individual awards are concessions)
// ---------------------------------------------------------------------------
export async function listScholarships() {
  return many(
    `SELECT id, name, criteria, amount, seats, awarded, status, created_at AS "createdAt"
       FROM scholarships WHERE academic_year_id = ${YEAR} ORDER BY status, name`);
}

export async function createScholarship(req: Request, input: any) {
  return tx(async (db) => {
    const row = await one(
      `INSERT INTO scholarships (name, criteria, amount, seats, academic_year_id, status) VALUES ($1,$2,$3,$4,${YEAR},'Open') RETURNING id, name, status`,
      [input.name, input.criteria ?? null, input.amount, input.seats], db);
    await audit(req, { action: 'create', module: 'finance', entityType: 'scholarship', entityId: row!.id, description: `Opened scholarship round "${input.name}"` }, db);
    return row;
  });
}

export async function updateScholarship(req: Request, id: string, status: string) {
  const row = await one('UPDATE scholarships SET status = $2 WHERE id = $1 RETURNING id, name, status', [id, status]);
  if (!row) throw notFound('Scholarship not found');
  await audit(req, { action: 'update', module: 'finance', entityType: 'scholarship', entityId: id, description: `Scholarship "${row.name}" marked ${status}` });
  return row;
}

// ---------------------------------------------------------------------------
// Reconciliation — bank / gateway statement lines against fee payments
// ---------------------------------------------------------------------------
export async function reconSummary() {
  return one(
    `WITH latest AS (SELECT max(statement_date) AS d FROM bank_statement_lines)
     SELECT (SELECT d FROM latest) AS "latestDate",
            count(*) FILTER (WHERE l.status = 'Matched' AND l.statement_date = (SELECT d FROM latest))::int AS "matchedLatest",
            count(*) FILTER (WHERE l.status = 'Exception')::int AS exceptions,
            count(*) FILTER (WHERE l.status = 'Unmatched')::int AS unmatched,
            count(*) FILTER (WHERE l.status = 'Matched')::int AS matched,
            COALESCE(sum(l.amount) FILTER (WHERE l.statement_date = (SELECT d FROM latest)), 0) AS "settlementLatest",
            (SELECT COALESCE(sum(p.amount), 0) FROM fee_payments p
              WHERE p.status = 'Success' AND NOT p.reconciled AND p.method IN ('UPI', 'Card', 'Net Banking')
                AND p.paid_at >= current_date - 3
                AND NOT EXISTS (SELECT 1 FROM bank_statement_lines b WHERE b.reference = p.gateway_ref)) AS "inTransit"
       FROM bank_statement_lines l`);
}

export async function listReconLines(f: any) {
  const w = new Where();
  w.addIf(f.status, 'l.status = ?');
  w.addIf(f.from, 'l.statement_date >= ?');
  w.addIf(f.to, 'l.statement_date <= ?');
  if (f.q) w.add('(l.reference ILIKE ? OR l.note ILIKE ? OR p.receipt_no ILIKE ?)', likeTerm(f.q), likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT l.id, l.statement_date AS "statementDate", l.reference, l.amount, l.channel, l.status, l.note,
            p.id AS "paymentId", p.receipt_no AS "receiptNo", p.amount AS "paymentAmount",
            s.id AS "studentId", s.full_name AS "studentName", l.updated_at AS "updatedAt",
            count(*) OVER() AS total
       FROM bank_statement_lines l
       LEFT JOIN fee_payments p ON p.id = l.matched_payment_id
       LEFT JOIN students s ON s.id = p.student_id
       ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, { date: 'l.statement_date', amount: 'l.amount', status: 'l.status', reference: 'l.reference' }, 'date')},
               array_position(ARRAY['Exception', 'Unmatched', 'Resolved', 'Matched'], l.status), l.reference
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`, w.params);
  return page(rows);
}

export async function reconCandidates(lineId: string) {
  const l = await one('SELECT * FROM bank_statement_lines WHERE id = $1', [lineId]);
  if (!l) throw notFound('Statement line not found');
  return many(
    `SELECT p.id, p.receipt_no AS "receiptNo", p.amount, p.method, p.gateway_ref AS "gatewayRef", p.paid_at AS "paidAt",
            s.full_name AS "studentName", s.admission_no AS "admissionNo",
            (p.gateway_ref = $2) AS "referenceMatch", abs(p.amount - $3) AS "amountDiff"
       FROM fee_payments p JOIN students s ON s.id = p.student_id
      WHERE p.status = 'Success' AND NOT p.reconciled
        AND (p.gateway_ref = $2 OR (abs(p.amount - $3) <= 500 AND p.paid_at BETWEEN $4::date - 7 AND $4::date + 2))
        AND NOT EXISTS (SELECT 1 FROM bank_statement_lines b WHERE b.matched_payment_id = p.id AND b.id <> $1)
      ORDER BY (p.gateway_ref = $2) DESC, abs(p.amount - $3), p.paid_at DESC LIMIT 10`,
    [lineId, l.reference, l.amount, l.statement_date]);
}

/** Auto-matches open lines: same reference and amount → Matched; same reference, different amount → Exception. */
export async function runReconciliation(req: Request) {
  return tx(async (db) => {
    const lines = await many(
      `SELECT l.id, l.reference, l.amount, p.id AS payment_id, p.amount AS payment_amount, p.reconciled
         FROM bank_statement_lines l
         LEFT JOIN fee_payments p ON p.gateway_ref = l.reference AND p.status = 'Success'
        WHERE l.status = 'Unmatched' FOR UPDATE OF l`, [], db);
    let matched = 0, exceptions = 0;
    for (const l of lines) {
      if (l.payment_id && !l.reconciled && Number(l.payment_amount) === Number(l.amount)) {
        await query(`UPDATE bank_statement_lines SET status = 'Matched', matched_payment_id = $2, note = 'Auto-matched on reference and amount' WHERE id = $1`, [l.id, l.payment_id], db);
        await query('UPDATE fee_payments SET reconciled = true, reconciled_at = now() WHERE id = $1', [l.payment_id], db);
        matched++;
      } else {
        const note = l.payment_id
          ? (l.reconciled ? 'Reference already reconciled against another line' : `Settlement amount differs by ${inr(Math.abs(Number(l.payment_amount) - Number(l.amount)))} from receipt amount`)
          : 'Payment received, no matching receipt in the fee ledger';
        await query(`UPDATE bank_statement_lines SET status = 'Exception', note = $2 WHERE id = $1`, [l.id, note], db);
        exceptions++;
      }
    }
    await audit(req, { action: 'update', module: 'finance', entityType: 'reconciliation', description: `Reconciliation run — ${matched} matched, ${exceptions} exception(s)`, metadata: { matched, exceptions } }, db);
    if (exceptions) {
      await notifyRoles(['finance'], {
        category: 'Attention', topic: 'finance', icon: 'check', title: `Reconciliation: ${exceptions} exception(s) need attention`, route: '/reconciliation',
      }, db);
    }
    return { processed: lines.length, matched, exceptions };
  });
}

export async function matchLine(req: Request, lineId: string, paymentId: string, note?: string) {
  return tx(async (db) => {
    const l = await one('SELECT * FROM bank_statement_lines WHERE id = $1 FOR UPDATE', [lineId], db);
    if (!l) throw notFound('Statement line not found');
    if (l.status === 'Matched') throw conflict('This line is already matched', 'INVALID_STATE');
    const p = await one(`SELECT id, receipt_no, amount, reconciled FROM fee_payments WHERE id = $1 AND status = 'Success' FOR UPDATE`, [paymentId], db);
    if (!p) throw badRequest('Payment not found', 'PAYMENT_NOT_FOUND');
    if (p.reconciled) throw conflict(`Receipt ${p.receipt_no} is already reconciled`, 'ALREADY_RECONCILED');
    const diff = Number(l.amount) - Number(p.amount);
    const text = note ?? (diff ? `Matched manually to ${p.receipt_no}; difference ${inr(diff)} noted` : `Matched manually to ${p.receipt_no}`);
    await query(`UPDATE bank_statement_lines SET status = 'Matched', matched_payment_id = $2, note = $3 WHERE id = $1`, [lineId, paymentId, text], db);
    await query('UPDATE fee_payments SET reconciled = true, reconciled_at = now() WHERE id = $1', [paymentId], db);
    await audit(req, { action: 'update', module: 'finance', entityType: 'bank_statement_line', entityId: lineId, description: `Statement line ${l.reference} matched to ${p.receipt_no}`, metadata: { diff } }, db);
    return { id: lineId, status: 'Matched' };
  });
}

export async function flagLine(req: Request, lineId: string, status: 'Exception' | 'Resolved', note: string) {
  const allowed = status === 'Exception' ? ['Unmatched', 'Matched'] : ['Exception', 'Unmatched'];
  return tx(async (db) => {
    const l = await one('SELECT * FROM bank_statement_lines WHERE id = $1 FOR UPDATE', [lineId], db);
    if (!l) throw notFound('Statement line not found');
    if (!allowed.includes(l.status)) throw conflict(`A ${l.status.toLowerCase()} line cannot be marked ${status.toLowerCase()}`, 'INVALID_STATE');
    if (status === 'Exception' && l.matched_payment_id) {
      await query('UPDATE fee_payments SET reconciled = false, reconciled_at = NULL WHERE id = $1', [l.matched_payment_id], db);
    }
    await query(
      `UPDATE bank_statement_lines SET status = $2, note = $3, matched_payment_id = CASE WHEN $2 = 'Exception' THEN NULL ELSE matched_payment_id END WHERE id = $1`,
      [lineId, status, note], db);
    await audit(req, { action: 'update', module: 'finance', entityType: 'bank_statement_line', entityId: lineId, description: `Statement line ${l.reference} marked ${status}: ${note}` }, db);
    return { id: lineId, status };
  });
}

// ---------------------------------------------------------------------------
// Standard reports (tabular; the web app exports them to CSV)
// ---------------------------------------------------------------------------
type Col = { key: string; label: string; money?: boolean };
const C = (key: string, label: string, money = false): Col => ({ key, label, money });

export async function report(req: Request, key: string, campusId?: string) {
  const cp = campusId ?? null;
  let title = '';
  let columns: Col[] = [];
  let rows: any[] = [];
  switch (key) {
    case 'fee-collection':
      title = 'Fee collection summary';
      columns = [C('campus', 'Campus'), C('head', 'Fee head'), C('billed', 'Billed', true), C('collected', 'Collected', true), C('outstanding', 'Outstanding', true), C('rate', 'Collection %')];
      rows = await many(
        `SELECT cp.short_name AS campus, fh.name AS head, sum(${NET()}) AS billed, sum(f.amount_paid) AS collected, sum(${BAL()}) AS outstanding,
                round(100.0 * sum(f.amount_paid) / NULLIF(sum(${NET()}), 0), 1) AS rate
           FROM student_fees f JOIN students s ON s.id = f.student_id JOIN campuses cp ON cp.id = s.campus_id JOIN fee_heads fh ON fh.id = f.fee_head_id
          WHERE f.academic_year_id = ${YEAR} AND ($1::uuid IS NULL OR s.campus_id = $1)
          GROUP BY cp.short_name, cp.established, fh.name ORDER BY cp.established, billed DESC`, [cp]);
      break;
    case 'ageing':
      title = 'Ageing analysis';
      columns = [C('campus', 'Campus'), C('grade', 'Grade'), C('d30', '0–30 days', true), C('d60', '31–60 days', true), C('d90', '61–90 days', true), C('d90plus', '90+ days', true), C('accounts', 'Accounts')];
      rows = await many(
        `SELECT cp.short_name AS campus, c.name AS grade,
                COALESCE(sum(${BAL()}) FILTER (WHERE current_date - f.due_date BETWEEN 1 AND 30), 0) AS d30,
                COALESCE(sum(${BAL()}) FILTER (WHERE current_date - f.due_date BETWEEN 31 AND 60), 0) AS d60,
                COALESCE(sum(${BAL()}) FILTER (WHERE current_date - f.due_date BETWEEN 61 AND 90), 0) AS d90,
                COALESCE(sum(${BAL()}) FILTER (WHERE current_date - f.due_date > 90), 0) AS d90plus,
                count(DISTINCT s.id)::int AS accounts
           FROM student_fees f JOIN students s ON s.id = f.student_id JOIN campuses cp ON cp.id = s.campus_id
           JOIN sections sec ON sec.id = s.section_id JOIN classes c ON c.id = sec.class_id
          WHERE f.academic_year_id = ${YEAR} AND ${BAL()} > 0 AND f.due_date < current_date AND ($1::uuid IS NULL OR s.campus_id = $1)
          GROUP BY cp.short_name, cp.established, c.name, c.grade_level ORDER BY cp.established, c.grade_level`, [cp]);
      break;
    case 'cash-flow':
      title = 'Cash flow forecast';
      columns = [C('month', 'Month'), C('expected', 'Expected receipts', true), C('overdueCarried', 'Overdue carried forward', true), C('charges', 'Open charges')];
      rows = await many(
        `SELECT to_char(date_trunc('month', GREATEST(f.due_date, current_date)), 'Mon YYYY') AS month,
                sum(${BAL()}) FILTER (WHERE f.due_date >= current_date) AS expected,
                sum(${BAL()}) FILTER (WHERE f.due_date < current_date) AS "overdueCarried",
                count(*)::int AS charges
           FROM student_fees f JOIN students s ON s.id = f.student_id
          WHERE f.academic_year_id = ${YEAR} AND ${BAL()} > 0 AND ($1::uuid IS NULL OR s.campus_id = $1)
          GROUP BY date_trunc('month', GREATEST(f.due_date, current_date)) ORDER BY date_trunc('month', GREATEST(f.due_date, current_date))`, [cp]);
      break;
    case 'concessions':
      title = 'Concession and scholarship report';
      columns = [C('type', 'Type'), C('status', 'Status'), C('students', 'Students'), C('value', 'Value', true), C('approver', 'Decided by')];
      rows = await many(
        `SELECT k.concession_type AS type, k.status, count(DISTINCT k.student_id)::int AS students, sum(k.amount) AS value,
                COALESCE(u.full_name, '—') AS approver
           FROM concessions k JOIN students s ON s.id = k.student_id LEFT JOIN users u ON u.id = k.approved_by
          WHERE k.academic_year_id = ${YEAR} AND ($1::uuid IS NULL OR s.campus_id = $1)
          GROUP BY k.concession_type, k.status, u.full_name ORDER BY 1, 2`, [cp]);
      break;
    case 'expense-budget': {
      title = 'Expense and budget report';
      columns = [C('category', 'Category'), C('allocated', 'Budget', true), C('actual', 'Actual', true), C('committed', 'Committed', true), C('projected', 'Projected', true), C('variance', 'Projected variance', true), C('owner', 'Owner')];
      rows = (await budgets(campusId)).rows;
      break;
    }
    case 'payroll-cost':
      title = 'Payroll cost report';
      columns = [C('month', 'Month'), C('campus', 'Campus'), C('status', 'Status'), C('employees', 'Employees'), C('gross', 'Gross', true), C('deductions', 'Deductions', true), C('allowances', 'Allowances', true), C('net', 'Net', true)];
      rows = await many(
        `SELECT to_char(r.pay_month, 'Mon YYYY') AS month, COALESCE(cp.short_name, 'All campuses') AS campus, r.status,
                r.employee_count AS employees, r.gross_total AS gross, r.deductions_total AS deductions,
                r.allowances_total AS allowances, r.net_total AS net
           FROM payroll_runs r LEFT JOIN campuses cp ON cp.id = r.campus_id
          WHERE ($1::uuid IS NULL OR r.campus_id = $1 OR r.campus_id IS NULL)
          ORDER BY r.pay_month DESC, cp.short_name LIMIT 60`, [cp]);
      break;
    case 'reconciliation':
      title = 'Reconciliation log';
      columns = [C('date', 'Statement date'), C('reference', 'Reference'), C('channel', 'Channel'), C('amount', 'Amount', true), C('status', 'Status'), C('receipt', 'Receipt'), C('note', 'Note')];
      rows = await many(
        `SELECT l.statement_date AS date, l.reference, l.channel, l.amount, l.status, COALESCE(p.receipt_no, '—') AS receipt, COALESCE(l.note, '') AS note
           FROM bank_statement_lines l LEFT JOIN fee_payments p ON p.id = l.matched_payment_id
          ORDER BY l.statement_date DESC, l.reference LIMIT 1000`);
      break;
    case 'campus-comparison':
      title = 'Campus comparison';
      columns = [C('campus', 'Campus'), C('students', 'Students'), C('billed', 'Billed', true), C('collected', 'Collected', true), C('outstanding', 'Outstanding', true), C('rate', 'Collection %'), C('concessions', 'Concessions', true), C('expenses', 'Approved expenses', true), C('budget', 'Budget', true)];
      rows = await many(
        `SELECT cp.short_name AS campus,
                (SELECT count(*)::int FROM students s WHERE s.campus_id = cp.id AND s.status = 'active' AND s.deleted_at IS NULL) AS students,
                COALESCE(fx.billed, 0) AS billed, COALESCE(fx.collected, 0) AS collected, COALESCE(fx.outstanding, 0) AS outstanding,
                round(100.0 * fx.collected / NULLIF(fx.billed, 0), 1) AS rate,
                (SELECT COALESCE(sum(k.amount), 0) FROM concessions k JOIN students s ON s.id = k.student_id
                  WHERE s.campus_id = cp.id AND k.status = 'Approved' AND k.academic_year_id = ${YEAR}) AS concessions,
                (SELECT COALESCE(sum(e.amount), 0) FROM expenses e WHERE e.campus_id = cp.id AND e.status IN ('Approved', 'Paid')
                    AND e.expense_date >= (SELECT starts_on FROM academic_years WHERE is_current)) AS expenses,
                (SELECT COALESCE(sum(b.allocated), 0) FROM budgets b WHERE b.campus_id = cp.id AND b.academic_year_id = ${YEAR}) AS budget
           FROM campuses cp
           LEFT JOIN LATERAL (
             SELECT sum(${NET()}) AS billed, sum(f.amount_paid) AS collected, sum(${BAL()}) AS outstanding
               FROM student_fees f JOIN students s ON s.id = f.student_id
              WHERE s.campus_id = cp.id AND f.academic_year_id = ${YEAR}) fx ON true
          WHERE cp.is_active ORDER BY cp.established`);
      break;
    case 'audit-pack':
      title = 'Audit pack — finance activity log';
      columns = [C('at', 'When'), C('user', 'User'), C('role', 'Role'), C('action', 'Action'), C('entity', 'Entity'), C('description', 'Description')];
      rows = await many(
        `SELECT a.created_at AS at, a.user_name AS user, a.role_key AS role, a.action, COALESCE(a.entity_type, '') AS entity, a.description
           FROM audit_logs a WHERE a.module = 'finance' ORDER BY a.created_at DESC LIMIT 2000`);
      break;
    default:
      throw notFound('Report not found');
  }
  await audit(req, { action: 'export', module: 'finance', entityType: 'report', description: `Generated report: ${title}`, metadata: { key, campusId: cp } });
  return { key, title, generatedAt: new Date().toISOString(), columns, rows };
}
