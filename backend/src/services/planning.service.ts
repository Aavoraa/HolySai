import type { Request } from 'express';
import { many, one, query, tx, type Queryable } from '../config/db.js';
import { Where } from '../utils/sql.js';
import { likeTerm, limitOffset, orderBy } from '../utils/pagination.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { nextCode } from '../utils/codes.js';
import { audit } from './audit.service.js';
import { notifyRoles, notifyUsers } from './notification.service.js';
import { assertDecider } from './approvals-guard.js';

/**
 * Budget & Planning — departments prepare budget plans with line items and submit
 * them; only the Super Admin (approvals.decide) approves or rejects.
 * Workflow: Draft → Submitted → Under Review → Approved / Rejected (Rejected → reopen → Draft).
 * An approval adds the approved amount to the matching budgets row
 * (academic year + campus + category), creating it when missing.
 */

const CURRENT_YEAR = `(SELECT id FROM academic_years WHERE is_current)`;
const inr = (v: number) => '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const page = <T extends { total?: number }>(rows: T[]) => ({ rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 });

type Line = { item: string; quantity: number; unitCost: number; notes?: string };
const lineAmount = (l: Line) => Math.round(Number(l.quantity) * Number(l.unitCost) * 100) / 100;

async function event(db: Queryable, req: Request, planId: string, action: string, from: string | null, to: string | null, note?: string | null, amount?: number | null) {
  await query(
    `INSERT INTO budget_plan_events (plan_id, action, from_status, to_status, amount, note, actor_id, actor_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [planId, action, from, to, amount ?? null, note ?? null, req.user!.id, req.user!.fullName], db);
}

// ---------------------------------------------------------------------------
// Lookups & summary
// ---------------------------------------------------------------------------
export async function lookups() {
  const [categories, departments, years] = await Promise.all([
    many<{ category: string }>(`SELECT DISTINCT category FROM budgets UNION SELECT DISTINCT category FROM expenses UNION SELECT DISTINCT category FROM budget_plans ORDER BY 1`)
      .then((r) => r.map((x) => x.category)),
    many<{ department: string }>(
      `SELECT DISTINCT department FROM employees WHERE department IS NOT NULL AND deleted_at IS NULL
       UNION SELECT DISTINCT department FROM budget_plans ORDER BY 1`).then((r) => r.map((x) => x.department)),
    many(`SELECT id, label, starts_on AS "startsOn", ends_on AS "endsOn", is_current AS "isCurrent" FROM academic_years ORDER BY starts_on DESC`),
  ]);
  return { categories, departments, academicYears: years, statuses: ['Draft', 'Submitted', 'Under Review', 'Approved', 'Rejected'] };
}

export async function summary(f: { campusId?: string; academicYearId?: string }) {
  const w = new Where().add(`p.academic_year_id = COALESCE(?::uuid, ${CURRENT_YEAR})`, f.academicYearId ?? null);
  w.addIf(f.campusId, 'p.campus_id = ?');
  const [k, byCategory, byStatus] = await Promise.all([
    one(
      `SELECT COALESCE(sum(p.amount_requested) FILTER (WHERE p.status <> 'Draft'), 0) AS requested,
              COALESCE(sum(p.amount_approved) FILTER (WHERE p.status = 'Approved'), 0) AS approved,
              COALESCE(sum(p.amount_requested) FILTER (WHERE p.status IN ('Submitted', 'Under Review')), 0) AS "pendingValue",
              count(*) FILTER (WHERE p.status IN ('Submitted', 'Under Review'))::int AS pending,
              count(*) FILTER (WHERE p.status = 'Approved')::int AS "approvedCount",
              count(*) FILTER (WHERE p.status = 'Rejected')::int AS rejected,
              count(*) FILTER (WHERE p.status = 'Draft')::int AS drafts,
              COALESCE(sum(p.amount_requested) FILTER (WHERE p.status = 'Approved'), 0) AS "approvedRequested",
              min(p.submitted_at) FILTER (WHERE p.status IN ('Submitted', 'Under Review')) AS "oldestPendingAt"
         FROM budget_plans p ${w.sql}`, w.params),
    many(
      `SELECT p.category AS label,
              COALESCE(sum(p.amount_requested) FILTER (WHERE p.status <> 'Draft'), 0) AS requested,
              COALESCE(sum(p.amount_approved) FILTER (WHERE p.status = 'Approved'), 0) AS approved
         FROM budget_plans p ${w.sql} GROUP BY p.category ORDER BY requested DESC`, w.params),
    many(`SELECT p.status AS label, count(*)::int AS value FROM budget_plans p ${w.sql} GROUP BY p.status`, w.params),
  ]);
  return { kpis: k, byCategory, byStatus };
}

// ---------------------------------------------------------------------------
// List & detail
// ---------------------------------------------------------------------------
const SORT: Record<string, string> = {
  code: 'p.code', title: 'p.title', amount: 'p.amount_requested', approved: 'p.amount_approved', status: 'p.status',
  department: 'p.department', category: 'p.category', submitted: 'p.submitted_at', updated: 'p.updated_at', period: 'p.period_start',
};

export async function listPlans(f: any) {
  const w = new Where();
  if (f.academicYearId) w.add('p.academic_year_id = ?', f.academicYearId);
  w.addIf(f.campusId, 'p.campus_id = ?');
  if (f.status === 'pending') w.add(`p.status IN ('Submitted', 'Under Review')`);
  else w.addIf(f.status, 'p.status = ?');
  w.addIf(f.category, 'p.category = ?');
  w.addIf(f.department, 'p.department = ?');
  if (f.q) w.add('(p.code ILIKE ? OR p.title ILIKE ? OR p.department ILIKE ? OR p.category ILIKE ?)', likeTerm(f.q), likeTerm(f.q), likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT p.id, p.code, p.title, p.department, p.category, p.status,
            p.period_start AS "periodStart", p.period_end AS "periodEnd",
            p.amount_requested AS "amountRequested", p.amount_approved AS "amountApproved",
            p.submitted_at AS "submittedAt", su.full_name AS "submittedBy",
            p.decided_at AS "decidedAt", du.full_name AS "decidedBy", p.decision_note AS "decisionNote",
            p.campus_id AS "campusId", cp.short_name AS campus, ay.label AS "academicYear",
            cu.full_name AS "createdBy", p.created_by AS "createdById", p.updated_at AS "updatedAt",
            (SELECT count(*)::int FROM budget_plan_lines l WHERE l.plan_id = p.id) AS "lineCount",
            count(*) OVER() AS total
       FROM budget_plans p
       JOIN campuses cp ON cp.id = p.campus_id
       JOIN academic_years ay ON ay.id = p.academic_year_id
       LEFT JOIN users su ON su.id = p.submitted_by
       LEFT JOIN users du ON du.id = p.decided_by
       LEFT JOIN users cu ON cu.id = p.created_by
       ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, SORT, 'updated')}, p.code DESC
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`, w.params);
  return page(rows);
}

export async function getPlan(id: string, db?: Queryable) {
  const p = await one(
    `SELECT p.id, p.code, p.title, p.department, p.category, p.status, p.justification,
            p.period_start AS "periodStart", p.period_end AS "periodEnd",
            p.amount_requested AS "amountRequested", p.amount_approved AS "amountApproved",
            p.submitted_at AS "submittedAt", su.full_name AS "submittedBy",
            p.decided_at AS "decidedAt", du.full_name AS "decidedBy", p.decision_note AS "decisionNote",
            p.campus_id AS "campusId", cp.short_name AS campus, p.academic_year_id AS "academicYearId", ay.label AS "academicYear",
            cu.full_name AS "createdBy", p.created_by AS "createdById", p.created_at AS "createdAt", p.updated_at AS "updatedAt",
            p.budget_id AS "budgetId", b.allocated AS "budgetAllocated"
       FROM budget_plans p
       JOIN campuses cp ON cp.id = p.campus_id
       JOIN academic_years ay ON ay.id = p.academic_year_id
       LEFT JOIN users su ON su.id = p.submitted_by
       LEFT JOIN users du ON du.id = p.decided_by
       LEFT JOIN users cu ON cu.id = p.created_by
       LEFT JOIN budgets b ON b.id = p.budget_id
      WHERE p.id = $1`, [id], db);
  if (!p) throw notFound('Budget plan not found', 'PLAN_NOT_FOUND');
  const [lines, history, budget] = await Promise.all([
    many(
      `SELECT id, position, item, quantity, unit_cost AS "unitCost", amount, notes
         FROM budget_plan_lines WHERE plan_id = $1 ORDER BY position, created_at`, [id], db),
    many(
      `SELECT id, action, from_status AS "fromStatus", to_status AS "toStatus", amount, note, actor_name AS actor, created_at AS at
         FROM budget_plan_events WHERE plan_id = $1 ORDER BY created_at, id`, [id], db),
    // The budget line this plan feeds (current allocation for the same year / campus / category).
    one(
      `SELECT id, allocated, owner FROM budgets WHERE academic_year_id = $1 AND campus_id = $2 AND category = $3`,
      [p.academicYearId, p.campusId, p.category], db),
  ]);
  return { ...p, lines, history, currentBudget: budget ?? null };
}

// ---------------------------------------------------------------------------
// Create / update / delete (preparers — planning.manage)
// ---------------------------------------------------------------------------
async function writeLines(db: Queryable, planId: string, lines: Line[]) {
  await query('DELETE FROM budget_plan_lines WHERE plan_id = $1', [planId], db);
  let i = 0;
  for (const l of lines) {
    await query(
      `INSERT INTO budget_plan_lines (plan_id, position, item, quantity, unit_cost, amount, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [planId, i++, l.item, l.quantity, l.unitCost, lineAmount(l), l.notes ?? null], db);
  }
}

const totalOf = (input: { lines: Line[]; amountRequested?: number }) =>
  input.lines.length ? Math.round(input.lines.reduce((a, l) => a + lineAmount(l), 0) * 100) / 100 : Number(input.amountRequested ?? 0);

async function checkYear(db: Queryable, input: any) {
  const y = await one<{ id: string; starts_on: string; ends_on: string; is_locked: boolean }>(
    `SELECT id, starts_on::text, ends_on::text, is_locked FROM academic_years WHERE id = COALESCE($1::uuid, ${CURRENT_YEAR})`,
    [input.academicYearId ?? null], db);
  if (!y) throw badRequest('Academic year not found', 'YEAR_NOT_FOUND', [{ field: 'academicYearId', message: 'Not found' }]);
  if (y.is_locked) throw badRequest('That academic year is locked', 'YEAR_LOCKED', [{ field: 'academicYearId', message: 'Locked' }]);
  const cp = await one('SELECT id FROM campuses WHERE id = $1', [input.campusId], db);
  if (!cp) throw badRequest('Campus not found', 'CAMPUS_NOT_FOUND', [{ field: 'campusId', message: 'Not found' }]);
  return y;
}

export async function createPlan(req: Request, input: any) {
  return tx(async (db) => {
    const y = await checkYear(db, input);
    await query(`SELECT pg_advisory_xact_lock(hashtext('budget_plans.code'))`, [], db);
    const code = await nextCode('budget_plans', 'code', 'BP-', db);
    const amount = totalOf(input);
    if (input.submit && amount <= 0) throw badRequest('A plan needs an amount before it can be submitted', 'AMOUNT_REQUIRED', [{ field: 'lines', message: 'Add line items' }]);
    const status = input.submit ? 'Submitted' : 'Draft';
    const row = await one<{ id: string; code: string; status: string }>(
      `INSERT INTO budget_plans (code, title, academic_year_id, campus_id, department, category, period_start, period_end,
                                 amount_requested, justification, status, submitted_by, submitted_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, CASE WHEN $11 = 'Submitted' THEN $12::uuid END, CASE WHEN $11 = 'Submitted' THEN now() END, $12)
       RETURNING id, code, status`,
      [code, input.title, y.id, input.campusId, input.department, input.category, input.periodStart, input.periodEnd,
        amount, input.justification ?? null, status, req.user!.id], db);
    await writeLines(db, row!.id, input.lines);
    await event(db, req, row!.id, 'created', null, 'Draft', null, amount);
    if (input.submit) await event(db, req, row!.id, 'submitted', 'Draft', 'Submitted', null, amount);
    await audit(req, { action: 'create', module: 'planning', entityType: 'budget_plan', entityId: row!.id, description: `Prepared budget plan ${code} — ${input.title} (${inr(amount)})${input.submit ? ', submitted for approval' : ''}` }, db);
    if (input.submit) await notifySubmitted(db, row!.id, code, input.title, amount, input.department);
    return row;
  });
}

export async function updatePlan(req: Request, id: string, input: any) {
  return tx(async (db) => {
    const p = await one('SELECT * FROM budget_plans WHERE id = $1 FOR UPDATE', [id], db);
    if (!p) throw notFound('Budget plan not found', 'PLAN_NOT_FOUND');
    if (p.status !== 'Draft') throw conflict(`Plan ${p.code} is ${p.status} — only drafts can be edited`, 'INVALID_STATE');
    const y = await checkYear(db, input);
    const amount = totalOf(input);
    await query(
      `UPDATE budget_plans SET title = $2, academic_year_id = $3, campus_id = $4, department = $5, category = $6,
              period_start = $7, period_end = $8, amount_requested = $9, justification = $10 WHERE id = $1`,
      [id, input.title, y.id, input.campusId, input.department, input.category, input.periodStart, input.periodEnd, amount, input.justification ?? null], db);
    await writeLines(db, id, input.lines);
    await event(db, req, id, 'updated', 'Draft', 'Draft', null, amount);
    await audit(req, { action: 'update', module: 'planning', entityType: 'budget_plan', entityId: id, description: `Updated budget plan ${p.code} (${inr(amount)})` }, db);
    return { id, code: p.code, status: p.status, amountRequested: amount };
  });
}

export async function deletePlan(req: Request, id: string) {
  return tx(async (db) => {
    const p = await one('SELECT id, code, status, title FROM budget_plans WHERE id = $1 FOR UPDATE', [id], db);
    if (!p) throw notFound('Budget plan not found', 'PLAN_NOT_FOUND');
    if (p.status !== 'Draft') throw conflict(`Plan ${p.code} is ${p.status} — only drafts can be deleted`, 'INVALID_STATE');
    await query('DELETE FROM budget_plans WHERE id = $1', [id], db);
    await audit(req, { action: 'delete', module: 'planning', entityType: 'budget_plan', entityId: id, description: `Deleted draft budget plan ${p.code} — ${p.title}` }, db);
    return { id };
  });
}

async function notifySubmitted(db: Queryable, id: string, code: string, title: string, amount: number, department: string) {
  await notifyRoles(['super_admin'], {
    category: 'Attention', topic: 'planning', icon: 'wallet', title: `Budget plan ${code} awaits your approval`,
    body: `${title} · ${department} · ${inr(amount)}`, route: `/budget-planning?plan=${id}`, entityType: 'budget_plan', entityId: id,
  }, db);
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------
export type PlanAction = 'submit' | 'review' | 'approve' | 'reject' | 'reopen';
const FROM: Record<PlanAction, string[]> = {
  submit: ['Draft'],
  review: ['Submitted'],
  approve: ['Submitted', 'Under Review'],
  reject: ['Submitted', 'Under Review'],
  reopen: ['Rejected'],
};
const TO: Record<PlanAction, string> = { submit: 'Submitted', review: 'Under Review', approve: 'Approved', reject: 'Rejected', reopen: 'Draft' };
const EVENT: Record<PlanAction, string> = { submit: 'submitted', review: 'review', approve: 'approved', reject: 'rejected', reopen: 'reopened' };

export async function transitionPlan(req: Request, id: string, action: PlanAction, opts: { note?: string; amountApproved?: number } = {}) {
  // Review, approve and reject are the Super Admin's; submit / reopen belong to the preparers.
  if (action === 'review' || action === 'approve' || action === 'reject') assertDecider(req.user, 'Deciding a budget plan');
  return tx(async (db) => {
    const p = await one('SELECT * FROM budget_plans WHERE id = $1 FOR UPDATE', [id], db);
    if (!p) throw notFound('Budget plan not found', 'PLAN_NOT_FOUND');
    if (!FROM[action].includes(p.status)) throw conflict(`Plan ${p.code} is ${p.status} and cannot be moved to ${TO[action]}`, 'INVALID_STATE');
    const requested = Number(p.amount_requested);
    if (action === 'submit' && requested <= 0) throw badRequest('Add line items before submitting', 'AMOUNT_REQUIRED');
    if (action === 'reject' && (!opts.note || opts.note.trim().length < 3)) throw badRequest('Give a reason for rejecting', 'REASON_REQUIRED', [{ field: 'reason', message: 'Required' }]);

    let approved: number | null = null;
    let budgetId: string | null = null;
    if (action === 'approve') {
      approved = opts.amountApproved ?? requested;
      if (approved <= 0) throw badRequest('The approved amount must be greater than zero', 'AMOUNT_INVALID', [{ field: 'amountApproved', message: 'Must be greater than zero' }]);
      if (approved > requested) throw badRequest(`The approved amount cannot exceed the ${inr(requested)} requested`, 'AMOUNT_TOO_HIGH', [{ field: 'amountApproved', message: 'More than requested' }]);
      // Flow the approval into the Budgets page: add to (or open) the matching budget line.
      const b = await one<{ id: string }>(
        `INSERT INTO budgets (academic_year_id, campus_id, category, allocated, owner)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (academic_year_id, campus_id, category) DO UPDATE SET allocated = budgets.allocated + EXCLUDED.allocated
         RETURNING id`,
        [p.academic_year_id, p.campus_id, p.category, approved, p.department], db);
      budgetId = b!.id;
    }

    await query(
      `UPDATE budget_plans SET status = $2,
              submitted_by = CASE WHEN $3 = 'submit' THEN $4::uuid ELSE submitted_by END,
              submitted_at = CASE WHEN $3 = 'submit' THEN now() ELSE submitted_at END,
              decided_by = CASE WHEN $3 IN ('approve', 'reject') THEN $4::uuid WHEN $3 = 'reopen' THEN NULL ELSE decided_by END,
              decided_at = CASE WHEN $3 IN ('approve', 'reject') THEN now() WHEN $3 = 'reopen' THEN NULL ELSE decided_at END,
              decision_note = CASE WHEN $3 IN ('approve', 'reject') THEN $5 WHEN $3 = 'reopen' THEN decision_note ELSE decision_note END,
              amount_approved = CASE WHEN $3 = 'approve' THEN $6::numeric WHEN $3 IN ('reject', 'reopen') THEN NULL ELSE amount_approved END,
              budget_id = COALESCE($7::uuid, budget_id)
        WHERE id = $1`,
      [id, TO[action], action, req.user!.id, opts.note ?? null, approved, budgetId], db);
    await event(db, req, id, EVENT[action], p.status, TO[action], opts.note, action === 'approve' ? approved : requested);

    const verb = TO[action].toLowerCase();
    await audit(req, {
      action: action === 'approve' ? 'approve' : action === 'reject' ? 'reject' : 'update', module: 'planning',
      entityType: 'budget_plan', entityId: id,
      description: `Budget plan ${p.code} ${action === 'review' ? 'moved to review' : verb}`
        + (action === 'approve' ? ` for ${inr(approved!)}${approved! < requested ? ` (of ${inr(requested)} requested)` : ''} — added to the ${p.category} budget` : '')
        + (opts.note ? `: ${opts.note}` : ''),
      metadata: action === 'approve' ? { approved, requested, budgetId } : undefined,
    }, db);

    if (action === 'submit') await notifySubmitted(db, id, p.code, p.title, requested, p.department);
    if (action === 'approve' || action === 'reject') {
      const to = [p.submitted_by, p.created_by].filter((u: string | null) => u && u !== req.user!.id);
      await notifyUsers(to, {
        category: action === 'reject' ? 'Attention' : 'Completed', topic: 'planning', icon: action === 'approve' ? 'check' : 'x',
        title: `Budget plan ${p.code} ${verb}`,
        body: action === 'approve'
          ? `${p.title} — ${inr(approved!)} approved${approved! < requested ? ` of ${inr(requested)} requested` : ''}${opts.note ? `. ${opts.note}` : ''}`
          : `${p.title} — ${opts.note}`,
        route: `/budget-planning?plan=${id}`, entityType: 'budget_plan', entityId: id,
      }, db);
    }
    return { id, code: p.code, status: TO[action], amountApproved: approved };
  });
}
