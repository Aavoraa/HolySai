import type { Request } from 'express';
import { many, one, query, tx, type Queryable } from '../config/db.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { readCsvRecords, type ImportRowResult } from '../utils/csv.js';
import { audit } from './audit.service.js';
import { notifyUsers } from './notification.service.js';
import {
  authorizeSection, isRestricted, isoDow, schoolMinutesNow, schoolToday,
} from './academics.service.js';
import { DAY_NAMES } from './academics-shared.js';
import type { AuthUser } from '../types.js';

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const ENTRY_SQL = `
  SELECT te.id, te.section_id AS "sectionId", c.name || sec.name AS "sectionLabel", te.day_of_week AS day,
         p.period_no AS "periodNo", to_char(p.starts_at, 'HH24:MI') AS "startsAt", to_char(p.ends_at, 'HH24:MI') AS "endsAt",
         te.subject_id AS "subjectId", sub.name AS subject, sub.code AS "subjectCode", te.activity,
         te.employee_id AS "employeeId", e.full_name AS teacher,
         te.substitute_id AS "substituteId", se.full_name AS substitute,
         te.room, te.needs_substitute AS "needsSubstitute"
    FROM timetable_entries te
    JOIN periods p ON p.id = te.period_id
    JOIN sections sec ON sec.id = te.section_id
    JOIN classes c ON c.id = sec.class_id
    LEFT JOIN subjects sub ON sub.id = te.subject_id
    LEFT JOIN employees e ON e.id = te.employee_id
    LEFT JOIN employees se ON se.id = te.substitute_id`;

// =============================================================================
// Teacher dashboard
// =============================================================================
export async function teacherDashboard(user: AuthUser) {
  const today = schoolToday();
  const dow = isoDow(today);
  const nowMin = schoolMinutesNow();
  const me = user.employeeId;
  const tasks = await many(
    `SELECT t.id, t.code, t.title, t.module, t.due_on AS "dueOn", t.priority, t.status, t.route, (t.due_on < current_date) AS overdue
       FROM tasks t
      WHERE (t.assignee_user_id = $1 OR t.assignee_role_key = $2) AND t.status IN ('Pending', 'Under Review')
      ORDER BY t.due_on NULLS LAST, array_position(ARRAY['High','Medium','Low'], t.priority) LIMIT 5`,
    [user.id, user.roleKey],
  );
  const base = { date: today, dayName: DAY_NAMES[dow - 1] ?? 'Sunday', tasks };
  if (!me) {
    return { ...base, employee: null, classes: [], today: [], watchlist: [], watchCount: 0, homework: [], kpis: null, lede: 'Your account is not linked to a staff record, so there are no classes to show.' };
  }

  const [employee, sections, week, pendingMarks, watchlist, watchCount, homework] = await Promise.all([
    one(`SELECT id, full_name AS "fullName", designation, campus_id AS "campusId" FROM employees WHERE id = $1`, [me]),
    many(
      `WITH mine AS (
         SELECT ta.section_id FROM teacher_assignments ta WHERE ta.employee_id = $1 AND ta.academic_year_id = (SELECT id FROM academic_years WHERE is_current)
         UNION SELECT id FROM sections WHERE class_teacher_id = $1 AND academic_year_id = (SELECT id FROM academic_years WHERE is_current))
       SELECT sec.id, c.name || sec.name AS name, c.grade_level AS "gradeLevel",
              COALESCE((SELECT string_agg(DISTINCT sub.name, ', ') FROM teacher_assignments ta JOIN subjects sub ON sub.id = ta.subject_id
                         WHERE ta.section_id = sec.id AND ta.employee_id = $1), 'Class teacher') AS subject,
              (sec.class_teacher_id = $1) AS "isClassTeacher", sec.room,
              (SELECT count(*)::int FROM students s WHERE s.section_id = sec.id AND s.deleted_at IS NULL AND s.status = 'active') AS students,
              (SELECT count(*)::int FROM attendance_records a JOIN students s ON s.id = a.student_id AND s.deleted_at IS NULL AND s.status = 'active'
                WHERE a.section_id = sec.id AND a.attendance_date = $2) AS marked
         FROM sections sec JOIN classes c ON c.id = sec.class_id
        WHERE sec.id IN (SELECT section_id FROM mine)
        ORDER BY c.grade_level, sec.name`,
      [me, today],
    ),
    many(`${ENTRY_SQL} WHERE (te.employee_id = $1 AND te.substitute_id IS NULL) OR te.substitute_id = $1 ORDER BY te.day_of_week, p.period_no`, [me]),
    many(
      `SELECT a.id, a.code, a.name, a.status, a.held_on AS "heldOn",
              (SELECT count(*)::int FROM students s WHERE s.deleted_at IS NULL AND s.status = 'active'
                 AND s.section_id IN (SELECT ta.section_id FROM teacher_assignments ta WHERE ta.employee_id = $1 AND ta.subject_id = a.subject_id)
                 AND (a.section_id IS NULL AND s.section_id IN (SELECT id FROM sections WHERE class_id = a.class_id) OR s.section_id = a.section_id)) AS roster,
              (SELECT count(*)::int FROM assessment_marks m JOIN students s ON s.id = m.student_id
                WHERE m.assessment_id = a.id AND (m.marks IS NOT NULL OR m.is_absent)
                  AND s.section_id IN (SELECT ta.section_id FROM teacher_assignments ta WHERE ta.employee_id = $1 AND ta.subject_id = a.subject_id)) AS entered
         FROM assessments a
        WHERE a.status IN ('Scheduled', 'In Progress') AND a.held_on <= $2
          AND a.academic_year_id = (SELECT id FROM academic_years WHERE is_current)
          AND EXISTS (SELECT 1 FROM teacher_assignments ta JOIN sections sx ON sx.id = ta.section_id
                       WHERE ta.employee_id = $1 AND ta.subject_id = a.subject_id AND sx.class_id = a.class_id
                         AND (a.section_id IS NULL OR a.section_id = ta.section_id))`,
      [me, today],
    ),
    many(
      `SELECT w.id, w.code, w.signal, w.signal_type AS "signalType", w.stage, w.raised_on AS "raisedOn",
              s.id AS "studentId", s.full_name AS name, s.admission_no AS "admissionNo", c.name || sec.name AS "sectionLabel"
         FROM early_warning_signals w
         JOIN students s ON s.id = w.student_id AND s.deleted_at IS NULL
         JOIN sections sec ON sec.id = s.section_id JOIN classes c ON c.id = sec.class_id
        WHERE w.closed_at IS NULL AND COALESCE(w.review_decision, '') <> 'dismissed'
          AND s.section_id IN (SELECT ta.section_id FROM teacher_assignments ta WHERE ta.employee_id = $1 UNION SELECT id FROM sections WHERE class_teacher_id = $1)
        ORDER BY (w.signal_type = 'attendance') DESC, w.raised_on DESC LIMIT 6`,
      [me],
    ),
    one<{ n: number }>(
      `SELECT count(*)::int AS n FROM early_warning_signals w JOIN students s ON s.id = w.student_id AND s.deleted_at IS NULL
        WHERE w.closed_at IS NULL AND COALESCE(w.review_decision, '') <> 'dismissed'
          AND s.section_id IN (SELECT ta.section_id FROM teacher_assignments ta WHERE ta.employee_id = $1 UNION SELECT id FROM sections WHERE class_teacher_id = $1)`,
      [me],
    ),
    many(
      `SELECT h.id, h.title, sub.name AS subject, c.name || sec.name AS "sectionLabel", h.due_on AS "dueOn", h.status,
              (SELECT count(*)::int FROM homework_submissions hs WHERE hs.homework_id = h.id) AS submitted,
              (SELECT count(*)::int FROM students s WHERE s.section_id = h.section_id AND s.deleted_at IS NULL AND s.status = 'active') AS "of"
         FROM homework h JOIN subjects sub ON sub.id = h.subject_id
         JOIN sections sec ON sec.id = h.section_id JOIN classes c ON c.id = sec.class_id
        WHERE h.status = 'Open'
          AND (h.assigned_by = $1 OR h.section_id IN (SELECT id FROM sections WHERE class_teacher_id = $1))
        ORDER BY (h.section_id IN (SELECT id FROM sections WHERE class_teacher_id = $1)) DESC, h.due_on LIMIT 6`,
      [me],
    ),
  ]);

  // Today's periods (teaching + cover), with free periods between them.
  const todays = week.filter((e) => e.day === dow);
  const periods = await many<{ periodNo: number; startsAt: string; endsAt: string }>(
    `SELECT period_no AS "periodNo", to_char(starts_at, 'HH24:MI') AS "startsAt", to_char(ends_at, 'HH24:MI') AS "endsAt"
       FROM periods WHERE campus_id = $1 ORDER BY period_no`,
    [employee?.campusId],
  );
  const todayList: Record<string, unknown>[] = [];
  if (todays.length) {
    const first = todays[0].periodNo;
    const last = todays[todays.length - 1].periodNo;
    for (const p of periods.filter((x) => x.periodNo >= first && x.periodNo <= last)) {
      const e = todays.find((t) => t.periodNo === p.periodNo);
      const state = toMin(p.startsAt) <= nowMin && nowMin < toMin(p.endsAt) ? 'now' : toMin(p.endsAt) <= nowMin ? 'done' : 'upcoming';
      todayList.push(e
        ? { periodNo: p.periodNo, startsAt: p.startsAt, endsAt: p.endsAt, what: `${e.sectionLabel} ${e.subject ?? e.activity ?? ''}`.trim(), where: e.room ?? '—', sectionId: e.sectionId, cover: e.substituteId === me, state }
        : { periodNo: p.periodNo, startsAt: p.startsAt, endsAt: p.endsAt, what: 'Free period', where: 'Staff room', free: true, state });
    }
  }

  // Next lesson per section (today after now, else the next school day).
  const nextFor = (sectionId: string) => {
    const later = week.filter((e) => e.sectionId === sectionId);
    const t = later.find((e) => e.day === dow && toMin(e.endsAt) > nowMin);
    if (t) return { label: `Period ${t.periodNo} · ${t.startsAt}`, today: true };
    for (let k = 1; k <= 6; k++) {
      const d = ((dow - 1 + k) % 7) + 1;
      const n = later.find((e) => e.day === d);
      if (n) return { label: k === 1 ? `Tomorrow · P${n.periodNo}` : `${DAY_NAMES[d - 1]} · P${n.periodNo}`, today: false };
    }
    return { label: 'Not timetabled', today: false };
  };
  const classes = sections.map((s) => {
    const hasToday = todays.some((e) => e.sectionId === s.id);
    const next = nextFor(s.id);
    const attendance = s.students === 0 ? '—' : s.marked >= s.students ? 'Marked' : s.marked > 0 ? 'Pending' : hasToday || s.isClassTeacher ? 'Not marked' : '—';
    return { ...s, next: next.label, hasClassToday: hasToday, attendance };
  });
  const toMark = classes.filter((c) => c.attendance === 'Not marked' || c.attendance === 'Pending');
  const pending = pendingMarks.map((a) => ({ ...a, pending: Math.max(0, a.roster - a.entered) })).filter((a) => a.pending > 0);
  const pendingTotal = pending.reduce((a, x) => a + x.pending, 0);
  const teachingToday = new Set(todays.map((e) => e.sectionId)).size;
  return {
    ...base,
    employee,
    lede: `${teachingToday === 0 ? 'No classes' : teachingToday === 1 ? 'One class' : `${teachingToday} classes`} today. ${toMark.length === 0 ? 'Every register is up to date.' : toMark.length === 1 ? 'One is waiting on attendance.' : `${toMark.length} are waiting on attendance.`}`,
    kpis: {
      classes: classes.length,
      students: classes.reduce((a, c) => a + c.students, 0),
      toMark: toMark.length,
      toMarkNames: toMark.map((c) => c.name),
      marksPending: pendingTotal,
      marksPendingFoot: pending.sort((a, b) => b.pending - a.pending)[0]?.name ?? null,
      watch: watchCount?.n ?? 0,
    },
    classes,
    today: todayList,
    watchlist,
    watchCount: watchCount?.n ?? 0,
    homework,
  };
}

// =============================================================================
// Timetable
// =============================================================================
export async function getTimetable(user: AuthUser, f: { sectionId?: string; employeeId?: string }) {
  let campusId: string;
  let entries;
  let title: string;
  if (f.sectionId) {
    const sec = await authorizeSection(user, f.sectionId);
    campusId = sec.campusId;
    title = sec.label;
    entries = await many(`${ENTRY_SQL} WHERE te.section_id = $1 ORDER BY te.day_of_week, p.period_no`, [sec.id]);
  } else {
    const emp = f.employeeId ?? user.employeeId;
    if (!emp) throw badRequest('Choose a section', 'SECTION_REQUIRED');
    if (isRestricted(user) && emp !== user.employeeId) throw notFound('Timetable not found');
    const e = await one<{ campus_id: string; full_name: string }>('SELECT campus_id, full_name FROM employees WHERE id = $1 AND deleted_at IS NULL', [emp]);
    if (!e) throw notFound('Teacher not found');
    campusId = e.campus_id;
    title = e.full_name;
    entries = await many(`${ENTRY_SQL} WHERE te.employee_id = $1 OR te.substitute_id = $1 ORDER BY te.day_of_week, p.period_no`, [emp]);
  }
  const periods = await many(
    `SELECT id, period_no AS "periodNo", to_char(starts_at, 'HH24:MI') AS "startsAt", to_char(ends_at, 'HH24:MI') AS "endsAt"
       FROM periods WHERE campus_id = $1 ORDER BY period_no`,
    [campusId],
  );
  const today = schoolToday();
  const conflicts = entries.filter((e) => e.needsSubstitute && !e.substituteId);
  const conflictDetails = await Promise.all(conflicts.map(async (e) => ({
    ...e,
    teacherStatus: e.employeeId ? await teacherStatusOn(e.employeeId, dateForDay(today, e.day)) : null,
    date: dateForDay(today, e.day),
  })));
  const maxDay = entries.reduce((m, e) => Math.max(m, e.day), 5);
  return {
    title,
    campusId,
    canEdit: f.sectionId ? await canEditTimetable(user, f.sectionId) : false,
    days: DAY_NAMES.slice(0, maxDay),
    periods,
    entries,
    conflicts: conflictDetails,
    today: { date: today, day: isoDow(today) },
  };
}

/** The date of the given weekday in the current week (or next week once it has passed). */
function dateForDay(today: string, day: number) {
  const diff = day - isoDow(today);
  return addDays(today, diff >= 0 ? diff : diff + 7);
}

async function teacherStatusOn(employeeId: string, date: string, db?: Queryable) {
  const r = await one<{ status: string | null; leave: string | null }>(
    `SELECT (SELECT status FROM staff_attendance WHERE employee_id = $1 AND attendance_date = $2) AS status,
            (SELECT lr.code FROM leave_requests lr WHERE lr.employee_id = $1 AND lr.status = 'Approved' AND $2::date BETWEEN lr.from_date AND lr.to_date LIMIT 1) AS leave`,
    [employeeId, date], db,
  );
  if (r?.leave) return `On approved leave (${r.leave})`;
  if (r?.status === 'On Leave') return 'On leave';
  if (r?.status === 'Absent') return 'Absent';
  return r?.status ?? null;
}

export async function timetableInsights(user: AuthUser, campusId?: string) {
  const c = campusId ?? user.campusId ?? null;
  const [load, util] = await Promise.all([
    many(
      `SELECT e.id, e.full_name AS name, count(*)::int AS periods, COALESCE(t.max_periods_week, 30) AS "maxPeriods"
         FROM timetable_entries te
         JOIN employees e ON e.id = COALESCE(te.substitute_id, te.employee_id)
         LEFT JOIN teachers t ON t.employee_id = e.id
        WHERE ($1::uuid IS NULL OR e.campus_id = $1) AND e.employee_type = 'teaching'
        GROUP BY e.id, e.full_name, t.max_periods_week
        ORDER BY count(*) DESC, e.full_name LIMIT 8`,
      [c],
    ),
    one(
      `SELECT count(*)::int AS filled,
              (count(DISTINCT te.section_id) * 5 * (SELECT count(*) FROM periods p WHERE $1::uuid IS NULL OR p.campus_id = $1)
                / GREATEST(1, (SELECT count(DISTINCT campus_id) FROM periods p WHERE $1::uuid IS NULL OR p.campus_id = $1)))::int AS slots
         FROM timetable_entries te JOIN sections sec ON sec.id = te.section_id JOIN classes cl ON cl.id = sec.class_id
        WHERE ($1::uuid IS NULL OR cl.campus_id = $1) AND te.day_of_week <= 5`,
      [c],
    ),
  ]);
  const agreed = load.length ? Math.min(...load.map((l) => l.maxPeriods)) : 30;
  return {
    teacherLoad: load,
    agreedLoad: agreed,
    utilisation: { filled: util?.filled ?? 0, slots: util?.slots ?? 0, pct: util?.slots ? Math.round((100 * util.filled) / util.slots) : 0 },
  };
}

async function loadEntry(id: string, db?: Queryable) {
  const e = await one(
    `SELECT te.*, p.period_no, c.campus_id, c.name || sec.name AS section_label, sub.name AS subject_name
       FROM timetable_entries te JOIN periods p ON p.id = te.period_id
       JOIN sections sec ON sec.id = te.section_id JOIN classes c ON c.id = sec.class_id
       LEFT JOIN subjects sub ON sub.id = te.subject_id
      WHERE te.id = $1`,
    [id], db,
  );
  if (!e) throw notFound('Timetable entry not found');
  return e;
}

/** Teachers who are free and present for this slot, best match first. */
export async function substituteSuggestions(user: AuthUser, entryId: string) {
  const e = await loadEntry(entryId);
  await authorizeSection(user, e.section_id);
  const date = dateForDay(schoolToday(), e.day_of_week);
  const rows = await many(
    `SELECT emp.id, emp.full_name AS name, emp.designation, emp.user_id IS NOT NULL AS "hasAccount",
            EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.employee_id = emp.id AND ta.subject_id = $4) AS "teachesSubject",
            EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.employee_id = emp.id AND ta.section_id = $5) AS "teachesSection",
            (SELECT count(*)::int FROM timetable_entries x WHERE (x.employee_id = emp.id AND x.substitute_id IS NULL) OR x.substitute_id = emp.id) AS load,
            (SELECT string_agg(DISTINCT sub.name, ', ') FROM teacher_assignments ta JOIN subjects sub ON sub.id = ta.subject_id WHERE ta.employee_id = emp.id) AS subjects
       FROM employees emp
      WHERE emp.employee_type = 'teaching' AND emp.deleted_at IS NULL AND emp.employment_status = 'active'
        AND emp.campus_id = $1 AND emp.id IS DISTINCT FROM $6
        AND NOT EXISTS (SELECT 1 FROM timetable_entries x JOIN periods px ON px.id = x.period_id
                         WHERE x.day_of_week = $2 AND px.period_no = $3
                           AND ((x.employee_id = emp.id AND x.substitute_id IS NULL AND NOT x.needs_substitute) OR x.substitute_id = emp.id))
        AND NOT EXISTS (SELECT 1 FROM staff_attendance sa WHERE sa.employee_id = emp.id AND sa.attendance_date = $7 AND sa.status IN ('Absent', 'On Leave'))
        AND NOT EXISTS (SELECT 1 FROM leave_requests lr WHERE lr.employee_id = emp.id AND lr.status = 'Approved' AND $7::date BETWEEN lr.from_date AND lr.to_date)`,
    [e.campus_id, e.day_of_week, e.period_no, e.subject_id, e.section_id, e.employee_id, date],
  );
  const ranked = rows
    .map((r) => ({
      ...r,
      score: (r.teachesSubject ? 3 : 0) + (r.teachesSection ? 2 : 0) - r.load / 40,
      reason: [
        `Free P${e.period_no}`,
        r.subjects ? `teaches ${r.subjects}` : r.designation,
        r.teachesSection ? `already teaches ${e.section_label}` : null,
        `${r.load} periods this week`,
      ].filter(Boolean).join(' · '),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  return {
    entry: {
      id: e.id, day: DAY_NAMES[e.day_of_week - 1], date, periodNo: e.period_no, section: e.section_label,
      subject: e.subject_name ?? e.activity, room: e.room,
      teacherStatus: e.employee_id ? await teacherStatusOn(e.employee_id, date) : null,
    },
    suggestions: ranked.map(({ score, ...r }) => ({ ...r, match: score >= 3 ? 'success' : score >= 1 ? 'info' : 'neutral' })),
  };
}

export async function assignSubstitute(req: Request, entryId: string, substituteId: string, note?: string | null) {
  return tx(async (db) => {
    const e = await loadEntry(entryId, db);
    await authorizeSection(req.user!, e.section_id, db);
    if (substituteId === e.employee_id) throw badRequest('The substitute must be a different teacher', 'SAME_TEACHER');
    const date = dateForDay(schoolToday(), e.day_of_week);
    const sub = await one<{ full_name: string; user_id: string | null; campus_id: string }>(
      `SELECT full_name, user_id, campus_id FROM employees WHERE id = $1 AND employee_type = 'teaching' AND deleted_at IS NULL AND employment_status = 'active'`,
      [substituteId], db,
    );
    if (!sub || sub.campus_id !== e.campus_id) throw badRequest('Choose an active teacher from the same campus', 'INVALID_SUBSTITUTE');
    const busy = await one(
      `SELECT c.name || sec.name AS label FROM timetable_entries x JOIN periods px ON px.id = x.period_id
         JOIN sections sec ON sec.id = x.section_id JOIN classes c ON c.id = sec.class_id
        WHERE x.id <> $1 AND x.day_of_week = $2 AND px.period_no = $3
          AND ((x.employee_id = $4 AND x.substitute_id IS NULL AND NOT x.needs_substitute) OR x.substitute_id = $4) LIMIT 1`,
      [entryId, e.day_of_week, e.period_no, substituteId], db,
    );
    if (busy) throw badRequest(`${sub.full_name} is teaching ${busy.label} in that period`, 'TEACHER_BUSY');
    const status = await teacherStatusOn(substituteId, date, db);
    if (status && /leave|Absent/i.test(status)) throw badRequest(`${sub.full_name} is not available on ${date} (${status})`, 'TEACHER_UNAVAILABLE');

    await query(`UPDATE timetable_entries SET substitute_id = $2, needs_substitute = false WHERE id = $1`, [entryId, substituteId], db);
    const what = `${e.section_label} ${e.subject_name ?? e.activity ?? ''}`.trim();
    if (sub.user_id) {
      await notifyUsers([sub.user_id], {
        category: 'Attention', topic: 'timetable', icon: 'calendar',
        title: `Cover assigned: ${DAY_NAMES[e.day_of_week - 1]} Period ${e.period_no}`,
        body: `${what} · ${e.room ?? ''}${note ? ` — ${note}` : ''}`.trim(),
        route: '/timetable', entityType: 'timetable_entry', entityId: entryId,
      }, db);
    }
    await audit(req, {
      action: 'update', module: 'academics',
      description: `Assigned ${sub.full_name} to cover ${what}, ${DAY_NAMES[e.day_of_week - 1]} P${e.period_no}`,
      entityType: 'timetable_entry', entityId: entryId, metadata: { substituteId, date, note },
    }, db);
    return { id: entryId, substitute: sub.full_name, date };
  });
}

export async function clearSubstitute(req: Request, entryId: string) {
  return tx(async (db) => {
    const e = await loadEntry(entryId, db);
    await authorizeSection(req.user!, e.section_id, db);
    if (!e.substitute_id) throw badRequest('No substitute is assigned to this period', 'NO_SUBSTITUTE');
    await query(`UPDATE timetable_entries SET substitute_id = NULL, needs_substitute = true WHERE id = $1`, [entryId], db);
    await audit(req, { action: 'update', module: 'academics', description: `Removed cover from ${e.section_label}, ${DAY_NAMES[e.day_of_week - 1]} P${e.period_no}`, entityType: 'timetable_entry', entityId: entryId }, db);
    return { id: entryId };
  });
}

/**
 * Who may change a section's timetable: school-level academic staff for any section
 * in scope, and a teacher for the section they are class teacher of.
 */
export async function authorizeTimetableEdit(user: AuthUser, sectionId: string, db?: Queryable) {
  const sec = await authorizeSection(user, sectionId, db);
  if ((isRestricted(user) || user.scope === 'class') && (!user.employeeId || sec.classTeacherId !== user.employeeId)) {
    throw forbidden(`Only the class teacher of ${sec.label} or the school office can change its timetable`);
  }
  return sec;
}

/** True when the user may edit this section's timetable (for the UI). */
export async function canEditTimetable(user: AuthUser, sectionId: string) {
  if (!user.permissions.has('academics.manage')) return false;
  try { await authorizeTimetableEdit(user, sectionId); return true; } catch { return false; }
}

export async function updateEntry(req: Request, entryId: string, input: { subjectId?: string | null; activity?: string | null; employeeId?: string | null; room?: string | null; needsSubstitute?: boolean }) {
  return tx(async (db) => {
    const e = await loadEntry(entryId, db);
    await authorizeTimetableEdit(req.user!, e.section_id, db);
    const subjectId = input.subjectId !== undefined ? input.subjectId : e.subject_id;
    const activity = input.activity !== undefined ? input.activity : e.activity;
    if (!subjectId && !activity) throw badRequest('Choose a subject or enter an activity', 'VALIDATION_ERROR', [{ field: 'subjectId', message: 'Choose a subject or enter an activity' }]);
    const employeeId = input.employeeId !== undefined ? input.employeeId : e.employee_id;
    if (employeeId && employeeId !== e.employee_id) {
      const clash = await one(
        `SELECT c.name || sec.name AS label FROM timetable_entries x JOIN periods px ON px.id = x.period_id
           JOIN sections sec ON sec.id = x.section_id JOIN classes c ON c.id = sec.class_id
          WHERE x.id <> $1 AND x.day_of_week = $2 AND px.period_no = $3 AND (x.employee_id = $4 OR x.substitute_id = $4) LIMIT 1`,
        [entryId, e.day_of_week, e.period_no, employeeId], db,
      );
      if (clash) throw badRequest(`That teacher already has ${clash.label} in this period`, 'TEACHER_BUSY');
    }
    await query(
      `UPDATE timetable_entries SET subject_id = $2, activity = $3, employee_id = $4, room = $5, needs_substitute = $6,
              substitute_id = CASE WHEN $7 THEN NULL ELSE substitute_id END
        WHERE id = $1`,
      [entryId, subjectId, activity, employeeId, input.room !== undefined ? input.room : e.room,
        input.needsSubstitute ?? e.needs_substitute, employeeId !== e.employee_id], db,
    );
    await audit(req, { action: 'update', module: 'academics', description: `Edited timetable ${e.section_label}, ${DAY_NAMES[e.day_of_week - 1]} P${e.period_no}`, entityType: 'timetable_entry', entityId: entryId, metadata: input }, db);
    return { id: entryId };
  });
}

export async function publishTimetable(req: Request, sectionId: string, note?: string | null) {
  return tx(async (db) => {
    const sec = await authorizeTimetableEdit(req.user!, sectionId, db);
    const users = await many<{ user_id: string }>(
      `SELECT DISTINCT e.user_id FROM timetable_entries te JOIN employees e ON e.id IN (te.employee_id, te.substitute_id)
        WHERE te.section_id = $1 AND e.user_id IS NOT NULL`,
      [sectionId], db,
    );
    await notifyUsers(users.map((u) => u.user_id), {
      category: 'Information', topic: 'timetable', icon: 'calendar',
      title: `Timetable updated — ${sec.label}`, body: note ?? 'Please check your periods for this week.', route: '/timetable',
      entityType: 'section', entityId: sectionId,
    }, db);
    await audit(req, { action: 'publish', module: 'academics', description: `Published timetable changes for ${sec.label}`, entityType: 'section', entityId: sectionId, metadata: { note, notified: users.length } }, db);
    return { notified: users.length };
  });
}

// ---- Adding, clearing and importing periods ------------------------------------------
export interface SlotInput {
  sectionId: string; day: number; periodId: string;
  subjectId?: string | null; activity?: string | null; employeeId?: string | null; room?: string | null;
}

/** Creates or replaces one period of a section's week. The caller has authorised the section. */
async function writeSlot(db: Queryable, campusId: string, s: SlotInput) {
  if (!s.subjectId && !s.activity) throw badRequest('Choose a subject or enter an activity', 'VALIDATION_ERROR', [{ field: 'subjectId', message: 'Choose a subject or enter an activity' }]);
  const period = await one<{ period_no: number }>('SELECT period_no FROM periods WHERE id = $1 AND campus_id = $2', [s.periodId, campusId], db);
  if (!period) throw badRequest('That period is not part of this campus day', 'INVALID_PERIOD', [{ field: 'periodId', message: 'Choose a period' }]);
  if (s.employeeId) {
    const t = await one('SELECT 1 FROM employees WHERE id = $1 AND campus_id = $2 AND deleted_at IS NULL', [s.employeeId, campusId], db);
    if (!t) throw badRequest('Choose a teacher from this campus', 'INVALID_TEACHER', [{ field: 'employeeId', message: 'Choose a teacher from this campus' }]);
    const clash = await one<{ label: string }>(
      `SELECT c.name || sec.name AS label FROM timetable_entries x JOIN periods px ON px.id = x.period_id
         JOIN sections sec ON sec.id = x.section_id JOIN classes c ON c.id = sec.class_id
        WHERE x.section_id <> $1 AND x.day_of_week = $2 AND px.period_no = $3 AND (x.employee_id = $4 OR x.substitute_id = $4) LIMIT 1`,
      [s.sectionId, s.day, period.period_no, s.employeeId], db,
    );
    if (clash) throw badRequest(`That teacher already has ${clash.label} in this period`, 'TEACHER_BUSY', [{ field: 'employeeId', message: `Already teaching ${clash.label}` }]);
  }
  const row = await one<{ id: string; inserted: boolean }>(
    `INSERT INTO timetable_entries (section_id, day_of_week, period_id, subject_id, activity, employee_id, room)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (section_id, day_of_week, period_id) DO UPDATE
       SET subject_id = EXCLUDED.subject_id, activity = EXCLUDED.activity, room = EXCLUDED.room,
           substitute_id = CASE WHEN timetable_entries.employee_id IS DISTINCT FROM EXCLUDED.employee_id THEN NULL ELSE timetable_entries.substitute_id END,
           needs_substitute = CASE WHEN timetable_entries.employee_id IS DISTINCT FROM EXCLUDED.employee_id THEN false ELSE timetable_entries.needs_substitute END,
           employee_id = EXCLUDED.employee_id
     RETURNING id, (xmax = 0) AS inserted`,
    [s.sectionId, s.day, s.periodId, s.subjectId ?? null, s.activity ?? null, s.employeeId ?? null, s.room ?? null], db,
  );
  return { id: row!.id, inserted: row!.inserted, periodNo: period.period_no };
}

export async function saveSlot(req: Request, s: SlotInput) {
  return tx(async (db) => {
    const sec = await authorizeTimetableEdit(req.user!, s.sectionId, db);
    const out = await writeSlot(db, sec.campusId, s);
    await audit(req, {
      action: out.inserted ? 'create' : 'update', module: 'academics',
      description: `${out.inserted ? 'Added' : 'Edited'} timetable ${sec.label}, ${DAY_NAMES[s.day - 1]} P${out.periodNo}`,
      entityType: 'timetable_entry', entityId: out.id, metadata: { ...s },
    }, db);
    return { id: out.id, created: out.inserted };
  });
}

export async function deleteEntry(req: Request, entryId: string) {
  return tx(async (db) => {
    const e = await loadEntry(entryId, db);
    await authorizeTimetableEdit(req.user!, e.section_id, db);
    await query('DELETE FROM timetable_entries WHERE id = $1', [entryId], db);
    await audit(req, { action: 'delete', module: 'academics', description: `Cleared timetable ${e.section_label}, ${DAY_NAMES[e.day_of_week - 1]} P${e.period_no}`, entityType: 'timetable_entry', entityId: entryId }, db);
    return { id: entryId };
  });
}

export const TIMETABLE_COLUMNS = ['class', 'section', 'day', 'period', 'subject', 'activity', 'teacher', 'room'] as const;
export const TIMETABLE_EXAMPLE = [
  { class: 'Grade 6', section: 'A', day: 'Monday', period: '1', subject: 'MAT', teacher: 'EMP-1001', room: 'R-12' },
  { class: 'Grade 6', section: 'A', day: 'Monday', period: '2', subject: 'English', teacher: 'Priya Raghavan', room: 'R-12' },
  { class: 'Grade 6', section: 'A', day: 'Monday', period: '3', activity: 'Library', room: 'Library' },
];
const MAX_TIMETABLE_ROWS = 600;

const dayNumber = (s: string) => {
  if (/^[1-6]$/.test(s)) return Number(s);
  const i = DAY_NAMES.findIndex((d) => d.toLowerCase().startsWith(s.toLowerCase().slice(0, 3)) && s.length >= 3);
  return i >= 0 ? i + 1 : null;
};

/**
 * Imports a timetable CSV (one row per period) for one campus. Each row creates or
 * replaces that period; a row with neither subject nor activity clears the period.
 * Every row is checked first; nothing is written unless all rows are valid.
 */
export async function importTimetable(req: Request, file: Express.Multer.File | undefined, opts: { campusId: string; dryRun: boolean }) {
  const user = req.user!;
  const records = readCsvRecords(file, { columns: TIMETABLE_COLUMNS, required: ['class', 'section', 'day', 'period'], maxRows: MAX_TIMETABLE_ROWS, what: 'period' });
  const [sections, periods, subjects, teachers] = await Promise.all([
    many<{ id: string; cls: string; grade: number; sec: string; label: string }>(
      `SELECT sec.id, lower(c.name) AS cls, c.grade_level AS grade, lower(sec.name) AS sec, c.name || sec.name AS label
         FROM sections sec JOIN classes c ON c.id = sec.class_id JOIN academic_years ay ON ay.id = sec.academic_year_id AND ay.is_current
        WHERE c.campus_id = $1`, [opts.campusId]),
    many<{ id: string; no: number }>('SELECT id, period_no AS no FROM periods WHERE campus_id = $1', [opts.campusId]),
    many<{ id: string; code: string; name: string }>('SELECT id, lower(code) AS code, lower(name) AS name FROM subjects'),
    many<{ id: string; code: string; name: string }>(
      `SELECT id, lower(employee_code) AS code, lower(full_name) AS name FROM employees WHERE campus_id = $1 AND deleted_at IS NULL AND employment_status = 'active'`, [opts.campusId]),
  ]);
  if (!periods.length) throw badRequest('This campus has no periods set up yet', 'NO_PERIODS');

  const allowed = new Map<string, boolean>();
  const results: ImportRowResult[] = [];
  const plan: { row: number; sectionId: string; label: string; slot: SlotInput | null; day: number; periodId: string }[] = [];
  const seen = new Set<string>();
  for (const { row, rec } of records) {
    const errors: { field: string; message: string }[] = [];
    const clsKey = rec.class?.toLowerCase() ?? '';
    const gradeNo = Number(clsKey.replace(/\D/g, '')) || null;
    const sec = sections.find((s) => (s.cls === clsKey || (gradeNo !== null && s.grade === gradeNo)) && s.sec === (rec.section ?? '').toLowerCase());
    const label = sec?.label ?? `${rec.class ?? ''} ${rec.section ?? ''}`.trim();
    if (!sec) errors.push({ field: 'section', message: `No section "${label}" on this campus this year` });
    else {
      if (!allowed.has(sec.id)) allowed.set(sec.id, await authorizeTimetableEdit(user, sec.id).then(() => true, () => false));
      if (!allowed.get(sec.id)) errors.push({ field: 'section', message: `You cannot change the timetable of ${sec.label}` });
    }
    const day = dayNumber(rec.day ?? '');
    if (!day) errors.push({ field: 'day', message: 'Use Monday–Saturday or 1–6' });
    const period = periods.find((p) => String(p.no) === (rec.period ?? '').replace(/^p/i, ''));
    if (!period) errors.push({ field: 'period', message: `No period ${rec.period || '(blank)'} — this campus has ${periods.length}` });
    const subjKey = (rec.subject ?? '').toLowerCase();
    const subject = subjKey ? subjects.find((s) => s.code === subjKey || s.name === subjKey) : null;
    if (subjKey && !subject) errors.push({ field: 'subject', message: `Unknown subject "${rec.subject}"` });
    const teachKey = (rec.teacher ?? '').toLowerCase();
    const teacher = teachKey ? teachers.find((t) => t.code === teachKey || t.name === teachKey) : null;
    if (teachKey && !teacher) errors.push({ field: 'teacher', message: `No active staff member "${rec.teacher}" on this campus` });
    if ((rec.activity ?? '').length > 40) errors.push({ field: 'activity', message: 'Keep the activity under 40 characters' });
    if ((rec.room ?? '').length > 40) errors.push({ field: 'room', message: 'Keep the room under 40 characters' });
    if (sec && day && period) {
      const key = `${sec.id}:${day}:${period.id}`;
      if (seen.has(key)) errors.push({ field: 'period', message: `${sec.label} ${DAY_NAMES[day - 1]} P${period.no} appears twice in the file` });
      seen.add(key);
    }
    if (errors.length) { results.push({ row, label, ok: false, errors }); continue; }
    const empty = !subject && !rec.activity;
    plan.push({
      row, sectionId: sec!.id, label: sec!.label, day: day!, periodId: period!.id,
      slot: empty ? null : { sectionId: sec!.id, day: day!, periodId: period!.id, subjectId: subject?.id ?? null, activity: rec.activity || null, employeeId: teacher?.id ?? null, room: rec.room || null },
    });
    results.push({ row, label, ok: true });
  }

  const failed = results.filter((r) => !r.ok).length;
  if (opts.dryRun || failed) {
    return { dryRun: opts.dryRun, rows: records.length, valid: records.length - failed, failed, imported: 0, cleared: 0, results };
  }
  // All rows valid: write them together so a teacher clash between rows rolls the whole file back.
  try {
    const counts = await tx(async (db) => {
      let written = 0;
      let cleared = 0;
      // Clear first, so a teacher moved within the file does not clash with their old slot.
      for (const p of plan) {
        const del = await query('DELETE FROM timetable_entries WHERE section_id = $1 AND day_of_week = $2 AND period_id = $3', [p.sectionId, p.day, p.periodId], db);
        if (!p.slot) cleared += del.rowCount ?? 0;
      }
      const campus = opts.campusId;
      for (const p of plan) {
        if (!p.slot) continue;
        try { await writeSlot(db, campus, p.slot); written++; } catch (e: any) {
          throw Object.assign(new Error(e?.message ?? 'Could not save this period'), { row: p.row, label: p.label, field: e?.details?.[0]?.field ?? 'teacher' });
        }
      }
      const sectionsTouched = new Set(plan.map((p) => p.label));
      await audit(req, {
        action: 'create', module: 'academics',
        description: `Imported timetable for ${[...sectionsTouched].join(', ')} from ${file!.originalname.replace(/[^\w.\- ]/g, '')}`,
        metadata: { rows: records.length, written, cleared },
      }, db);
      return { written, cleared };
    });
    return { dryRun: false, rows: records.length, valid: records.length, failed: 0, imported: counts.written, cleared: counts.cleared, results };
  } catch (e: any) {
    if (!e?.row) throw e;
    const out = results.map((r) => (r.row === e.row ? { ...r, ok: false, errors: [{ field: e.field, message: e.message }] } : r));
    return { dryRun: false, rows: records.length, valid: records.length - 1, failed: 1, imported: 0, cleared: 0, results: out };
  }
}

/** Which sections of a campus the user may edit (the class teacher sees only theirs). */
export async function editableSections(user: AuthUser, campusId?: string) {
  if (!user.permissions.has('academics.manage')) return [];
  const schoolLevel = !isRestricted(user) && user.scope !== 'class';
  return many<{ id: string; label: string }>(
    `SELECT sec.id, c.name || sec.name AS label FROM sections sec JOIN classes c ON c.id = sec.class_id
       JOIN academic_years ay ON ay.id = sec.academic_year_id AND ay.is_current
      WHERE ($1::uuid IS NULL OR c.campus_id = $1) AND ($2 OR sec.class_teacher_id = $3)
      ORDER BY c.grade_level, sec.name`,
    [campusId ?? null, schoolLevel, user.employeeId ?? null],
  );
}
