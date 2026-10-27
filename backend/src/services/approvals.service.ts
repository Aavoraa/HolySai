import type { Request } from 'express';
import { many, one, tx } from '../config/db.js';
import { likeTerm, limitOffset } from '../utils/pagination.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { audit } from './audit.service.js';
import { notifyUsers } from './notification.service.js';
import { assertDecider } from './approvals-guard.js';
import type { ApprovalModule } from '../validators/planning.validators.js';
import * as planning from './planning.service.js';
import * as fees from './finance-fees.service.js';
import * as finOps from './finance-ops.service.js';
import * as leave from './workforce-leave.service.js';
import * as payroll from './workforce-payroll.service.js';
import * as circ from './parents-experience-circulars.service.js';
import * as lessonPlans from './academics-planning.service.js';
import * as reportCards from './academics-reports.service.js';
import * as apps from './admissions-applications.service.js';
import * as ops from './operations.service.js';
import * as records from './operations-records.service.js';
import * as group from './group.service.js';
import * as innovation from './innovation.service.js';

/**
 * Central Approvals inbox — everything waiting for a Super Admin decision,
 * across modules, as one list. Decisions are dispatched to each module's own
 * service so the module's rules, notifications and audit trail still apply.
 */

export const MODULE_LABELS: Record<ApprovalModule, string> = {
  budget_plan: 'Budget plans', expense: 'Expenses', reimbursement: 'Reimbursements', concession: 'Concessions',
  allowance: 'Allowances', leave: 'Leave', overtime: 'Overtime', payroll_run: 'Payroll runs', circular: 'Circulars',
  lesson_plan: 'Lesson plans', report_card: 'Report cards', document: 'Documents', admission: 'Admissions',
  maintenance: 'Maintenance', certificate: 'Certificates', transfer: 'Campus transfers', idea: 'Innovation ideas',
  policy: 'Group policies',
};

/**
 * One SELECT per module, all returning the same columns:
 * module, id, code, title, detail, amount, campus_id, campus, requested_by, requested_at, status, route
 */
const SOURCES: Record<ApprovalModule, string> = {
  budget_plan: `
    SELECT 'budget_plan' AS module, p.id::text AS id, p.code, p.title, p.department || ' · ' || p.category AS detail,
           p.amount_requested::numeric AS amount, p.campus_id, cp.short_name AS campus, u.full_name AS requested_by,
           COALESCE(p.submitted_at, p.created_at) AS requested_at, p.status, '/budget-planning?plan=' || p.id AS route
      FROM budget_plans p JOIN campuses cp ON cp.id = p.campus_id LEFT JOIN users u ON u.id = p.submitted_by
     WHERE p.status IN ('Submitted', 'Under Review')`,
  expense: `
    SELECT 'expense', e.id::text, e.code, e.description, e.category, e.amount::numeric, e.campus_id, cp.short_name,
           emp.full_name, e.created_at, e.status, '/expenses'
      FROM expenses e JOIN campuses cp ON cp.id = e.campus_id LEFT JOIN employees emp ON emp.id = e.submitted_by
     WHERE e.status IN ('Submitted', 'Under Review')`,
  reimbursement: `
    SELECT 'reimbursement', r.id::text, r.code, r.description, r.claim_type, r.amount::numeric, emp.campus_id, cp.short_name,
           emp.full_name, r.created_at, r.status, '/reimbursements'
      FROM reimbursements r JOIN employees emp ON emp.id = r.employee_id JOIN campuses cp ON cp.id = emp.campus_id
     WHERE r.status IN ('Submitted', 'Under Review')`,
  concession: `
    SELECT 'concession', k.id::text, NULL, k.concession_type || ' — ' || s.full_name, k.reason, k.amount::numeric, s.campus_id, cp.short_name,
           u.full_name, k.created_at, k.status, '/concessions'
      FROM concessions k JOIN students s ON s.id = k.student_id JOIN campuses cp ON cp.id = s.campus_id LEFT JOIN users u ON u.id = k.created_by
     WHERE k.status IN ('Submitted', 'Under Review')`,
  allowance: `
    SELECT 'allowance', a.allowance_type || '|' || e.campus_id, NULL, a.allowance_type,
           count(*)::text || ' employee(s) · ' || max(a.frequency), sum(a.amount)::numeric, e.campus_id, max(cp.short_name),
           NULL, min(a.created_at), 'Submitted', '/allowances'
      FROM allowances a JOIN employees e ON e.id = a.employee_id JOIN campuses cp ON cp.id = e.campus_id
     WHERE a.status = 'Submitted'
     GROUP BY a.allowance_type, e.campus_id`,
  leave: `
    SELECT 'leave', l.id::text, l.code, lt.name || ' · ' || emp.full_name,
           to_char(l.from_date, 'DD Mon') || CASE WHEN l.to_date > l.from_date THEN ' – ' || to_char(l.to_date, 'DD Mon') ELSE '' END || ' · ' || l.days::text || ' day(s)',
           NULL::numeric, emp.campus_id, cp.short_name, emp.full_name, l.created_at, l.status, '/leave'
      FROM leave_requests l JOIN employees emp ON emp.id = l.employee_id JOIN leave_types lt ON lt.id = l.leave_type_id
      JOIN campuses cp ON cp.id = emp.campus_id
     WHERE l.status IN ('Submitted', 'Under Review')`,
  overtime: `
    SELECT 'overtime', o.id::text, NULL, 'Overtime · ' || emp.full_name, o.hours::text || ' h on ' || to_char(o.work_date, 'DD Mon') || ' — ' || o.reason,
           (o.hours * o.rate_per_hour)::numeric, emp.campus_id, cp.short_name, emp.full_name, o.created_at, o.status, '/overtime'
      FROM overtime_entries o JOIN employees emp ON emp.id = o.employee_id JOIN campuses cp ON cp.id = emp.campus_id
     WHERE o.status IN ('Submitted', 'Under Review')`,
  payroll_run: `
    SELECT 'payroll_run', r.id::text, NULL, 'Payroll ' || to_char(r.pay_month, 'Mon YYYY'), r.employee_count::text || ' employees',
           r.net_total::numeric, r.campus_id, COALESCE(cp.short_name, 'All campuses'), u.full_name, COALESCE(r.submitted_at, r.updated_at), r.status, '/payroll'
      FROM payroll_runs r LEFT JOIN campuses cp ON cp.id = r.campus_id LEFT JOIN users u ON u.id = r.submitted_by
     WHERE r.status = 'Under Review'`,
  circular: `
    SELECT 'circular', c.id::text, NULL, c.title, c.audience, NULL::numeric, c.campus_id, COALESCE(cp.short_name, 'All campuses'),
           u.full_name, COALESCE(c.submitted_at, c.updated_at), c.status, '/circulars'
      FROM circulars c LEFT JOIN campuses cp ON cp.id = c.campus_id LEFT JOIN users u ON u.id = COALESCE(c.submitted_by, c.created_by)
     WHERE c.status = 'Under Review'`,
  lesson_plan: `
    SELECT 'lesson_plan', lp.id::text, NULL, lp.title, sub.name || COALESCE(' · ' || cl.name || sec.name, ''), NULL::numeric,
           cl.campus_id, cp.short_name, emp.full_name, lp.updated_at, lp.status, '/lesson-plans'
      FROM lesson_plans lp JOIN subjects sub ON sub.id = lp.subject_id JOIN employees emp ON emp.id = lp.author_id
      LEFT JOIN sections sec ON sec.id = lp.section_id LEFT JOIN classes cl ON cl.id = sec.class_id LEFT JOIN campuses cp ON cp.id = cl.campus_id
     WHERE lp.status IN ('Submitted', 'Under Review')`,
  report_card: `
    SELECT 'report_card', b.id::text, NULL, 'Report cards ' || cl.name || sec.name, b.term || ' · ready for parent release', NULL::numeric,
           cl.campus_id, cp.short_name, NULL, b.updated_at, 'Approval', '/report-cards'
      FROM report_card_batches b JOIN sections sec ON sec.id = b.section_id JOIN classes cl ON cl.id = sec.class_id JOIN campuses cp ON cp.id = cl.campus_id
     WHERE b.stage = 4 AND b.academic_year_id = (SELECT id FROM academic_years WHERE is_current)`,
  document: `
    SELECT 'document', d.id::text, NULL, d.name, d.category || COALESCE(' · ' || s.full_name, ''), NULL::numeric,
           s.campus_id, cp.short_name, u.full_name, d.updated_at, d.status,
           '/documents'
      FROM documents d LEFT JOIN students s ON s.id = d.student_id LEFT JOIN campuses cp ON cp.id = s.campus_id LEFT JOIN users u ON u.id = d.uploaded_by
     WHERE d.status = 'Submitted' AND d.deleted_at IS NULL AND d.owner_type IN ('student', 'employee', 'school')`,
  admission: `
    SELECT 'admission', a.id::text, a.application_no, a.student_name || ' · ' || a.grade_applied,
           a.status || CASE WHEN a.assessment_score IS NOT NULL THEN ' · assessment ' || round(a.assessment_score)::text || '%' ELSE '' END,
           NULL::numeric, a.campus_id, cp.short_name, u.full_name, a.updated_at, a.status, '/applications'
      FROM admissions a JOIN campuses cp ON cp.id = a.campus_id LEFT JOIN users u ON u.id = a.created_by
     WHERE a.status = 'Under Review' OR (a.status = 'Assessment Scheduled' AND a.assessment_at <= now())`,
  maintenance: `
    SELECT 'maintenance', m.id::text, m.code, m.description, m.priority || ' priority', m.cost::numeric, m.campus_id, cp.short_name,
           emp.full_name, m.created_at, m.status, '/maintenance'
      FROM maintenance_requests m JOIN campuses cp ON cp.id = m.campus_id LEFT JOIN employees emp ON emp.id = m.raised_by
     WHERE m.status IN ('Submitted', 'Under Review')`,
  certificate: `
    SELECT 'certificate', c.id::text, NULL, c.certificate_type || ' · ' || s.full_name, c.purpose, NULL::numeric, s.campus_id, cp.short_name,
           u.full_name, c.created_at, c.status, '/certificates'
      FROM certificates c JOIN students s ON s.id = c.student_id JOIN campuses cp ON cp.id = s.campus_id LEFT JOIN users u ON u.id = c.requested_by
     WHERE c.status IN ('Submitted', 'Under Review')`,
  transfer: `
    SELECT 'transfer', t.id::text, NULL, s.full_name || ' → ' || tc.short_name, t.reason, NULL::numeric, t.from_campus_id, fc.short_name,
           u.full_name, t.created_at, t.status, '/transfers'
      FROM student_transfers t JOIN students s ON s.id = t.student_id JOIN campuses fc ON fc.id = t.from_campus_id
      JOIN campuses tc ON tc.id = t.to_campus_id LEFT JOIN users u ON u.id = t.requested_by
     WHERE t.status IN ('Submitted', 'Under Review')`,
  idea: `
    SELECT 'idea', i.id::text, NULL, i.title, COALESCE(i.category || ' · ', '') || COALESCE(i.problem, ''), NULL::numeric, s.campus_id, cp.short_name,
           s.full_name, i.created_at, i.status, '/ideas'
      FROM innovation_ideas i JOIN students s ON s.id = i.student_id JOIN campuses cp ON cp.id = s.campus_id
     WHERE i.status IN ('Submitted', 'Under Review')`,
  policy: `
    SELECT 'policy', gp.id::text, gp.version, gp.name, gp.scope, NULL::numeric, NULL::uuid, 'All campuses',
           u.full_name, gp.updated_at, gp.status, '/group-policies'
      FROM group_policies gp LEFT JOIN users u ON u.id = gp.updated_by
     WHERE gp.status = 'Under review'`,
};

const ALL = Object.keys(SOURCES) as ApprovalModule[];
const unionOf = (mods: ApprovalModule[]) => mods.map((m) => `(${SOURCES[m]})`).join('\nUNION ALL\n');

const COLS = `x.module, x.id, x.code, x.title, x.detail, x.amount, x.campus_id AS "campusId", x.campus,
              x.requested_by AS "requestedBy", x.requested_at AS "requestedAt", x.status, x.route,
              floor(extract(epoch FROM (now() - x.requested_at)) / 86400)::int AS "ageDays"`;
const SOURCE_COLS = '(module, id, code, title, detail, amount, campus_id, campus, requested_by, requested_at, status, route)';

export async function pending(f: { module?: ApprovalModule; campusId?: string; q?: string; page: number; pageSize: number; sort?: string; dir: 'asc' | 'desc' }) {
  const mods = f.module ? [f.module] : ALL;
  const params: unknown[] = [];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const where: string[] = [];
  if (f.campusId) where.push(`(x.campus_id = ${p(f.campusId)}::uuid OR x.campus_id IS NULL)`);
  if (f.q) {
    const t = p(likeTerm(f.q));
    where.push(`(x.title ILIKE ${t} OR x.code ILIKE ${t} OR x.detail ILIKE ${t} OR x.requested_by ILIKE ${t})`);
  }
  const order = f.sort === 'amount' ? `x.amount ${f.dir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST`
    : f.sort === 'module' ? `x.module ${f.dir === 'desc' ? 'DESC' : 'ASC'}`
      : f.sort === 'age' ? `x.requested_at ${f.dir === 'asc' ? 'DESC' : 'ASC'}` // age asc = newest first
        : 'x.requested_at ASC'; // default: oldest first
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT ${COLS}, count(*) OVER() AS total
       FROM (${unionOf(mods)}) AS x ${SOURCE_COLS}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${order}, x.module, x.id
      LIMIT ${p(limit)} OFFSET ${p(offset)}`, params);
  return {
    rows: rows.map(({ total: _t, ...r }) => ({ ...r, moduleLabel: MODULE_LABELS[r.module as ApprovalModule] })),
    total: rows[0]?.total ?? 0,
  };
}

export async function summary(campusId?: string) {
  const params: unknown[] = [];
  const where = campusId ? (params.push(campusId), `WHERE (x.campus_id = $1::uuid OR x.campus_id IS NULL)`) : '';
  const rows = await many<{ module: ApprovalModule; count: number; amount: number | null; oldest: Date | null }>(
    `SELECT x.module, count(*)::int AS count, sum(x.amount)::numeric AS amount, min(x.requested_at) AS oldest
       FROM (${unionOf(ALL)}) AS x ${SOURCE_COLS} ${where}
      GROUP BY x.module`, params);
  const by = new Map(rows.map((r) => [r.module, r]));
  const modules = ALL.map((m) => ({
    module: m, label: MODULE_LABELS[m], count: by.get(m)?.count ?? 0, amount: by.get(m)?.amount == null ? null : Number(by.get(m)!.amount), oldestAt: by.get(m)?.oldest ?? null,
  }));
  const oldest = rows.map((r) => r.oldest).filter(Boolean).sort((a, b) => +a! - +b!)[0] ?? null;
  return {
    total: modules.reduce((a, m) => a + m.count, 0),
    amount: modules.reduce((a, m) => a + (m.amount ?? 0), 0),
    over7Days: (await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM (${unionOf(ALL)}) AS x ${SOURCE_COLS} ${where ? where + ' AND' : 'WHERE'} x.requested_at < now() - interval '7 days'`, params))!.n,
    oldestAt: oldest,
    modules,
  };
}

// ---------------------------------------------------------------------------
// Decisions — dispatched to the owning module's service
// ---------------------------------------------------------------------------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function decideDocument(req: Request, id: string, approve: boolean, note?: string) {
  const status = approve ? 'Verified' : 'Rejected';
  const d = await one<{ name: string; uploaded_by: string | null }>(
    `UPDATE documents SET status = $2, verified_by = $3, verified_at = now() WHERE id = $1 AND deleted_at IS NULL AND status IN ('Pending', 'Submitted')
     RETURNING name, uploaded_by`, [id, status, req.user!.id]);
  if (!d) throw conflict('This document is no longer awaiting verification', 'INVALID_STATE');
  if (d.uploaded_by && d.uploaded_by !== req.user!.id) {
    await notifyUsers([d.uploaded_by], { category: approve ? 'Completed' : 'Attention', topic: 'documents', icon: 'folder', title: `"${d.name}" was ${status.toLowerCase()}`, body: note });
  }
  await audit(req, { action: 'approve', module: 'documents', description: `${status} document "${d.name}"${note ? `: ${note}` : ''}`, entityType: 'document', entityId: id });
  return { id, status };
}

/** Report cards have no "reject" in their pipeline; the Super Admin returns the class to teacher review. */
async function returnReportCards(req: Request, id: string, reason: string) {
  return tx(async (db) => {
    const b = await one<{ label: string; term: string }>(
      `UPDATE report_card_batches b SET stage = 3 FROM sections sec JOIN classes c ON c.id = sec.class_id
        WHERE b.id = $1 AND b.stage = 4 AND sec.id = b.section_id RETURNING c.name || sec.name AS label, b.term`, [id], db);
    if (!b) throw conflict('These report cards are no longer at the Approval stage', 'INVALID_STATE');
    await audit(req, {
      action: 'reject', module: 'academics', entityType: 'report_card_batch', entityId: id,
      description: `Report cards ${b.label} (${b.term}) returned to teacher review: ${reason}`,
    }, db);
    return { id, status: 'Teacher review' };
  });
}

export async function decide(req: Request, module: ApprovalModule, id: string, b: { decision: 'approve' | 'reject'; reason?: string; amountApproved?: number }) {
  assertDecider(req.user);
  const approve = b.decision === 'approve';
  const reason = b.reason?.trim() || undefined;
  if (!approve && (!reason || reason.length < 3)) throw badRequest('Give a reason for rejecting', 'REASON_REQUIRED', [{ field: 'reason', message: 'Required' }]);
  if (module !== 'allowance' && !UUID.test(id)) throw notFound('Request not found');

  let out: unknown;
  switch (module) {
    case 'budget_plan':
      out = await planning.transitionPlan(req, id, approve ? 'approve' : 'reject', { note: reason, amountApproved: b.amountApproved });
      break;
    case 'expense':
      out = await finOps.transitionExpense(req, id, approve ? 'approve' : 'reject', reason);
      break;
    case 'reimbursement':
      out = await finOps.transitionReimbursement(req, id, approve ? 'approve' : 'reject', { reason });
      break;
    case 'concession':
      out = await fees.decideConcession(req, id, approve ? 'Approved' : 'Rejected', reason);
      break;
    case 'allowance': {
      const [allowanceType, campusId] = id.split('|');
      if (!allowanceType || (campusId && !UUID.test(campusId))) throw notFound('Request not found');
      out = await finOps.decideAllowance(req, { allowanceType, decision: approve ? 'Approved' : 'Rejected', campusId: campusId || undefined });
      break;
    }
    case 'leave':
      out = approve ? await leave.approveLeave(req, id, reason) : await leave.rejectLeave(req, id, reason!);
      break;
    case 'overtime':
      out = approve ? await leave.approveOvertime(req, id, reason) : await leave.rejectOvertime(req, id, reason!);
      break;
    case 'payroll_run':
      out = approve ? await payroll.approveRun(req, id) : await payroll.returnRun(req, id, reason!);
      break;
    case 'circular':
      out = approve ? await circ.releaseCircular(req, id) : await circ.returnCircular(req, id);
      break;
    case 'lesson_plan':
      out = await lessonPlans.transitionLessonPlan(req, id, approve ? 'approve' : 'reject', reason ?? null);
      break;
    case 'report_card':
      out = approve ? await reportCards.advanceBatch(req, id, 5) : await returnReportCards(req, id, reason!);
      break;
    case 'document':
      out = await decideDocument(req, id, approve, reason);
      break;
    case 'admission':
      out = await apps.setStatus(req, id, { status: approve ? 'Offer Made' : 'Rejected', note: reason ?? 'Offer approved by the Super Admin' });
      break;
    case 'maintenance':
      out = await ops.updateMaintenanceStatus(req, id, { status: approve ? 'Approved' : 'Rejected', note: reason });
      break;
    case 'certificate':
      out = await records.decideCertificate(req, id, { action: approve ? 'approve' : 'reject', note: reason });
      break;
    case 'transfer':
      out = await group.decideTransfer(req, id, { action: approve ? 'approve' : 'reject', note: reason });
      break;
    case 'idea':
      out = await innovation.reviewIdea(req, id, { action: approve ? 'accept' : 'decline', note: reason });
      break;
    case 'policy': {
      const p = await group.getPolicy(id);
      if (p.status !== 'Under review') throw conflict(`This policy is ${p.status} — only policies under review can be decided`, 'INVALID_STATE');
      await group.updatePolicy(req, id, approve
        ? { status: 'Active', changeNote: reason ?? 'Approved by the Super Admin' }
        : { status: 'Draft', changeNote: `Returned: ${reason}` });
      out = { id, status: approve ? 'Active' : 'Draft' };
      break;
    }
    default:
      throw notFound('Unknown module');
  }
  return { module, id, decision: b.decision, result: out ?? null };
}

/** Pending approvals count for badges / the owner overview. */
export async function pendingCount() {
  const r = await one<{ n: number }>(`SELECT count(*)::int AS n FROM (${unionOf(ALL)}) AS x ${SOURCE_COLS}`);
  return r?.n ?? 0;
}

