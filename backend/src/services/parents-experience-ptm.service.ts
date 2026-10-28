/**
 * Parent experience — parent–teacher meetings: sessions per teacher with
 * numbered slots, staff booking management and family self-booking.
 */
import type { Request } from 'express';
import type { AuthUser } from '../types.js';
import { many, one, query, tx } from '../config/db.js';
import { Where } from '../utils/sql.js';
import { limitOffset, likeTerm, orderBy, type Pagination } from '../utils/pagination.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { audit } from './audit.service.js';
import { notifyUsers } from './notification.service.js';
import { isGuardianOf, resolveStudentId } from './access.service.js';
import { isClassScoped, scopeFragment, selfParentId } from './parents-experience.service.js';

const ACTIVE = `b.status <> 'Cancelled'`;

/** hh:mm for slot n of a session. */
export function slotTime(startsAt: string, slotMinutes: number, slotNo: number) {
  const [h, m] = startsAt.split(':').map(Number);
  const t = h * 60 + m + (slotNo - 1) * slotMinutes;
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function sessionScope(user: AuthUser, w: Where) {
  if (!isClassScoped(user)) return w;
  const sc = scopeFragment(user, 'sx');
  // Teachers: their own sessions, or sessions for sections they teach.
  const secScope = sc.sql.replace(/sx\.section_id/g, 'ps.section_id').replace(/^AND /, '');
  return w.add(`(ps.employee_id = ? OR (${secScope}))`, user.employeeId, ...sc.params);
}

const SESSION_SELECT = (extra = '') => `
  SELECT${extra} ps.id, ps.employee_id AS "employeeId", e.full_name AS teacher, e.designation, ps.subject_label AS "subjectLabel",
         ps.section_id AS "sectionId", cl.name AS grade, sec.name AS section, cl.campus_id AS "campusId",
         ps.session_date AS "sessionDate", to_char(ps.starts_at, 'HH24:MI') AS "startsAt", ps.slot_minutes AS "slotMinutes",
         ps.total_slots AS "totalSlots", ps.venue,
         (SELECT count(*)::int FROM ptm_bookings b WHERE b.ptm_session_id = ps.id AND ${ACTIVE}) AS booked,
         (SELECT count(*)::int FROM students s WHERE s.section_id = ps.section_id AND s.deleted_at IS NULL AND s.status = 'active') AS "sectionStudents",
         (ps.session_date < current_date) AS past
    FROM ptm_sessions ps
    JOIN employees e ON e.id = ps.employee_id
    LEFT JOIN sections sec ON sec.id = ps.section_id
    LEFT JOIN classes cl ON cl.id = sec.class_id`;

function sessionWhere(user: AuthUser, f: { when?: string; campusId?: string; employeeId?: string; q?: string }) {
  const w = new Where();
  sessionScope(user, w);
  if (f.when === 'upcoming') w.add('ps.session_date >= current_date');
  if (f.when === 'past') w.add('ps.session_date < current_date');
  w.addIf(f.campusId, 'cl.campus_id = ?');
  w.addIf(f.employeeId, 'ps.employee_id = ?');
  if (f.q) w.add('(e.full_name ILIKE ? OR ps.subject_label ILIKE ?)', likeTerm(f.q), likeTerm(f.q));
  return w;
}

export async function listSessions(user: AuthUser, f: Pagination & { when: string; campusId?: string; employeeId?: string }) {
  const w = sessionWhere(user, f);
  const { limit, offset } = limitOffset(f);
  const dir = f.sort ? f.dir : f.when === 'past' ? 'desc' : 'asc';
  const rows = await many(
    `${SESSION_SELECT(' count(*) OVER() AS total,')} ${w.sql}
      ORDER BY ${orderBy(f.sort, dir, { date: 'ps.session_date', teacher: 'e.full_name', subject: 'ps.subject_label' }, 'date')}, ps.starts_at, e.full_name, ps.id
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params);
  return { rows: rows.map(({ total: _t, ...r }) => ({ ...r, free: r.totalSlots - r.booked })), total: Number(rows[0]?.total ?? 0) };
}

/** KPIs for the PTM screen, over upcoming sessions in scope. */
export async function ptmSummary(user: AuthUser, campusId?: string) {
  const w = sessionWhere(user, { when: 'upcoming', campusId });
  const s = await one(
    `SELECT count(*)::int AS sessions, COALESCE(sum(q."totalSlots"), 0)::int AS "totalSlots", COALESCE(sum(q.booked), 0)::int AS booked,
            min(q."sessionDate") AS "firstDate", max(q."sessionDate") AS "lastDate",
            COALESCE(array_agg(DISTINCT q.grade) FILTER (WHERE q.grade IS NOT NULL), '{}') AS grades,
            COALESCE(array_agg(DISTINCT q.venue) FILTER (WHERE q.venue IS NOT NULL), '{}') AS venues,
            COALESCE(array_agg(DISTINCT q."sectionId") FILTER (WHERE q."sectionId" IS NOT NULL), '{}') AS sections
       FROM (${SESSION_SELECT()} ${w.sql}) q`,
    w.params);
  const sections: string[] = s?.sections ?? [];
  // Children in those sections with no active booking in any upcoming session for their section.
  const unbooked = await one<{ families: number; students: number; prioritise: number }>(
    `SELECT count(DISTINCT pg.parent_id)::int AS families, count(DISTINCT st.id)::int AS students,
            count(DISTINCT pg.parent_id) FILTER (WHERE st.risk_level IN ('At Risk', 'Developing Risk'))::int AS prioritise
       FROM students st
       LEFT JOIN LATERAL (SELECT sg.parent_id FROM student_guardians sg WHERE sg.student_id = st.id
                          ORDER BY sg.is_primary DESC LIMIT 1) pg ON true
      WHERE st.section_id = ANY($1::uuid[]) AND st.deleted_at IS NULL AND st.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM ptm_bookings b JOIN ptm_sessions ps ON ps.id = b.ptm_session_id
                         WHERE b.student_id = st.id AND b.status <> 'Cancelled' AND ps.session_date >= current_date)`,
    [sections]);
  const { sections: _s, ...rest } = s ?? {};
  return { ...rest, unbookedFamilies: unbooked?.families ?? 0, unbookedStudents: unbooked?.students ?? 0, prioritiseFamilies: unbooked?.prioritise ?? 0 };
}

export async function getSession(user: AuthUser, id: string) {
  const w = sessionWhere(user, {});
  w.add('ps.id = ?', id);
  const s = await one(`${SESSION_SELECT()} ${w.sql}`, w.params);
  if (!s) throw notFound('PTM session not found', 'PTM_SESSION_NOT_FOUND');
  const bookings = await many(
    `SELECT b.id, b.slot_no AS "slotNo", b.status, b.created_at AS "bookedAt",
            b.parent_id AS "parentId", p.full_name AS "parentName", p.phone AS "parentPhone",
            b.student_id AS "studentId", st.full_name AS "studentName", st.admission_no AS "admissionNo", st.risk_level AS risk
       FROM ptm_bookings b JOIN parents p ON p.id = b.parent_id JOIN students st ON st.id = b.student_id
      WHERE b.ptm_session_id = $1 ORDER BY b.slot_no`, [id]);
  const bySlot = new Map(bookings.filter((b) => b.status !== 'Cancelled').map((b) => [b.slotNo, b]));
  const slots = Array.from({ length: s.totalSlots }, (_, i) => ({
    slotNo: i + 1, time: slotTime(s.startsAt, s.slotMinutes, i + 1), booking: bySlot.get(i + 1) ?? null,
  }));
  const unbooked = await many(
    `SELECT st.id AS "studentId", st.full_name AS "studentName", st.risk_level AS risk, p.id AS "parentId", p.full_name AS "parentName",
            p.phone AS "parentPhone", (p.user_id IS NOT NULL) AS "hasAppAccount"
       FROM students st
       LEFT JOIN LATERAL (SELECT pp.* FROM student_guardians sg JOIN parents pp ON pp.id = sg.parent_id
                           WHERE sg.student_id = st.id ORDER BY sg.is_primary DESC LIMIT 1) p ON true
      WHERE st.section_id = $1 AND st.deleted_at IS NULL AND st.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM ptm_bookings b WHERE b.ptm_session_id = $2 AND b.student_id = st.id AND b.status <> 'Cancelled')
      ORDER BY (st.risk_level IN ('At Risk', 'Developing Risk')) DESC, st.full_name`,
    [s.sectionId, id]);
  return { ...s, free: s.totalSlots - s.booked, slots, bookings, unbooked };
}

export async function createSession(req: Request, b: {
  employeeId: string; sectionId: string; subjectLabel: string; sessionDate: string; startsAt: string; slotMinutes: number; totalSlots: number; venue?: string;
}) {
  const user = req.user!;
  if (isClassScoped(user) && b.employeeId !== user.employeeId) throw forbidden('Teachers can only create sessions for themselves');
  const emp = await one<{ full_name: string }>(`SELECT full_name FROM employees WHERE id = $1 AND deleted_at IS NULL AND employee_type = 'teaching'`, [b.employeeId]);
  if (!emp) throw badRequest('Choose a teacher', 'INVALID_TEACHER', [{ field: 'employeeId', message: 'Choose a teacher' }]);
  // Teachers may only open sessions for sections they teach or are class teacher of:
  // the session view lists every family in the section with phone numbers.
  const sec = isClassScoped(user)
    ? await one(`SELECT 1 FROM sections sec WHERE sec.id = $1 AND (sec.class_teacher_id = $2
                   OR EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.section_id = sec.id AND ta.employee_id = $2))`, [b.sectionId, user.employeeId])
    : await one('SELECT 1 FROM sections WHERE id = $1', [b.sectionId]);
  if (!sec) throw badRequest('Choose a class section', 'INVALID_SECTION', [{ field: 'sectionId', message: 'Choose a class section' }]);
  const today = await one<{ d: string }>(`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS d`);
  if (b.sessionDate < today!.d) throw badRequest('The session date cannot be in the past', 'INVALID_DATE', [{ field: 'sessionDate', message: 'Choose today or a later date' }]);
  const r = await one<{ id: string }>(
    `INSERT INTO ptm_sessions (employee_id, section_id, subject_label, session_date, starts_at, slot_minutes, total_slots, venue)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [b.employeeId, b.sectionId, b.subjectLabel, b.sessionDate, b.startsAt, b.slotMinutes, b.totalSlots, b.venue ?? null]);
  await audit(req, { action: 'create', module: 'communication', entityType: 'ptm_session', entityId: r!.id, description: `Created PTM session for ${emp.full_name} — ${b.subjectLabel} on ${b.sessionDate}` });
  return getSession(user, r!.id);
}

export async function updateSession(req: Request, id: string, b: { totalSlots?: number; venue?: string; startsAt?: string; sessionDate?: string }) {
  const s = await getSession(req.user!, id);
  if (s.past) throw conflict('Past sessions cannot be changed', 'PTM_SESSION_PAST');
  if (b.sessionDate !== undefined) {
    const today = await one<{ d: string }>(`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS d`);
    if (b.sessionDate < today!.d) throw badRequest('The session date cannot be in the past', 'INVALID_DATE', [{ field: 'sessionDate', message: 'Choose today or a later date' }]);
  }
  if (b.totalSlots !== undefined) {
    const maxSlot = Math.max(0, ...s.bookings.filter((x: any) => x.status !== 'Cancelled').map((x: any) => x.slotNo));
    if (b.totalSlots < maxSlot) throw conflict(`Slot ${maxSlot} is booked, so the session needs at least ${maxSlot} slots`, 'SLOTS_IN_USE');
  }
  await query(
    `UPDATE ptm_sessions SET total_slots = COALESCE($2, total_slots), venue = COALESCE($3, venue),
            starts_at = COALESCE($4::time, starts_at), session_date = COALESCE($5::date, session_date) WHERE id = $1`,
    [id, b.totalSlots ?? null, b.venue ?? null, b.startsAt ?? null, b.sessionDate ?? null]);
  await audit(req, { action: 'update', module: 'communication', entityType: 'ptm_session', entityId: id, description: `Updated PTM session ${s.teacher} — ${s.subjectLabel}`, metadata: b });
  return getSession(req.user!, id);
}

/** Reminds families in the section who have not booked this session. */
export async function notifyUnbooked(req: Request, id: string) {
  const s = await getSession(req.user!, id);
  if (s.past) throw conflict('This session has already taken place', 'PTM_SESSION_PAST');
  const users = await many<{ user_id: string }>(
    `SELECT DISTINCT p.user_id FROM students st JOIN student_guardians sg ON sg.student_id = st.id JOIN parents p ON p.id = sg.parent_id
      WHERE st.section_id = $1 AND st.deleted_at IS NULL AND p.user_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM ptm_bookings b WHERE b.ptm_session_id = $2 AND b.student_id = st.id AND b.status <> 'Cancelled')`,
    [s.sectionId, id]);
  const free = s.totalSlots - s.booked;
  const sent = await notifyUsers(users.map((u) => u.user_id), {
    category: 'Information', topic: 'events', icon: 'calendar', title: `PTM booking is open — ${s.grade ?? ''}${s.section ?? ''}`.trim(),
    body: `${free} of ${s.totalSlots} slots left with ${s.teacher} on ${s.sessionDate}`, route: '/parent-360?tab=more',
    entityType: 'ptm_session', entityId: id, channels: ['push', 'whatsapp'],
  });
  await audit(req, { action: 'create', module: 'communication', entityType: 'ptm_session', entityId: id, description: `Sent PTM booking reminder for ${s.teacher} (${sent.length} parents)` });
  return { notified: sent.length, unbookedStudents: s.unbooked.length };
}

export async function setBookingStatus(req: Request, bookingId: string, status: string) {
  const b = await one<{ sessionId: string; status: string; slotNo: number }>(
    'SELECT ptm_session_id AS "sessionId", status, slot_no AS "slotNo" FROM ptm_bookings WHERE id = $1', [bookingId]);
  if (!b) throw notFound('Booking not found', 'BOOKING_NOT_FOUND');
  const s = await getSession(req.user!, b.sessionId); // scope check
  if (b.status === 'Cancelled' && status !== 'Cancelled') {
    const taken = s.slots.find((x: any) => x.slotNo === b.slotNo)?.booking;
    if (taken) throw conflict('That slot has been booked by another family', 'SLOT_TAKEN');
  }
  await query('UPDATE ptm_bookings SET status = $2 WHERE id = $1', [bookingId, status]);
  await audit(req, { action: 'update', module: 'communication', entityType: 'ptm_booking', entityId: bookingId, description: `PTM booking (slot ${b.slotNo}, ${s.teacher}) marked ${status}` });
  return getSession(req.user!, b.sessionId);
}

// ---- Family ----------------------------------------------------------------------
async function familyChildren(parentId: string, studentRef?: string) {
  if (studentRef) {
    const sid = await resolveStudentId(studentRef);
    if (!(await isGuardianOf(parentId, sid))) throw notFound('Student not found', 'STUDENT_NOT_FOUND');
    return many(`SELECT s.id, s.full_name AS "fullName", s.section_id AS "sectionId" FROM students s WHERE s.id = $1`, [sid]);
  }
  return many(
    `SELECT s.id, s.full_name AS "fullName", s.section_id AS "sectionId" FROM student_guardians sg JOIN students s ON s.id = sg.student_id
      WHERE sg.parent_id = $1 AND s.deleted_at IS NULL ORDER BY s.full_name`, [parentId]);
}

export async function familyPtm(user: AuthUser, studentRef?: string) {
  const parentId = selfParentId(user);
  const children = await familyChildren(parentId, studentRef);
  const childIds = children.map((c) => c.id);
  const sections = [...new Set(children.map((c) => c.sectionId).filter(Boolean))];
  const sessions = await many(
    `SELECT ps.id, e.full_name AS teacher, ps.subject_label AS "subjectLabel", ps.section_id AS "sectionId",
            cl.name || sec.name AS grade, ps.session_date AS "sessionDate", to_char(ps.starts_at, 'HH24:MI') AS "startsAt",
            ps.slot_minutes AS "slotMinutes", ps.total_slots AS "totalSlots", ps.venue,
            COALESCE((SELECT array_agg(b.slot_no ORDER BY b.slot_no) FROM ptm_bookings b WHERE b.ptm_session_id = ps.id AND b.status <> 'Cancelled'), '{}') AS taken
       FROM ptm_sessions ps JOIN employees e ON e.id = ps.employee_id
       JOIN sections sec ON sec.id = ps.section_id JOIN classes cl ON cl.id = sec.class_id
      WHERE ps.section_id = ANY($1::uuid[]) AND ps.session_date >= current_date
      ORDER BY ps.session_date, ps.starts_at, e.full_name`,
    [sections]);
  const bookings = await many(
    `SELECT b.id, b.ptm_session_id AS "sessionId", b.slot_no AS "slotNo", b.status, b.student_id AS "studentId", s.full_name AS "studentName",
            e.full_name AS teacher, ps.subject_label AS "subjectLabel", ps.session_date AS "sessionDate",
            to_char(ps.starts_at, 'HH24:MI') AS "startsAt", ps.slot_minutes AS "slotMinutes", ps.venue
       FROM ptm_bookings b JOIN ptm_sessions ps ON ps.id = b.ptm_session_id JOIN employees e ON e.id = ps.employee_id
       JOIN students s ON s.id = b.student_id
      WHERE b.student_id = ANY($1::uuid[]) AND b.status = 'Booked' AND ps.session_date >= current_date
      ORDER BY ps.session_date, b.slot_no`,
    [childIds]);
  const withTime = bookings.map((b) => ({ ...b, time: slotTime(b.startsAt, b.slotMinutes, b.slotNo) }));
  return sessions.map(({ taken, ...s }) => {
    const takenSet = new Set<number>(taken);
    const freeSlots = Array.from({ length: s.totalSlots }, (_, i) => i + 1).filter((n) => !takenSet.has(n));
    const mine = withTime.filter((b) => b.sessionId === s.id);
    const first = mine[0];
    return {
      ...s,
      children: children.filter((c) => c.sectionId === s.sectionId).map((c) => ({ id: c.id, fullName: c.fullName })),
      booked: takenSet.size,
      freeSlots,
      freeSlotTimes: freeSlots.map((n) => ({ slotNo: n, time: slotTime(s.startsAt, s.slotMinutes, n) })),
      myBooking: first ? { id: first.id, slotNo: first.slotNo, status: first.status, time: first.time, studentId: first.studentId, studentName: first.studentName } : null,
      myBookings: mine,
    };
  });
}

async function familyBookingById(user: AuthUser, id: string) {
  const sessions = await familyPtm(user);
  for (const s of sessions) {
    const b = s.myBookings.find((x: { id: string }) => x.id === id);
    if (b) return { ...b, session: { id: s.id, teacher: s.teacher, subjectLabel: s.subjectLabel, sessionDate: s.sessionDate, venue: s.venue } };
  }
  return { id };
}

export async function familyBook(req: Request, sessionId: string, b: { studentId: string; slotNo: number }) {
  const user = req.user!;
  const parentId = selfParentId(user);
  const studentId = await resolveStudentId(b.studentId);
  if (!(await isGuardianOf(parentId, studentId))) throw notFound('Student not found', 'STUDENT_NOT_FOUND');
  const s = await one<{ id: string; sectionId: string; totalSlots: number; teacherUser: string | null; teacher: string; subjectLabel: string; sessionDate: string; startsAt: string; slotMinutes: number }>(
    `SELECT ps.id, ps.section_id AS "sectionId", ps.total_slots AS "totalSlots", e.user_id AS "teacherUser", e.full_name AS teacher,
            ps.subject_label AS "subjectLabel", ps.session_date AS "sessionDate", to_char(ps.starts_at, 'HH24:MI') AS "startsAt", ps.slot_minutes AS "slotMinutes"
       FROM ptm_sessions ps JOIN employees e ON e.id = ps.employee_id
      WHERE ps.id = $1 AND ps.session_date >= current_date
        AND ps.section_id = (SELECT section_id FROM students WHERE id = $2)`,
    [sessionId, studentId]);
  if (!s) throw notFound('PTM session not found for this child', 'PTM_SESSION_NOT_FOUND');
  if (b.slotNo > s.totalSlots) throw badRequest(`Choose a slot between 1 and ${s.totalSlots}`, 'INVALID_SLOT', [{ field: 'slotNo', message: 'Slot does not exist' }]);
  const student = await one<{ full_name: string }>('SELECT full_name FROM students WHERE id = $1', [studentId]);
  const id = await tx(async (db) => {
    // Serialise bookings per session so two requests for the same child cannot both pass the check below.
    await query('SELECT 1 FROM ptm_sessions WHERE id = $1 FOR UPDATE', [sessionId], db);
    const dup = await one(
      `SELECT 1 FROM ptm_bookings WHERE ptm_session_id = $1 AND student_id = $2 AND status <> 'Cancelled'`, [sessionId, studentId], db);
    if (dup) throw conflict('You already have a slot in this session for this child. Cancel it first to change the time.', 'ALREADY_BOOKED');
    const r = await one<{ id: string }>(
      `INSERT INTO ptm_bookings (ptm_session_id, slot_no, parent_id, student_id, status) VALUES ($1,$2,$3,$4,'Booked')
       ON CONFLICT (ptm_session_id, slot_no) DO UPDATE
         SET parent_id = EXCLUDED.parent_id, student_id = EXCLUDED.student_id, status = 'Booked', created_at = now()
         WHERE ptm_bookings.status = 'Cancelled'
       RETURNING id`,
      [sessionId, b.slotNo, parentId, studentId], db);
    if (!r) throw conflict('That slot has just been taken. Please choose another time.', 'SLOT_TAKEN');
    const time = slotTime(s.startsAt, s.slotMinutes, b.slotNo);
    if (s.teacherUser) {
      await notifyUsers([s.teacherUser], {
        category: 'Information', topic: 'events', icon: 'calendar', title: `PTM slot booked — ${student?.full_name}`,
        body: `${s.subjectLabel} · ${s.sessionDate} at ${time} · ${user.fullName}`, route: '/ptm', entityType: 'ptm_session', entityId: sessionId,
      }, db);
    }
    await notifyUsers([user.id], {
      category: 'Completed', topic: 'events', icon: 'calendar', title: 'PTM slot confirmed',
      body: `${s.teacher} · ${s.sessionDate} at ${time} · ${student?.full_name}`, route: '/parent-360?tab=more', entityType: 'ptm_booking', entityId: r.id,
    }, db);
    await query('UPDATE parents SET engagement_score = LEAST(100, engagement_score + 2) WHERE id = $1', [parentId], db);
    await audit(req, { action: 'create', module: 'communication', entityType: 'ptm_booking', entityId: r.id, description: `Parent booked PTM slot ${b.slotNo} (${time}) with ${s.teacher} for ${student?.full_name}` }, db);
    return r.id;
  });
  return familyBookingById(user, id);
}

export async function familyCancel(req: Request, bookingId: string) {
  const parentId = selfParentId(req.user!);
  const b = await one<{ teacherUser: string | null; teacher: string; slotNo: number; studentName: string; sessionDate: string }>(
    `SELECT e.user_id AS "teacherUser", e.full_name AS teacher, b.slot_no AS "slotNo", s.full_name AS "studentName", ps.session_date AS "sessionDate"
       FROM ptm_bookings b JOIN ptm_sessions ps ON ps.id = b.ptm_session_id JOIN employees e ON e.id = ps.employee_id
       JOIN students s ON s.id = b.student_id
      WHERE b.id = $1 AND b.status = 'Booked' AND ps.session_date >= current_date
        AND b.student_id IN (SELECT student_id FROM student_guardians WHERE parent_id = $2)`,
    [bookingId, parentId]);
  if (!b) throw notFound('Booking not found', 'BOOKING_NOT_FOUND');
  await tx(async (db) => {
    await query(`UPDATE ptm_bookings SET status = 'Cancelled' WHERE id = $1`, [bookingId], db);
    if (b.teacherUser) {
      await notifyUsers([b.teacherUser], {
        category: 'Information', topic: 'events', icon: 'calendar', title: `PTM slot cancelled — ${b.studentName}`,
        body: `Slot ${b.slotNo} on ${b.sessionDate} is free again`, route: '/ptm', entityType: 'ptm_booking', entityId: bookingId,
      }, db);
    }
    await audit(req, { action: 'update', module: 'communication', entityType: 'ptm_booking', entityId: bookingId, description: `Parent cancelled PTM slot ${b.slotNo} with ${b.teacher}` }, db);
  });
  return { id: bookingId, status: 'Cancelled' };
}
