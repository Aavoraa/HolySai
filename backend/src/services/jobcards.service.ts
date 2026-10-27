/**
 * Job Cards — work requests raised by one department to another.
 *
 * Visibility: a user sees cards they raised, cards raised from or sent to a
 * department they belong to (or head), and cards assigned to them.
 * jobcards.manage sees every card. Cards outside scope return 404.
 *
 * Roles on a card:
 *   raiser side   — the user who raised it, or a member of the raising department
 *   receiver side — a member / head of the receiving department, or the assignee
 *   manager       — jobcards.manage (any allowed transition)
 */
import type { Request } from 'express';
import { many, one, query, tx, type Queryable } from '../config/db.js';
import type { AuthUser } from '../types.js';
import { Where } from '../utils/sql.js';
import { likeTerm, limitOffset, orderBy, type Pagination } from '../utils/pagination.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { nextCode } from '../utils/codes.js';
import { audit } from './audit.service.js';
import { notifyUsers, type Category } from './notification.service.js';

const MODULE = 'jobcards';
const FINAL = `('Completed', 'Closed', 'Cancelled')`;
const OVERDUE_SQL = `(jc.due_on < current_date AND jc.status NOT IN ${FINAL})`;
const ROUTE = '/job-cards';

export const isManager = (u: AuthUser) => u.permissions.has('jobcards.manage');

// =============================================================================
// Department membership
// =============================================================================
/**
 * Departments an employee belongs to: the department their employee record
 * resolves to (by name / alias; subject codes → Academics), plus any
 * department they head. The resolved department comes first.
 */
export async function departmentsOfEmployee(employeeId: string | null, db?: Queryable): Promise<string[]> {
  if (!employeeId) return [];
  const rows = await many<{ id: string }>(
    `SELECT department_id AS id, 0 AS ord FROM employee_departments WHERE employee_id = $1
     UNION
     SELECT id, 1 AS ord FROM departments WHERE head_employee_id = $1
     ORDER BY ord`, [employeeId], db);
  return [...new Set(rows.map((r) => r.id))];
}

async function isMemberOf(employeeId: string, departmentId: string, db?: Queryable) {
  const r = await one(
    `SELECT 1 FROM employee_departments WHERE employee_id = $1 AND department_id = $2
     UNION ALL SELECT 1 FROM departments WHERE id = $2 AND head_employee_id = $1 LIMIT 1`, [employeeId, departmentId], db);
  return !!r;
}

/** Adds the visibility rule for non-managers. */
function scope(u: AuthUser, depts: string[], w: Where) {
  if (isManager(u)) return w;
  return w.add(
    `(jc.raised_by = ? OR jc.from_department_id = ANY(?::uuid[]) OR jc.to_department_id = ANY(?::uuid[]) OR jc.assigned_to_employee_id = ?)`,
    u.id, depts, depts, u.employeeId ?? '00000000-0000-0000-0000-000000000000');
}

// =============================================================================
// Job cards — list, summary
// =============================================================================
const SORTS: Record<string, string> = {
  code: `substring(jc.code FROM 4)::int`, title: 'jc.title', category: 'jc.category',
  priority: `array_position(ARRAY['Urgent','High','Medium','Low'], jc.priority)`,
  status: `array_position(ARRAY['Open','Reopened','Assigned','In Progress','On Hold','Completed','Closed','Cancelled'], jc.status)`,
  due: 'jc.due_on', created: 'jc.created_at', updated: 'jc.updated_at', from: 'fd.name', to: 'td.name', assignee: 'ae.full_name',
};

const CARD_COLUMNS = `
  jc.id, jc.code, jc.title, jc.description, jc.category, jc.priority, jc.status, jc.location,
  jc.due_on AS "dueOn", ${OVERDUE_SQL} AS overdue,
  CASE WHEN jc.due_on IS NOT NULL THEN jc.due_on - current_date END AS "dueInDays",
  jc.from_department_id AS "fromDepartmentId", fd.name AS "fromDepartment",
  jc.to_department_id AS "toDepartmentId", td.name AS "toDepartment",
  jc.raised_by AS "raisedById", ru.full_name AS "raisedBy",
  jc.assigned_to_employee_id AS "assignedToId", ae.full_name AS "assignedTo", ae.designation AS "assignedToDesignation",
  jc.campus_id AS "campusId", cp.short_name AS "campusName",
  jc.estimated_hours::float AS "estimatedHours", jc.actual_hours::float AS "actualHours",
  jc.assigned_at AS "assignedAt", jc.started_at AS "startedAt", jc.completed_at AS "completedAt", jc.closed_at AS "closedAt",
  jc.created_at AS "createdAt", jc.updated_at AS "updatedAt",
  (SELECT count(*)::int FROM job_card_updates x WHERE x.card_id = jc.id AND x.kind = 'comment') AS "commentCount"`;

const CARD_JOINS = `
  JOIN departments fd ON fd.id = jc.from_department_id
  JOIN departments td ON td.id = jc.to_department_id
  LEFT JOIN users ru ON ru.id = jc.raised_by
  LEFT JOIN employees ae ON ae.id = jc.assigned_to_employee_id
  LEFT JOIN campuses cp ON cp.id = jc.campus_id`;

type ListFilters = Pagination & {
  status?: string; priority?: string; category?: string; direction?: 'in' | 'out' | 'mine' | 'all';
  departmentId?: string; overdue?: boolean; campusId?: string;
};

export async function listCards(u: AuthUser, f: ListFilters) {
  const depts = await departmentsOfEmployee(u.employeeId);
  const w = new Where();
  scope(u, depts, w);
  if (f.direction === 'in') w.add('jc.to_department_id = ANY(?::uuid[])', depts);
  else if (f.direction === 'out') w.add('(jc.raised_by = ? OR jc.from_department_id = ANY(?::uuid[]))', u.id, depts);
  else if (f.direction === 'mine') w.add('jc.assigned_to_employee_id = ?', u.employeeId ?? '00000000-0000-0000-0000-000000000000');
  if (f.status === 'active') w.add(`jc.status NOT IN ${FINAL}`);
  else w.addIf(f.status, 'jc.status = ?');
  w.addIf(f.priority, 'jc.priority = ?');
  w.addIf(f.category, 'jc.category = ?');
  w.addIf(f.campusId, 'jc.campus_id = ?');
  if (f.departmentId) w.add('(jc.from_department_id = ? OR jc.to_department_id = ?)', f.departmentId, f.departmentId);
  if (f.overdue) w.add(OVERDUE_SQL);
  if (f.q) w.add('(jc.title ILIKE ? OR jc.code ILIKE ? OR jc.description ILIKE ? OR jc.location ILIKE ?)', likeTerm(f.q), likeTerm(f.q), likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT ${CARD_COLUMNS}, count(*) OVER() AS total
       FROM job_cards jc ${CARD_JOINS}
       ${w.sql}
      ORDER BY ${f.sort ? orderBy(f.sort, f.dir, SORTS, 'created') : `(jc.status IN ${FINAL}), ${OVERDUE_SQL} DESC, ${SORTS.priority}, jc.due_on NULLS LAST, jc.created_at DESC`}, jc.code DESC
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`, w.params);
  return { rows: rows.map(({ total: _t, ...x }) => x), total: Number(rows[0]?.total ?? 0) };
}

export async function summary(u: AuthUser, campusId?: string) {
  const depts = await departmentsOfEmployee(u.employeeId);
  const w = new Where();
  scope(u, depts, w);
  w.addIf(campusId, 'jc.campus_id = ?');
  const emp = u.employeeId ?? '00000000-0000-0000-0000-000000000000';
  const deptP = w.param(depts);
  const userP = w.param(u.id);
  const empP = w.param(emp);
  const s = await one(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE jc.status NOT IN ${FINAL})::int AS active,
            count(*) FILTER (WHERE jc.status IN ('Open', 'Reopened', 'Assigned'))::int AS open,
            count(*) FILTER (WHERE jc.status = 'In Progress')::int AS "inProgress",
            count(*) FILTER (WHERE jc.status = 'On Hold')::int AS "onHold",
            count(*) FILTER (WHERE ${OVERDUE_SQL})::int AS overdue,
            count(*) FILTER (WHERE jc.status IN ('Completed', 'Closed') AND jc.completed_at >= date_trunc('month', now()))::int AS "completedThisMonth",
            count(*) FILTER (WHERE jc.status = 'Completed')::int AS "awaitingClosure",
            round((avg(extract(epoch FROM (jc.completed_at - jc.created_at)) / 3600)
                   FILTER (WHERE jc.completed_at IS NOT NULL AND jc.completed_at > now() - interval '90 days'))::numeric, 1)::float AS "avgCompletionHours",
            count(*) FILTER (WHERE jc.status NOT IN ${FINAL} AND jc.to_department_id = ANY(${deptP}::uuid[]))::int AS inbox,
            count(*) FILTER (WHERE jc.status NOT IN ${FINAL} AND (jc.raised_by = ${userP} OR jc.from_department_id = ANY(${deptP}::uuid[])))::int AS raised,
            count(*) FILTER (WHERE jc.status NOT IN ${FINAL} AND jc.assigned_to_employee_id = ${empP})::int AS assigned,
            count(*) FILTER (WHERE jc.status = 'Open' AND jc.to_department_id = ANY(${deptP}::uuid[]))::int AS "inboxUnassigned"
       FROM job_cards jc ${w.sql}`, w.params);
  const byStatus = await many(`SELECT jc.status, count(*)::int AS count FROM job_cards jc ${w.sql} GROUP BY jc.status`, w.params.slice(0, w.params.length - 3));
  const w2 = new Where();
  scope(u, depts, w2);
  w2.addIf(campusId, 'jc.campus_id = ?');
  const perDepartment = await many(
    `SELECT d.id, d.name, d.code,
            count(*) FILTER (WHERE jc.to_department_id = d.id AND jc.status NOT IN ${FINAL})::int AS "openIn",
            count(*) FILTER (WHERE jc.from_department_id = d.id AND jc.status NOT IN ${FINAL})::int AS "openOut",
            count(*) FILTER (WHERE jc.to_department_id = d.id AND ${OVERDUE_SQL})::int AS "overdueIn",
            count(*) FILTER (WHERE jc.to_department_id = d.id AND jc.completed_at > now() - interval '30 days')::int AS "completed30d",
            round((avg(extract(epoch FROM (jc.completed_at - jc.created_at)) / 3600)
                   FILTER (WHERE jc.to_department_id = d.id AND jc.completed_at IS NOT NULL))::numeric, 1)::float AS "avgCompletionHours"
       FROM departments d
       JOIN job_cards jc ON (jc.to_department_id = d.id OR jc.from_department_id = d.id)
       ${w2.sql}
      GROUP BY d.id, d.name, d.code
      ORDER BY "openIn" DESC, d.name`, w2.params);
  return {
    ...s,
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.count])),
    perDepartment,
    myDepartmentIds: depts,
  };
}

// =============================================================================
// Job cards — detail + permissions
// =============================================================================
const NEXT: Record<string, string[]> = {
  Open: ['In Progress', 'On Hold', 'Cancelled'],
  Assigned: ['In Progress', 'On Hold', 'Cancelled'],
  'In Progress': ['On Hold', 'Completed'],
  'On Hold': ['Open', 'Assigned', 'In Progress', 'Cancelled'],
  Completed: ['Closed', 'Reopened'],
  Reopened: ['In Progress', 'On Hold', 'Cancelled'],
  Closed: [],
  Cancelled: [],
};
const NOT_STARTED = ['Open', 'Assigned', 'Reopened'];

interface CardRow {
  id: string; code: string; title: string; status: string; priority: string;
  raised_by: string | null; from_department_id: string; to_department_id: string; assigned_to_employee_id: string | null;
  from_name: string; to_name: string; to_head_user: string | null; assignee_user: string | null;
}

interface Roles { manager: boolean; raiser: boolean; receiver: boolean; assignee: boolean }

async function loadCard(u: AuthUser, id: string, db?: Queryable, lock = false) {
  const c = await one<CardRow>(
    `SELECT jc.id, jc.code, jc.title, jc.status, jc.priority, jc.raised_by, jc.from_department_id, jc.to_department_id,
            jc.assigned_to_employee_id, fd.name AS from_name, td.name AS to_name,
            he.user_id AS to_head_user, ae.user_id AS assignee_user
       FROM job_cards jc
       JOIN departments fd ON fd.id = jc.from_department_id
       JOIN departments td ON td.id = jc.to_department_id
       LEFT JOIN employees he ON he.id = td.head_employee_id
       LEFT JOIN employees ae ON ae.id = jc.assigned_to_employee_id
      WHERE jc.id = $1 ${lock ? 'FOR UPDATE OF jc' : ''}`, [id], db);
  if (!c) throw notFound('Job card not found');
  const depts = await departmentsOfEmployee(u.employeeId, db);
  const roles: Roles = {
    manager: isManager(u),
    raiser: c.raised_by === u.id || depts.includes(c.from_department_id),
    receiver: depts.includes(c.to_department_id),
    assignee: !!u.employeeId && c.assigned_to_employee_id === u.employeeId,
  };
  if (!roles.manager && !roles.raiser && !roles.receiver && !roles.assignee) throw notFound('Job card not found');
  return { card: c, roles };
}

/** Status changes this user may make on the card right now. */
function allowedStatuses(c: { status: string; assigned_to_employee_id: string | null }, r: Roles) {
  const resume = c.assigned_to_employee_id ? 'Assigned' : 'Open';
  return (NEXT[c.status] ?? []).filter((to) => {
    if ((to === 'Open' || to === 'Assigned') && to !== resume) return false;
    if (r.manager) return true;
    const recv = r.receiver || r.assignee;
    switch (to) {
      case 'In Progress': case 'Completed': return recv;
      case 'On Hold': return recv || (r.raiser && NOT_STARTED.includes(c.status));
      case 'Open': case 'Assigned': return recv || r.raiser;
      case 'Cancelled': case 'Closed': case 'Reopened': return r.raiser;
      default: return false;
    }
  });
}

export async function getCard(req: Request, id: string) {
  const u = req.user!;
  const { card, roles } = await loadCard(u, id);
  const detail = await one(`SELECT ${CARD_COLUMNS}, td.head_employee_id AS "toHeadId", he.full_name AS "toHead"
     FROM job_cards jc ${CARD_JOINS} LEFT JOIN employees he ON he.id = td.head_employee_id WHERE jc.id = $1`, [id]);
  const updates = await many(
    `SELECT x.id, x.kind, x.from_status AS "fromStatus", x.to_status AS "toStatus", x.body, x.created_at AS "createdAt",
            x.user_id AS "userId", u.full_name AS "userName"
       FROM job_card_updates x LEFT JOIN users u ON u.id = x.user_id
      WHERE x.card_id = $1 ORDER BY x.created_at, x.id`, [id]);
  const open = !['Closed', 'Cancelled'].includes(card.status);
  return {
    ...detail,
    updates,
    permissions: {
      statuses: allowedStatuses(card, roles),
      canAssign: open && card.status !== 'Completed' && (roles.manager || roles.receiver),
      canEdit: open && (roles.manager || roles.raiser || roles.receiver || roles.assignee),
      canEditDetails: open && (roles.manager || roles.raiser),
      canComment: true,
      role: roles.manager ? 'manager' : roles.receiver ? 'receiver' : roles.assignee ? 'assignee' : 'raiser',
    },
  };
}

// =============================================================================
// Job cards — writes
// =============================================================================
async function logUpdate(db: Queryable, cardId: string, userId: string, kind: string, body: string | null, fromStatus?: string | null, toStatus?: string | null) {
  await query(
    `INSERT INTO job_card_updates (card_id, user_id, kind, from_status, to_status, body) VALUES ($1,$2,$3,$4,$5,$6)`,
    [cardId, userId, kind, fromStatus ?? null, toStatus ?? null, body], db);
}

/** Everyone involved in a card except the actor. */
function participants(c: CardRow, actorId: string) {
  return [c.raised_by, c.to_head_user, c.assignee_user].filter((x): x is string => !!x && x !== actorId);
}

export async function createCard(req: Request, b: any) {
  const u = req.user!;
  const manager = isManager(u);
  return tx(async (db) => {
    const mine = await departmentsOfEmployee(u.employeeId, db);
    const fromId: string | undefined = b.fromDepartmentId ?? mine[0];
    if (!fromId) throw badRequest('Your staff record is not linked to a department. Choose the department raising this card.', 'NO_DEPARTMENT', [{ field: 'fromDepartmentId', message: 'Required' }]);
    if (!manager && !mine.includes(fromId)) throw forbidden('You can only raise job cards from your own department');
    if (fromId === b.toDepartmentId) throw badRequest('A job card must go to a different department', 'SAME_DEPARTMENT', [{ field: 'toDepartmentId', message: 'Choose another department' }]);
    const depts = await many<{ id: string; name: string; is_active: boolean; campus_id: string | null; head_user: string | null }>(
      `SELECT d.id, d.name, d.is_active, d.campus_id, he.user_id AS head_user
         FROM departments d LEFT JOIN employees he ON he.id = d.head_employee_id WHERE d.id = ANY($1::uuid[])`, [[fromId, b.toDepartmentId]], db);
    const from = depts.find((d) => d.id === fromId);
    const to = depts.find((d) => d.id === b.toDepartmentId);
    if (!from) throw badRequest('Raising department not found', 'DEPARTMENT_NOT_FOUND', [{ field: 'fromDepartmentId', message: 'Not found' }]);
    if (!to || !to.is_active) throw badRequest('Receiving department not found or inactive', 'DEPARTMENT_NOT_FOUND', [{ field: 'toDepartmentId', message: 'Not found' }]);
    if (b.dueOn) {
      const past = await one(`SELECT ($1::date < current_date) AS past`, [b.dueOn], db);
      if (past?.past) throw badRequest('The due date cannot be in the past', 'DUE_IN_PAST', [{ field: 'dueOn', message: 'Choose today or later' }]);
    }
    const campusId = b.campusId ?? u.campusId ?? to.campus_id ?? null;
    const code = await nextCode('job_cards', 'code', 'JC-', db, 4);
    const r = await one<{ id: string }>(
      `INSERT INTO job_cards (code, title, description, category, priority, from_department_id, to_department_id, raised_by,
                              campus_id, location, due_on, estimated_hours)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [code, b.title, b.description ?? null, b.category, b.priority, fromId, to.id, u.id, campusId, b.location ?? null, b.dueOn ?? null, b.estimatedHours ?? null], db);
    const id = r!.id;
    await logUpdate(db, id, u.id, 'created', `Raised by ${u.fullName} (${from.name}) for ${to.name}`, null, 'Open');
    await audit(req, { action: 'create', module: MODULE, description: `Raised job card ${code} — ${b.title} (${from.name} → ${to.name})`, entityType: 'job_card', entityId: id }, db);
    // Receiving head; when the department has no head, every member with an account.
    let recipients = to.head_user ? [to.head_user] : [];
    if (!recipients.length) {
      recipients = (await many<{ user_id: string }>(
        `SELECT e.user_id FROM employee_departments ed JOIN employees e ON e.id = ed.employee_id
          WHERE ed.department_id = $1 AND e.user_id IS NOT NULL AND e.employment_status <> 'exited'`, [to.id], db)).map((x) => x.user_id);
    }
    await notifyUsers(recipients.filter((x) => x !== u.id), {
      category: b.priority === 'Urgent' || b.priority === 'High' ? 'Attention' : 'Information', topic: 'jobcards', icon: 'clipboard',
      title: `${code}: ${b.title}`, body: `${b.priority} priority job card from ${from.name}${b.dueOn ? ` · due ${b.dueOn}` : ''}`,
      route: `${ROUTE}?card=${id}`, entityType: 'job_card', entityId: id,
    }, db);
    return { id, code };
  });
}

const DETAIL_FIELDS = ['title', 'description', 'category', 'priority', 'dueOn', 'location'] as const;
const COLS: Record<string, string> = {
  title: 'title', description: 'description', category: 'category', priority: 'priority', dueOn: 'due_on', location: 'location',
  estimatedHours: 'estimated_hours', actualHours: 'actual_hours',
};

export async function updateCard(req: Request, id: string, b: Record<string, unknown>) {
  const u = req.user!;
  return tx(async (db) => {
    const { card, roles } = await loadCard(u, id, db, true);
    if (['Closed', 'Cancelled'].includes(card.status)) throw badRequest(`A ${card.status.toLowerCase()} job card cannot be edited`, 'CARD_LOCKED');
    const touchesDetails = DETAIL_FIELDS.some((k) => b[k] !== undefined);
    if (touchesDetails && !roles.manager && !roles.raiser) throw forbidden('Only the raising department can change the request details');
    if (!touchesDetails && !roles.manager && !roles.raiser && !roles.receiver && !roles.assignee) throw forbidden();
    const params: unknown[] = [id];
    const sets: string[] = [];
    const changed: string[] = [];
    for (const [k, col] of Object.entries(COLS)) {
      if (b[k] === undefined) continue;
      params.push(b[k] === '' ? null : b[k]);
      sets.push(`${col} = $${params.length}`);
      changed.push(k);
    }
    await query(`UPDATE job_cards SET ${sets.join(', ')} WHERE id = $1`, params, db);
    const LABEL: Record<string, string> = { title: 'title', description: 'description', category: 'category', priority: 'priority', dueOn: 'due date', location: 'location', estimatedHours: 'estimated hours', actualHours: 'actual hours' };
    const shown = (k: string) => (k === 'description' || b[k] == null ? LABEL[k] : `${LABEL[k]} → ${String(b[k])}`);
    await logUpdate(db, id, u.id, 'edit', `Changed ${changed.map(shown).join(', ')}`);
    await audit(req, { action: 'update', module: MODULE, description: `Updated job card ${card.code} (${changed.join(', ')})`, entityType: 'job_card', entityId: id, metadata: { changed } }, db);
  });
}

export async function changeStatus(req: Request, id: string, b: { status: string; note?: string | null; actualHours?: number | null }) {
  const u = req.user!;
  return tx(async (db) => {
    const { card, roles } = await loadCard(u, id, db, true);
    if (b.status === card.status) throw badRequest(`The job card is already ${card.status}`, 'NO_CHANGE');
    if (!(NEXT[card.status] ?? []).includes(b.status)) throw badRequest(`A job card that is ${card.status} cannot move to ${b.status}`, 'INVALID_TRANSITION');
    if (!allowedStatuses(card, roles).includes(b.status)) {
      throw forbidden(['Cancelled', 'Closed', 'Reopened'].includes(b.status)
        ? 'Only the raising department can do this' : 'Only the receiving department can do this');
    }
    if (['On Hold', 'Cancelled', 'Reopened'].includes(b.status) && !b.note?.trim()) {
      throw badRequest('Add a note explaining why', 'NOTE_REQUIRED', [{ field: 'note', message: 'A reason is required' }]);
    }
    await query(
      `UPDATE job_cards SET status = $2,
              started_at   = CASE WHEN $2 = 'In Progress' THEN COALESCE(started_at, now()) ELSE started_at END,
              completed_at = CASE WHEN $2 = 'Completed' THEN now() WHEN $2 = 'Reopened' THEN NULL ELSE completed_at END,
              actual_hours = COALESCE($3, actual_hours),
              closed_at    = CASE WHEN $2 IN ('Closed', 'Cancelled') THEN now() WHEN $2 = 'Reopened' THEN NULL ELSE closed_at END,
              closed_by    = CASE WHEN $2 IN ('Closed', 'Cancelled') THEN $4::uuid WHEN $2 = 'Reopened' THEN NULL ELSE closed_by END
        WHERE id = $1`, [id, b.status, b.actualHours ?? null, u.id], db);
    await logUpdate(db, id, u.id, 'status', b.note?.trim() || null, card.status, b.status);
    await audit(req, { action: 'update', module: MODULE, description: `${card.code} moved from ${card.status} to ${b.status}`, entityType: 'job_card', entityId: id, metadata: { note: b.note ?? null } }, db);
    const category: Category = b.status === 'Completed' || b.status === 'Closed' ? 'Completed' : b.status === 'Cancelled' || b.status === 'Reopened' || b.status === 'On Hold' ? 'Attention' : 'Information';
    await notifyUsers(participants(card, u.id), {
      category, topic: 'jobcards', icon: 'clipboard',
      title: `${card.code} is now ${b.status}`, body: b.note?.trim() || `${card.title} · ${u.fullName}`,
      route: `${ROUTE}?card=${id}`, entityType: 'job_card', entityId: id,
    }, db);
  });
}

export async function assignCard(req: Request, id: string, b: { employeeId: string; note?: string | null }) {
  const u = req.user!;
  return tx(async (db) => {
    const { card, roles } = await loadCard(u, id, db, true);
    if (!roles.manager && !roles.receiver) throw forbidden('Only the receiving department can assign this job card');
    if (['Completed', 'Closed', 'Cancelled'].includes(card.status)) throw badRequest(`A ${card.status.toLowerCase()} job card cannot be reassigned`, 'CARD_LOCKED');
    const emp = await one<{ id: string; full_name: string; user_id: string | null }>(
      `SELECT id, full_name, user_id FROM employees WHERE id = $1 AND deleted_at IS NULL AND employment_status <> 'exited'`, [b.employeeId], db);
    if (!emp) throw badRequest('Employee not found', 'EMPLOYEE_NOT_FOUND', [{ field: 'employeeId', message: 'Not found' }]);
    if (!(await isMemberOf(emp.id, card.to_department_id, db))) {
      throw badRequest(`${emp.full_name} is not in ${card.to_name}`, 'NOT_IN_DEPARTMENT', [{ field: 'employeeId', message: `Choose someone from ${card.to_name}` }]);
    }
    if (emp.id === card.assigned_to_employee_id) throw badRequest(`${emp.full_name} is already assigned`, 'NO_CHANGE');
    const nextStatus = ['Open', 'Reopened'].includes(card.status) ? 'Assigned' : card.status;
    await query(
      `UPDATE job_cards SET assigned_to_employee_id = $2, assigned_by = $3, assigned_at = now(), status = $4 WHERE id = $1`,
      [id, emp.id, u.id, nextStatus], db);
    await logUpdate(db, id, u.id, 'assignment', `Assigned to ${emp.full_name}${b.note?.trim() ? ` — ${b.note.trim()}` : ''}`,
      card.status, nextStatus !== card.status ? nextStatus : null);
    await audit(req, { action: 'update', module: MODULE, description: `Assigned job card ${card.code} to ${emp.full_name}`, entityType: 'job_card', entityId: id }, db);
    if (emp.user_id && emp.user_id !== u.id) {
      await notifyUsers([emp.user_id], {
        category: card.priority === 'Urgent' || card.priority === 'High' ? 'Attention' : 'Information', topic: 'jobcards', icon: 'clipboard',
        title: `${card.code} assigned to you`, body: `${card.title} · from ${card.from_name}${b.note?.trim() ? ` · ${b.note.trim()}` : ''}`,
        route: `${ROUTE}?card=${id}`, entityType: 'job_card', entityId: id,
      }, db);
    }
    if (card.raised_by && card.raised_by !== u.id && card.raised_by !== emp.user_id) {
      await notifyUsers([card.raised_by], {
        category: 'Information', topic: 'jobcards', icon: 'clipboard',
        title: `${card.code} assigned to ${emp.full_name}`, body: card.title, route: `${ROUTE}?card=${id}`, entityType: 'job_card', entityId: id,
      }, db);
    }
    return { status: nextStatus };
  });
}

export async function addComment(req: Request, id: string, body: string) {
  const u = req.user!;
  return tx(async (db) => {
    const { card } = await loadCard(u, id, db);
    const r = await one<{ id: string }>(
      `INSERT INTO job_card_updates (card_id, user_id, kind, body) VALUES ($1,$2,'comment',$3) RETURNING id`, [id, u.id, body], db);
    await query(`UPDATE job_cards SET updated_at = now() WHERE id = $1`, [id], db);
    await audit(req, { action: 'create', module: MODULE, description: `Commented on job card ${card.code}`, entityType: 'job_card', entityId: id }, db);
    await notifyUsers(participants(card, u.id), {
      category: 'Information', topic: 'jobcards', icon: 'messageSquare',
      title: `${u.fullName} commented on ${card.code}`, body: body.length > 140 ? `${body.slice(0, 137)}…` : body,
      route: `${ROUTE}?card=${id}`, entityType: 'job_card', entityId: id,
    }, db);
    return { id: r!.id };
  });
}

// =============================================================================
// Departments
// =============================================================================
export async function listDepartments(u: AuthUser, f: { q?: string; includeInactive?: boolean }) {
  const mine = await departmentsOfEmployee(u.employeeId);
  const w = new Where();
  if (!f.includeInactive) w.add('d.is_active');
  if (f.q) w.add('(d.name ILIKE ? OR d.code ILIKE ?)', likeTerm(f.q), likeTerm(f.q));
  const mineP = w.param(mine);
  return many(
    `SELECT d.id, d.name, d.code, d.description, d.is_active AS "isActive", d.aliases,
            d.campus_id AS "campusId", cp.short_name AS "campusName",
            d.head_employee_id AS "headEmployeeId", he.full_name AS "headName", he.designation AS "headDesignation",
            (SELECT count(*)::int FROM employee_departments ed JOIN employees e ON e.id = ed.employee_id
              WHERE ed.department_id = d.id AND e.employment_status <> 'exited') AS "membersCount",
            (SELECT count(*)::int FROM job_cards jc WHERE jc.to_department_id = d.id AND jc.status NOT IN ${FINAL}) AS "openIn",
            (SELECT count(*)::int FROM job_cards jc WHERE jc.from_department_id = d.id AND jc.status NOT IN ${FINAL}) AS "openOut",
            (SELECT count(*)::int FROM job_cards jc WHERE jc.to_department_id = d.id AND ${OVERDUE_SQL}) AS "overdueIn",
            (d.id = ANY(${mineP}::uuid[])) AS "isMine"
       FROM departments d
       LEFT JOIN employees he ON he.id = d.head_employee_id
       LEFT JOIN campuses cp ON cp.id = d.campus_id
       ${w.sql}
      ORDER BY d.name`, w.params);
}

export async function departmentMembers(id: string) {
  const d = await one('SELECT id FROM departments WHERE id = $1', [id]);
  if (!d) throw notFound('Department not found');
  return many(
    `SELECT e.id, e.full_name AS "fullName", e.designation, e.employee_code AS "employeeCode", e.department AS "recordDepartment",
            (e.id = d.head_employee_id) AS "isHead", (e.user_id IS NOT NULL) AS "hasAccount", cp.short_name AS "campusName"
       FROM departments d
       JOIN employees e ON e.id = d.head_employee_id
                        OR e.id IN (SELECT employee_id FROM employee_departments WHERE department_id = d.id)
       LEFT JOIN campuses cp ON cp.id = e.campus_id
      WHERE d.id = $1 AND e.deleted_at IS NULL AND e.employment_status <> 'exited'
      ORDER BY (e.id = d.head_employee_id) DESC, e.full_name`, [id]);
}

async function assertRefs(b: { headEmployeeId?: string | null; campusId?: string | null }, db: Queryable) {
  if (b.headEmployeeId) {
    const e = await one('SELECT 1 FROM employees WHERE id = $1 AND deleted_at IS NULL', [b.headEmployeeId], db);
    if (!e) throw badRequest('Employee not found', 'EMPLOYEE_NOT_FOUND', [{ field: 'headEmployeeId', message: 'Not found' }]);
  }
  if (b.campusId) {
    const c = await one('SELECT 1 FROM campuses WHERE id = $1', [b.campusId], db);
    if (!c) throw badRequest('Campus not found', 'CAMPUS_NOT_FOUND', [{ field: 'campusId', message: 'Not found' }]);
  }
}

export async function createDepartment(req: Request, b: any) {
  return tx(async (db) => {
    await assertRefs(b, db);
    const r = await one<{ id: string }>(
      `INSERT INTO departments (name, code, description, head_employee_id, campus_id, is_active, created_by)
       VALUES ($1, upper($2), $3, $4, $5, $6, $7) RETURNING id`,
      [b.name, b.code, b.description ?? null, b.headEmployeeId ?? null, b.campusId ?? null, b.isActive, req.user!.id], db);
    await audit(req, { action: 'create', module: MODULE, description: `Created department ${b.name}`, entityType: 'department', entityId: r!.id }, db);
    return { id: r!.id };
  });
}

export async function updateDepartment(req: Request, id: string, b: any) {
  return tx(async (db) => {
    const d = await one<{ name: string; head_employee_id: string | null }>('SELECT name, head_employee_id FROM departments WHERE id = $1 FOR UPDATE', [id], db);
    if (!d) throw notFound('Department not found');
    await assertRefs(b, db);
    if (b.isActive === false) {
      const open = await one(`SELECT count(*)::int AS n FROM job_cards WHERE to_department_id = $1 AND status NOT IN ${FINAL}`, [id], db);
      if (open?.n) throw badRequest(`${d.name} still has ${open.n} open job card${open.n === 1 ? '' : 's'}; close or cancel them first`, 'HAS_OPEN_CARDS');
    }
    const cols: Record<string, string> = { name: 'name', code: 'code', description: 'description', headEmployeeId: 'head_employee_id', campusId: 'campus_id', isActive: 'is_active' };
    const params: unknown[] = [id];
    const sets: string[] = [];
    for (const [k, col] of Object.entries(cols)) {
      if (b[k] === undefined) continue;
      params.push(k === 'code' ? String(b[k]).toUpperCase() : b[k]);
      sets.push(`${col} = $${params.length}`);
    }
    // Keep the old name as an alias so employee records using it still resolve.
    if (b.name && b.name.toLowerCase() !== d.name.toLowerCase()) {
      params.push(d.name);
      sets.push(`aliases = array_append(array_remove(aliases, $${params.length}), $${params.length})`);
    }
    await query(`UPDATE departments SET ${sets.join(', ')} WHERE id = $1`, params, db);
    await audit(req, { action: 'update', module: MODULE, description: `Updated department ${b.name ?? d.name}`, entityType: 'department', entityId: id, metadata: { changed: Object.keys(b) } }, db);
    if (b.headEmployeeId && b.headEmployeeId !== d.head_employee_id) {
      const head = await one<{ user_id: string | null }>('SELECT user_id FROM employees WHERE id = $1', [b.headEmployeeId], db);
      if (head?.user_id && head.user_id !== req.user!.id) {
        await notifyUsers([head.user_id], {
          category: 'Information', topic: 'jobcards', icon: 'building',
          title: `You are now head of ${b.name ?? d.name}`, body: 'Job cards sent to the department will come to you for assignment.', route: ROUTE,
        }, db);
      }
    }
  });
}
