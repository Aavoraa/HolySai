/**
 * Parent contact log — how often parents (and teachers/staff) approach or try
 * to reach the principal and staff.
 *
 * Reads go through the `contact_log_v` view (migration 114), which merges the
 * manual `contact_log_entries` with contacts the app already records:
 * inbound communications, parent-started app conversations, PTM bookings and
 * gate visitors whose phone matches a parent.
 *
 * Scope: holders of `parentlog.read` see the whole log. Everyone else (teachers
 * with only `parentlog.manage`) sees entries they logged, entries that targeted
 * them, and their own approaches.
 */
import type { Request } from 'express';
import type { AuthUser } from '../types.js';
import { many, one, query, tx, type Queryable } from '../config/db.js';
import { Where } from '../utils/sql.js';
import { likeTerm, limitOffset, orderBy } from '../utils/pagination.js';
import { badRequest, notFound } from '../utils/errors.js';
import { nextCode } from '../utils/codes.js';
import { audit } from './audit.service.js';
import { notifyUsers } from './notification.service.js';
import { authorizeStudent, isGuardianOf } from './access.service.js';
import { addParentScope, visibleParent } from './parents-experience.service.js';
import {
  CLOSING_OUTCOMES, type CreateBody, type ListFilters, type PatchBody, type SummaryFilters,
} from '../validators/parentlog.validators.js';

const TZ = 'Asia/Kolkata';
/** Outcomes that count as the contact having been dealt with (repeat-contact rule). */
const RESOLVED_SQL = `'Met', 'Spoke on call', 'Resolved', 'Responded'`;
const total = <T extends { total?: unknown }>(rows: T[]) => Number(rows[0]?.total ?? 0);
const strip = <T extends { total?: unknown }>(rows: T[]) => rows.map(({ total: _t, ...r }) => r);

export const isFullView = (user: AuthUser) => user.permissions.has('parentlog.read');

/** Restricts log rows (alias `l`) to what the user may see. */
function addScope(user: AuthUser, w: Where) {
  if (isFullView(user)) return w;
  return w.add(
    '(l.logged_by = ? OR l.target_user_id = ? OR (?::uuid IS NOT NULL AND (l.target_employee_id = ? OR l.employee_id = ?)))',
    user.id, user.id, user.employeeId, user.employeeId, user.employeeId,
  );
}

function todayKolkata() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const FROM_SQL = `l.occurred_at >= (?::date)::timestamp AT TIME ZONE '${TZ}'`;
const TO_SQL = `l.occurred_at < (?::date + 1)::timestamp AT TIME ZONE '${TZ}'`;

function logWhere(user: AuthUser, f: Partial<ListFilters>) {
  const w = new Where();
  addScope(user, w);
  w.addIf(f.from, FROM_SQL);
  w.addIf(f.to, TO_SQL);
  w.addIf(f.campusId, 'l.campus_id = ?');
  w.addIf(f.contactKind, 'l.contact_kind = ?');
  w.addIf(f.parentId, 'l.parent_id = ?');
  w.addIf(f.target, 'l.target_kind = ?');
  w.addIf(f.targetEmployeeId, 'l.target_employee_id = ?');
  w.addIf(f.channel, 'l.channel = ?');
  w.addIf(f.purpose, 'l.purpose = ?');
  w.addIf(f.outcome, 'l.outcome = ?');
  w.addIf(f.source, 'l.source = ?');
  if (f.open !== undefined) w.add('l.is_open = ?', f.open);
  if (f.q) {
    const t = likeTerm(f.q);
    w.add(`(l.contact_name ILIKE ? OR l.contact_phone ILIKE ? OR l.summary ILIKE ? OR l.student_name ILIKE ?
            OR l.target_name ILIKE ? OR l.code ILIKE ? OR l.parent_code ILIKE ?)`, t, t, t, t, t, t, t);
  }
  return w;
}

const LOG_SELECT = `
  SELECT l.source || ':' || l.source_id AS id, l.source, l.source_id AS "sourceId", l.code, l.occurred_at AS "occurredAt",
         l.campus_id AS "campusId", l.contact_kind AS "contactKind", l.parent_id AS "parentId", l.parent_code AS "parentCode",
         l.employee_id AS "employeeId", l.employee_designation AS "employeeDesignation",
         l.contact_name AS "contactName", l.contact_phone AS "contactPhone",
         l.student_id AS "studentId", l.student_name AS "studentName", l.admission_no AS "admissionNo",
         CASE WHEN l.student_grade IS NOT NULL THEN l.student_grade || COALESCE(' ' || l.student_section, '') END AS grade,
         l.target_kind AS "targetKind", l.target_employee_id AS "targetEmployeeId", l.target_user_id AS "targetUserId",
         l.target_name AS "targetName", l.target_designation AS "targetDesignation",
         l.channel, l.purpose, l.outcome, l.is_open AS "isOpen", l.summary, l.details,
         l.logged_by AS "loggedBy", l.logged_by_name AS "loggedByName", l.follow_up_on AS "followUpOn", l.resolved_at AS "resolvedAt",
         (l.is_open AND l.follow_up_on IS NOT NULL AND l.follow_up_on < (now() AT TIME ZONE '${TZ}')::date) AS "followUpOverdue"
    FROM contact_log_v l`;

const SORTS: Record<string, string> = {
  occurredAt: '"occurredAt"', contact: '"contactName"', target: '"targetName"', channel: 'channel',
  purpose: 'purpose', outcome: 'outcome', source: 'source', followUpOn: '"followUpOn"',
};

export async function listLog(user: AuthUser, f: ListFilters) {
  const w = logWhere(user, f);
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT q.*, count(*) OVER() AS total FROM (${LOG_SELECT} ${w.sql}) q
      ORDER BY ${orderBy(f.sort ?? 'occurredAt', f.sort ? f.dir : 'desc', SORTS, 'occurredAt')}, q.id
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows: strip(rows), total: total(rows) };
}

async function getManualRow(user: AuthUser, id: string, db?: Queryable) {
  const w = new Where();
  addScope(user, w);
  w.add(`l.source = 'manual'`).add('l.source_id = ?', id);
  const row = await one(`${LOG_SELECT} ${w.sql}`, w.params, db);
  if (!row) throw notFound('Contact log entry not found', 'CONTACT_LOG_NOT_FOUND');
  return row;
}

// =============================================================================
// Summary
// =============================================================================
export async function summary(user: AuthUser, f: SummaryFilters) {
  const to = f.to ?? todayKolkata();
  const from = f.from ?? addDays(to, -29);
  const repeatFrom = addDays(to, -13);
  const w = logWhere(user, { from, to, campusId: f.campusId });
  const base = `SELECT l.* FROM contact_log_v l ${w.sql}`;
  const p = w.params;

  const totals = await one(
    `WITH r AS (${base})
     SELECT count(*)::int AS total,
            count(*) FILTER (WHERE target_kind = 'principal')::int AS "toPrincipal",
            count(*) FILTER (WHERE target_kind = 'principal' AND outcome IN ('Not available', 'Message left', 'Callback scheduled', 'Pending'))::int AS "principalUnreached",
            count(*) FILTER (WHERE target_kind = 'principal' AND is_open)::int AS "principalOpen",
            count(*) FILTER (WHERE is_open)::int AS open,
            count(*) FILTER (WHERE is_open AND follow_up_on IS NOT NULL AND follow_up_on < (now() AT TIME ZONE '${TZ}')::date)::int AS "followUpsOverdue",
            count(*) FILTER (WHERE contact_kind = 'parent')::int AS "fromParents",
            count(*) FILTER (WHERE contact_kind IN ('teacher', 'staff'))::int AS "fromStaff",
            count(*) FILTER (WHERE contact_kind = 'other')::int AS "fromOthers",
            count(DISTINCT parent_id)::int AS "distinctParents",
            count(*) FILTER (WHERE source = 'manual')::int AS manual,
            count(*) FILTER (WHERE source <> 'manual')::int AS automatic
       FROM r`, p);

  const group = (col: string) => many<{ key: string; n: number }>(
    `WITH r AS (${base}) SELECT ${col} AS key, count(*)::int AS n FROM r GROUP BY 1 ORDER BY n DESC, key`, p);
  const [byChannel, byPurpose, byOutcome, bySource, byTarget] = await Promise.all([
    group('channel'), group('purpose'), group('outcome'), group('source'), group('target_kind'),
  ]);

  const byWeek = await many(
    `WITH r AS (${base}),
          wk AS (SELECT generate_series(date_trunc('week', $${p.length + 1}::date), date_trunc('week', $${p.length + 2}::date), interval '7 days')::date AS week)
     SELECT to_char(wk.week, 'YYYY-MM-DD') AS week,
            count(r.source_id)::int AS total,
            count(r.source_id) FILTER (WHERE r.target_kind = 'principal')::int AS "toPrincipal",
            count(r.source_id) FILTER (WHERE r.is_open)::int AS open
       FROM wk LEFT JOIN r ON date_trunc('week', r.occurred_at AT TIME ZONE '${TZ}')::date = wk.week
      GROUP BY wk.week ORDER BY wk.week`, [...p, from, to]);

  const topParents = await many(
    `WITH r AS (${base})
     SELECT r.parent_id AS "parentId", max(r.contact_name) AS "fullName", max(r.parent_code) AS "parentCode", max(r.contact_phone) AS phone,
            count(*)::int AS contacts,
            count(*) FILTER (WHERE r.target_kind = 'principal')::int AS "toPrincipal",
            count(*) FILTER (WHERE r.is_open)::int AS open,
            max(r.occurred_at) AS "lastContactAt",
            (array_agg(r.channel ORDER BY r.occurred_at DESC))[1] AS "lastChannel",
            (array_agg(r.purpose ORDER BY r.occurred_at DESC))[1] AS "lastPurpose"
       FROM r WHERE r.parent_id IS NOT NULL
      GROUP BY r.parent_id
      ORDER BY contacts DESC, "toPrincipal" DESC, "lastContactAt" DESC
      LIMIT 10`, p);

  // Repeat contacts: three or more attempts in the 14 days ending `to`, none resolved.
  const rw = logWhere(user, { from: repeatFrom, to, campusId: f.campusId });
  const repeatContacts = await many(
    `WITH r AS (SELECT l.* FROM contact_log_v l ${rw.sql} AND l.source <> 'ptm')
     SELECT COALESCE(r.parent_id::text, r.employee_id::text, lower(r.contact_name)) AS key,
            max(r.parent_id::text)::uuid AS "parentId", max(r.employee_id::text)::uuid AS "employeeId",
            max(r.contact_kind) AS "contactKind", max(r.contact_name) AS "contactName", max(r.contact_phone) AS phone,
            count(*)::int AS attempts,
            count(*) FILTER (WHERE r.target_kind = 'principal')::int AS "toPrincipal",
            min(r.occurred_at) AS "firstAt", max(r.occurred_at) AS "lastAt",
            array_agg(DISTINCT r.channel) AS channels,
            (array_agg(r.purpose ORDER BY r.occurred_at DESC))[1] AS "lastPurpose",
            (array_agg(r.outcome ORDER BY r.occurred_at DESC))[1] AS "lastOutcome",
            (array_agg(r.target_name ORDER BY r.occurred_at DESC))[1] AS "lastTarget"
       FROM r
      GROUP BY 1
     HAVING count(*) >= 3 AND count(*) FILTER (WHERE r.outcome IN (${RESOLVED_SQL})) = 0
      ORDER BY attempts DESC, "lastAt" DESC
      LIMIT 20`, rw.params);

  const staffApproached = await many(
    `WITH r AS (${base})
     SELECT r.target_employee_id AS "employeeId", max(r.target_name) AS "fullName", max(r.target_designation) AS designation,
            count(*)::int AS contacts, count(*) FILTER (WHERE r.is_open)::int AS open,
            count(*) FILTER (WHERE r.contact_kind = 'parent')::int AS "fromParents"
       FROM r WHERE r.target_employee_id IS NOT NULL AND r.target_kind <> 'principal'
      GROUP BY r.target_employee_id
      ORDER BY contacts DESC, "fullName"
      LIMIT 8`, p);

  const principal = await principalTarget();
  const toMap = (rows: { key: string; n: number }[]) => rows.map((r) => ({ key: r.key, n: r.n }));
  return {
    range: { from, to, repeatFrom },
    scope: isFullView(user) ? 'all' : 'mine',
    principal: principal ? { employeeId: principal.employeeId, fullName: principal.fullName } : null,
    totals: { ...totals, repeatContacts: repeatContacts.length },
    byChannel: toMap(byChannel), byPurpose: toMap(byPurpose), byOutcome: toMap(byOutcome), bySource: toMap(bySource), byTarget: toMap(byTarget),
    byWeek, topParents, repeatContacts, staffApproached,
  };
}

// =============================================================================
// One parent's history
// =============================================================================
export async function parentHistory(user: AuthUser, parentId: string) {
  let parent: { id: string; fullName: string } | null;
  if (isFullView(user)) {
    parent = await one<{ id: string; fullName: string }>('SELECT id, full_name AS "fullName" FROM parents WHERE id = $1 AND deleted_at IS NULL', [parentId]);
    if (!parent) throw notFound('Parent not found', 'PARENT_NOT_FOUND');
  } else {
    parent = await visibleParent(user, parentId);
  }
  const profile = await one(
    `SELECT p.id, p.parent_code AS "parentCode", p.full_name AS "fullName", p.phone, p.alt_phone AS "altPhone", p.email,
            p.preferred_channel AS "preferredChannel", (p.user_id IS NOT NULL) AS "hasAppAccount",
            COALESCE((SELECT json_agg(json_build_object('id', s.id, 'fullName', s.full_name, 'admissionNo', s.admission_no,
                                                        'grade', c.name, 'section', sec.name) ORDER BY s.full_name)
                        FROM student_guardians sg JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL
                        LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
                       WHERE sg.parent_id = p.id), '[]') AS children
       FROM parents p WHERE p.id = $1`, [parent.id]);

  const w = logWhere(user, { parentId: parent.id });
  const rows = await many(`${LOG_SELECT} ${w.sql} ORDER BY "occurredAt" DESC LIMIT 300`, w.params);
  const counts = await one(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE l.target_kind = 'principal')::int AS "toPrincipal",
            count(*) FILTER (WHERE l.is_open)::int AS open,
            count(*) FILTER (WHERE l.occurred_at >= now() - interval '30 days')::int AS "last30Days",
            count(*) FILTER (WHERE l.occurred_at >= now() - interval '14 days')::int AS "last14Days",
            min(l.occurred_at) AS "firstAt", max(l.occurred_at) AS "lastAt"
       FROM contact_log_v l ${w.sql}`, w.params);
  const bySource = await many<{ key: string; n: number }>(
    `SELECT l.source AS key, count(*)::int AS n FROM contact_log_v l ${w.sql} GROUP BY 1 ORDER BY n DESC`, w.params);
  const byChannel = await many<{ key: string; n: number }>(
    `SELECT l.channel AS key, count(*)::int AS n FROM contact_log_v l ${w.sql} GROUP BY 1 ORDER BY n DESC`, w.params);
  return {
    parent: profile,
    counts: { ...counts, bySource: Object.fromEntries(bySource.map((b) => [b.key, b.n])), byChannel: Object.fromEntries(byChannel.map((b) => [b.key, b.n])) },
    rows,
    scope: isFullView(user) ? 'all' : 'mine',
  };
}

// =============================================================================
// Lookups
// =============================================================================
async function principalTarget(db?: Queryable) {
  return one<{ userId: string; employeeId: string | null; fullName: string; campusId: string | null }>(
    `SELECT u.id AS "userId", e.id AS "employeeId", COALESCE(e.full_name, u.full_name) AS "fullName", COALESCE(e.campus_id, u.campus_id) AS "campusId"
       FROM users u JOIN roles r ON r.id = u.role_id AND r.key = 'principal'
       LEFT JOIN employees e ON e.user_id = u.id AND e.deleted_at IS NULL
      WHERE u.deleted_at IS NULL AND u.status = 'active'
      ORDER BY u.created_at LIMIT 1`, [], db);
}

export async function targets(campusId?: string) {
  const principal = await principalTarget();
  const w = new Where().add('e.deleted_at IS NULL').add(`e.employment_status <> 'exited'`);
  w.addIf(campusId, 'e.campus_id = ?');
  const staff = await many(
    `SELECT e.id, e.employee_code AS "employeeCode", e.full_name AS "fullName", e.designation, e.department,
            e.employee_type AS "employeeType", e.campus_id AS "campusId", (e.user_id IS NOT NULL) AS "hasAccount",
            (e.user_id IS NOT NULL AND e.user_id = $${w.params.length + 1}::uuid) AS "isPrincipal"
       FROM employees e ${w.sql}
      ORDER BY (e.department = 'Leadership') DESC, e.full_name`,
    [...w.params, principal?.userId ?? null],
  );
  return { principal, staff };
}

export async function searchParents(user: AuthUser, q: string, limit: number) {
  const t = likeTerm(q);
  const w = new Where().add('p.deleted_at IS NULL')
    .add('(p.full_name ILIKE ? OR p.phone ILIKE ? OR p.alt_phone ILIKE ? OR p.parent_code ILIKE ? OR EXISTS (SELECT 1 FROM student_guardians sgq JOIN students sq ON sq.id = sgq.student_id WHERE sgq.parent_id = p.id AND (sq.full_name ILIKE ? OR sq.admission_no ILIKE ?)))',
      t, t, t, t, t, t);
  if (!isFullView(user)) addParentScope(user, w);
  return many(
    `SELECT p.id, p.parent_code AS "parentCode", p.full_name AS "fullName", p.phone,
            COALESCE((SELECT json_agg(json_build_object('id', s.id, 'fullName', s.full_name, 'admissionNo', s.admission_no,
                                                        'grade', c.name, 'section', sec.name, 'campusId', s.campus_id) ORDER BY s.full_name)
                        FROM student_guardians sg JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL
                        LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
                       WHERE sg.parent_id = p.id), '[]') AS children
       FROM parents p ${w.sql}
      ORDER BY p.full_name LIMIT ${w.param(limit)}`,
    w.params,
  );
}

// =============================================================================
// Manual entries
// =============================================================================
const KIND_LABEL: Record<string, string> = {
  principal: 'the Principal', office: 'the front office', management: 'management', class_teacher: 'the class teacher', staff: 'staff',
};

export async function createEntry(req: Request, b: CreateBody) {
  const user = req.user!;

  // Who approached
  let parentId: string | null = null;
  let employeeId: string | null = null;
  let contactName = b.contactName ?? '';
  let contactPhone = b.contactPhone || null;
  let campusId = b.campusId ?? null;
  if (b.contactKind === 'parent') {
    const p = isFullView(user) || user.permissions.has('students.read')
      ? await one<{ id: string; fullName: string; phone: string }>('SELECT id, full_name AS "fullName", phone FROM parents WHERE id = $1 AND deleted_at IS NULL', [b.parentId])
      : await visibleParent(user, b.parentId!);
    if (!p) throw notFound('Parent not found', 'PARENT_NOT_FOUND');
    parentId = p.id; contactName = p.fullName; contactPhone = contactPhone ?? p.phone;
  } else if (b.contactKind === 'teacher' || b.contactKind === 'staff') {
    const e = await one<{ id: string; fullName: string; phone: string | null; campusId: string }>(
      'SELECT id, full_name AS "fullName", phone, campus_id AS "campusId" FROM employees WHERE id = $1 AND deleted_at IS NULL', [b.employeeId]);
    if (!e) throw badRequest('Staff member not found', 'EMPLOYEE_NOT_FOUND', [{ field: 'employeeId', message: 'Staff member not found' }]);
    employeeId = e.id; contactName = e.fullName; contactPhone = contactPhone ?? e.phone; campusId = campusId ?? e.campusId;
  }

  // About which student
  let studentId: string | null = null;
  let studentCampus: string | null = null;
  let classTeacherId: string | null = null;
  if (b.studentId) {
    if (parentId) {
      if (!(await isGuardianOf(parentId, b.studentId))) {
        throw badRequest('This student is not linked to the selected parent', 'STUDENT_NOT_LINKED', [{ field: 'studentId', message: 'Not a child of this parent' }]);
      }
      studentId = b.studentId;
    } else {
      studentId = await authorizeStudent(req, b.studentId);
    }
    const s = await one<{ campusId: string; classTeacherId: string | null }>(
      `SELECT s.campus_id AS "campusId", sec.class_teacher_id AS "classTeacherId" FROM students s LEFT JOIN sections sec ON sec.id = s.section_id WHERE s.id = $1`, [studentId]);
    studentCampus = s?.campusId ?? null; classTeacherId = s?.classTeacherId ?? null;
  }

  // Whom they wanted to reach
  let targetEmployeeId: string | null = null;
  let targetUserId: string | null = null;
  let targetName: string = KIND_LABEL[b.targetKind];
  if (b.targetKind === 'principal') {
    const pr = await principalTarget();
    targetEmployeeId = pr?.employeeId ?? null; targetUserId = pr?.userId ?? null; targetName = pr?.fullName ?? 'the Principal';
  } else {
    const empId = b.targetEmployeeId ?? (b.targetKind === 'class_teacher' ? classTeacherId : null);
    if (b.targetKind === 'class_teacher' && !empId) {
      throw badRequest('Choose the class teacher, or pick a student so the class teacher can be found', 'TARGET_REQUIRED', [{ field: 'targetEmployeeId', message: 'Choose the class teacher' }]);
    }
    if (empId) {
      const e = await one<{ id: string; userId: string | null; fullName: string }>(
        'SELECT id, user_id AS "userId", full_name AS "fullName" FROM employees WHERE id = $1 AND deleted_at IS NULL', [empId]);
      if (!e) throw badRequest('Staff member not found', 'EMPLOYEE_NOT_FOUND', [{ field: 'targetEmployeeId', message: 'Staff member not found' }]);
      targetEmployeeId = e.id; targetUserId = e.userId; targetName = e.fullName;
    }
  }

  if (!campusId) {
    campusId = studentCampus;
    if (!campusId && parentId) {
      campusId = (await one<{ id: string }>(
        `SELECT s.campus_id AS id FROM student_guardians sg JOIN students s ON s.id = sg.student_id WHERE sg.parent_id = $1 ORDER BY s.full_name LIMIT 1`, [parentId]))?.id ?? null;
    }
    campusId = campusId ?? user.campusId;
  }

  const closed = CLOSING_OUTCOMES.includes(b.outcome);
  const id = await tx(async (db) => {
    const code = await nextCode('contact_log_entries', 'code', 'CL-', db);
    const r = await one<{ id: string }>(
      `INSERT INTO contact_log_entries (code, campus_id, contact_kind, parent_id, employee_id, contact_name, contact_phone, student_id,
              target_kind, target_employee_id, target_user_id, channel, purpose_category, summary, outcome, follow_up_on,
              resolved_at, resolved_by, logged_by, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,COALESCE($20::timestamptz, now())) RETURNING id`,
      [code, campusId, b.contactKind, parentId, employeeId, contactName, contactPhone, studentId,
        b.targetKind, targetEmployeeId, targetUserId, b.channel, b.purpose, b.summary, b.outcome, b.followUpOn ?? null,
        closed ? new Date() : null, closed ? user.id : null, user.id, b.occurredAt ?? null], db);
    const entryId = r!.id;

    // Repeat-contact check (this parent / staff member, last 14 days, none resolved).
    let repeat = 0;
    if (parentId || employeeId) {
      const rep = await one<{ n: number; resolved: number }>(
        `SELECT count(*)::int AS n, count(*) FILTER (WHERE outcome IN (${RESOLVED_SQL}))::int AS resolved FROM contact_log_v
          WHERE ${parentId ? 'parent_id' : 'employee_id'} = $1 AND occurred_at >= now() - interval '14 days' AND source <> 'ptm'`,
        [parentId ?? employeeId], db);
      if (rep && rep.n >= 3 && rep.resolved === 0) repeat = rep.n;
    }

    if (targetUserId && targetUserId !== user.id && !closed) {
      await notifyUsers([targetUserId], {
        category: repeat ? 'Attention' : 'Information', topic: 'communication', icon: b.channel === 'Phone call' ? 'phone' : 'users',
        title: `${contactName} ${b.channel === 'Walk-in' ? 'came to meet you' : 'tried to reach you'}`,
        body: `${b.channel} · ${b.purpose} — ${b.summary.slice(0, 300)}${repeat ? ` (${repeat} attempts in the last 14 days)` : ''}`,
        route: parentId ? `/parent-log?parent=${parentId}` : '/parent-log', entityType: 'contact_log_entry', entityId: entryId,
      }, db);
    }
    await audit(req, {
      action: 'create', module: 'parentlog', entityType: 'contact_log_entry', entityId: entryId,
      description: `Logged ${b.channel.toLowerCase()} — ${contactName} wanted to reach ${targetName} (${b.purpose}, ${b.outcome}) [${code}]`,
      metadata: { contactKind: b.contactKind, targetKind: b.targetKind, outcome: b.outcome, repeat },
    }, db);
    return entryId;
  });
  return getManualRow(user, id);
}

export async function updateEntry(req: Request, id: string, b: PatchBody) {
  const user = req.user!;
  const before = await getManualRow(user, id) as { code: string; outcome: string; resolvedAt: string | null; contactName: string };
  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (b.outcome !== undefined) set('outcome', b.outcome);
  if (b.followUpOn !== undefined) set('follow_up_on', b.followUpOn);
  if (b.resolutionNote !== undefined) set('resolution_note', b.resolutionNote || null);
  if (b.summary !== undefined) set('summary', b.summary);
  if (b.purpose !== undefined) set('purpose_category', b.purpose);

  const closing = b.resolved === true || (b.outcome !== undefined && CLOSING_OUTCOMES.includes(b.outcome));
  const reopening = b.resolved === false || (b.outcome !== undefined && !CLOSING_OUTCOMES.includes(b.outcome) && b.resolved !== true);
  if (b.resolved === true && b.outcome === undefined && !CLOSING_OUTCOMES.includes(before.outcome)) set('outcome', 'Resolved');
  if (closing && !before.resolvedAt) { sets.push('resolved_at = now()'); set('resolved_by', user.id); }
  if (reopening && before.resolvedAt) { sets.push('resolved_at = NULL', 'resolved_by = NULL'); }
  if (b.resolved === false && b.outcome === undefined && CLOSING_OUTCOMES.includes(before.outcome)) set('outcome', 'Pending');
  if (!sets.length) return before;

  await tx(async (db) => {
    params.push(id);
    await query(`UPDATE contact_log_entries SET ${sets.join(', ')} WHERE id = $${params.length}`, params, db);
    const changes = Object.entries(b).filter(([, x]) => x !== undefined).map(([k, x]) => `${k}: ${x === null ? '—' : String(x).slice(0, 60)}`).join(', ');
    await audit(req, {
      action: 'update', module: 'parentlog', entityType: 'contact_log_entry', entityId: id,
      description: `Updated contact ${before.code} (${before.contactName}) — ${changes}`,
      metadata: { before: { outcome: before.outcome, resolvedAt: before.resolvedAt }, changes: b },
    }, db);
  });
  return getManualRow(user, id);
}
