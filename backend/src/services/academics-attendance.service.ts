import type { Request } from 'express';
import { many, one, query, tx, type Queryable } from '../config/db.js';
import { Where } from '../utils/sql.js';
import { badRequest } from '../utils/errors.js';
import { nextCode } from '../utils/codes.js';
import { audit } from './audit.service.js';
import { notifyGuardians, notifyUsers } from './notification.service.js';
import { authorizeSection, isoDow, schoolMinutesNow, schoolToday, sectionScope } from './academics.service.js';
import type { AuthUser } from '../types.js';

type Status = 'present' | 'late' | 'absent' | 'leave';

// =============================================================================
// Section picker with register status for a date
// =============================================================================
export async function attendanceSections(user: AuthUser, campusId: string | undefined, date: string) {
  const w = new Where().add('sec.academic_year_id = (SELECT id FROM academic_years WHERE is_current)');
  w.addIf(campusId, 'c.campus_id = ?');
  sectionScope(user, w, 'sec.id');
  const d = w.param(date);
  const rows = await many(
    `SELECT sec.id, c.name || sec.name AS label, c.grade_level AS "gradeLevel", sec.name AS section, cp.short_name AS "campusName",
            st.students, att.marked,
            CASE WHEN st.students = 0 THEN 'No students' WHEN att.marked >= st.students THEN 'Marked'
                 WHEN att.marked > 0 THEN 'Pending' ELSE 'Not marked' END AS status
       FROM sections sec
       JOIN classes c ON c.id = sec.class_id
       JOIN campuses cp ON cp.id = c.campus_id
       CROSS JOIN LATERAL (SELECT count(*)::int AS students FROM students s WHERE s.section_id = sec.id AND s.deleted_at IS NULL AND s.status = 'active') st
       CROSS JOIN LATERAL (SELECT count(*)::int AS marked FROM attendance_records a JOIN students s ON s.id = a.student_id
                            WHERE a.section_id = sec.id AND a.attendance_date = ${d}::date AND s.deleted_at IS NULL AND s.status = 'active') att
       ${w.sql}
      ORDER BY cp.established, c.grade_level, sec.name`,
    w.params,
  );
  return rows;
}

// =============================================================================
// Register (one section, one date)
// =============================================================================
async function yearBounds(db?: Queryable) {
  const y = await one<{ starts_on: string; ends_on: string }>('SELECT starts_on, ends_on FROM academic_years WHERE is_current', [], db);
  if (!y) throw badRequest('No current academic year is configured', 'NO_CURRENT_YEAR');
  return y;
}

export async function getRegister(user: AuthUser, sectionId: string, dateIn?: string) {
  const today = schoolToday();
  const date = dateIn ?? today;
  if (date > today) throw badRequest('Attendance cannot be viewed or marked for a future date', 'FUTURE_DATE', [{ field: 'date', message: 'Choose today or an earlier date' }]);
  const sec = await authorizeSection(user, sectionId);
  const year = await yearBounds();
  const dow = isoDow(date);

  const [students, period, marker] = await Promise.all([
    many(
      `SELECT s.id, s.admission_no AS "admissionNo", s.full_name AS "fullName", s.photo_url AS "photoUrl", s.risk_level AS risk,
              en.roll_no AS roll, a.status, to_char(a.arrival_time, 'HH24:MI') AS "arrivalTime", a.remarks,
              a.parent_notified_at AS "parentNotifiedAt", a.source
         FROM students s
         LEFT JOIN enrollments en ON en.student_id = s.id AND en.academic_year_id = (SELECT id FROM academic_years WHERE is_current)
         LEFT JOIN attendance_records a ON a.student_id = s.id AND a.attendance_date = $2
        WHERE s.section_id = $1 AND s.deleted_at IS NULL AND s.status = 'active'
        ORDER BY en.roll_no NULLS LAST, s.full_name`,
      [sectionId, date],
    ),
    dow <= 6
      ? one(
          `SELECT p.period_no AS "periodNo", to_char(p.starts_at, 'HH24:MI') AS "startsAt", to_char(p.ends_at, 'HH24:MI') AS "endsAt",
                  COALESCE(sub.name, te.activity) AS subject, te.room, COALESCE(sube.full_name, e.full_name) AS teacher
             FROM timetable_entries te
             JOIN periods p ON p.id = te.period_id
             LEFT JOIN subjects sub ON sub.id = te.subject_id
             LEFT JOIN employees e ON e.id = te.employee_id
             LEFT JOIN employees sube ON sube.id = te.substitute_id
            WHERE te.section_id = $1 AND te.day_of_week = $2
            ORDER BY p.period_no LIMIT 1`,
          [sectionId, dow],
        )
      : null,
    one(
      `SELECT u.full_name AS name, max(a.updated_at) AS at
         FROM attendance_records a JOIN users u ON u.id = a.marked_by
        WHERE a.section_id = $1 AND a.attendance_date = $2
        GROUP BY u.full_name ORDER BY max(a.updated_at) DESC LIMIT 1`,
      [sectionId, date],
    ),
  ]);

  const summary = { total: students.length, present: 0, late: 0, absent: 0, leave: 0, unmarked: 0 };
  for (const s of students) summary[(s.status as Status) ?? 'unmarked'] = (summary[(s.status as Status) ?? 'unmarked'] ?? 0) + 1;
  summary.unmarked = students.filter((s) => !s.status).length;

  const canMark = user.permissions.has('attendance.mark');
  const inYear = date >= year.starts_on && date <= year.ends_on;
  const reason = !canMark ? 'You can view this register but not mark it.'
    : !inYear ? 'This date is outside the current academic year.'
    : dow === 7 ? 'Sunday is not a school day.'
    : null;
  return {
    section: { id: sec.id, label: sec.label, room: sec.room, campusId: sec.campusId },
    date,
    isToday: date === today,
    period,
    students,
    summary,
    lastMarkedBy: marker,
    editable: !reason,
    readOnlyReason: reason,
  };
}

interface MarkInput { studentId: string; status: Status; arrivalTime?: string | null; remarks?: string | null }

export async function saveRegister(req: Request, input: { sectionId: string; date: string; marks: MarkInput[] }) {
  const user = req.user!;
  const today = schoolToday();
  const { date } = input;
  if (date > today) throw badRequest('Attendance cannot be marked for a future date', 'FUTURE_DATE', [{ field: 'date', message: 'Choose today or an earlier date' }]);
  if (isoDow(date) === 7) throw badRequest('Sunday is not a school day', 'NOT_A_SCHOOL_DAY');
  const ids = input.marks.map((m) => m.studentId);
  if (new Set(ids).size !== ids.length) throw badRequest('A student appears more than once', 'DUPLICATE_STUDENT');

  return tx(async (db) => {
    const year = await yearBounds(db);
    if (date < year.starts_on || date > year.ends_on) throw badRequest('This date is outside the current academic year', 'OUTSIDE_YEAR');
    const sec = await authorizeSection(user, input.sectionId, db);

    const roster = await many<{ id: string; full_name: string; first_name: string }>(
      `SELECT id, full_name, first_name FROM students WHERE section_id = $1 AND deleted_at IS NULL AND status = 'active' AND id = ANY($2)`,
      [sec.id, ids], db,
    );
    if (roster.length !== ids.length) {
      const known = new Set(roster.map((r) => r.id));
      throw badRequest('Some students are not in this section', 'STUDENT_NOT_IN_SECTION', ids.filter((i) => !known.has(i)).map((i) => ({ field: 'marks', message: `Student ${i} is not in ${sec.label}` })));
    }
    const nameOf = new Map(roster.map((r) => [r.id, r]));
    const before = new Map(
      (await many<{ student_id: string; status: Status }>(
        'SELECT student_id, status FROM attendance_records WHERE attendance_date = $1 AND student_id = ANY($2) FOR UPDATE',
        [date, ids], db,
      )).map((r) => [r.student_id, r.status]),
    );

    const nowMin = schoolMinutesNow();
    const nowHHMM = `${String(Math.floor(nowMin / 60)).padStart(2, '0')}:${String(nowMin % 60).padStart(2, '0')}`;
    const newlyAbsent: string[] = [];
    const newlyLate: string[] = [];
    let changed = 0;
    for (const m of input.marks) {
      const prev = before.get(m.studentId);
      if (prev !== m.status) changed++;
      const arrival = m.status === 'present' || m.status === 'late'
        ? m.arrivalTime ?? (date === today && m.status === 'late' ? nowHHMM : null)
        : null;
      const notifyNow = prev !== m.status && (m.status === 'absent' || m.status === 'late');
      if (notifyNow) (m.status === 'absent' ? newlyAbsent : newlyLate).push(m.studentId);
      await query(
        `INSERT INTO attendance_records (student_id, section_id, attendance_date, status, arrival_time, remarks, source, marked_by, parent_notified_at)
         VALUES ($1,$2,$3,$4,$5,$6,'teacher',$7, CASE WHEN $8 THEN now() END)
         ON CONFLICT (student_id, attendance_date) DO UPDATE
            SET status = EXCLUDED.status, section_id = EXCLUDED.section_id,
                arrival_time = EXCLUDED.arrival_time,
                remarks = COALESCE(EXCLUDED.remarks, attendance_records.remarks),
                source = 'teacher', marked_by = EXCLUDED.marked_by,
                parent_notified_at = CASE WHEN $8 THEN now() ELSE attendance_records.parent_notified_at END`,
        [m.studentId, sec.id, date, m.status, arrival, m.remarks ?? null, user.id, notifyNow], db,
      );
    }

    // Parent alerts (queued in-app + WhatsApp/push outbox; nothing is sent externally here).
    const when = date === today ? 'today' : `on ${date}`;
    let notified = 0;
    for (const sid of newlyAbsent) {
      const s = nameOf.get(sid)!;
      const out = await notifyGuardians(sid, {
        category: 'Critical', topic: 'attendance', icon: 'userCheck', channels: ['whatsapp', 'push'],
        title: `${s.first_name} was marked absent ${when}`,
        body: `${sec.label} register. Please reply to the class teacher with the reason.`,
        route: '/parent-360?tab=academics', entityType: 'student', entityId: sid,
      }, db);
      notified += out.length;
    }
    for (const sid of newlyLate) {
      const s = nameOf.get(sid)!;
      const out = await notifyGuardians(sid, {
        category: 'Attention', topic: 'attendance', icon: 'clock', channels: ['whatsapp', 'push'],
        title: `${s.first_name} arrived late ${when}`,
        body: `${sec.label} register.`,
        route: '/parent-360?tab=academics', entityType: 'student', entityId: sid,
      }, db);
      notified += out.length;
    }

    const signals = await checkAbsencePatterns(req, sec, newlyAbsent, date, db);

    const counts = { present: 0, late: 0, absent: 0, leave: 0 } as Record<Status, number>;
    for (const m of input.marks) counts[m.status]++;
    await audit(req, {
      action: before.size ? 'update' : 'create', module: 'attendance',
      description: `Marked attendance for ${sec.label} on ${date}: ${counts.present} present, ${counts.late} late, ${counts.absent} absent, ${counts.leave} leave`,
      entityType: 'section', entityId: sec.id,
      metadata: { date, counts, changed, newlyAbsent: newlyAbsent.length, newlyLate: newlyLate.length, signals: signals.map((s) => s.code) },
    }, db);
    return {
      date, section: sec.label, saved: input.marks.length, changed, counts,
      absenceAlerts: newlyAbsent.length, lateNotices: newlyLate.length, notificationsQueued: notified,
      signalsRaised: signals,
    };
  });
}

/**
 * Pattern check after a save. Raises an Early Warning signal (stage 0,
 * awaiting teacher review — never applied automatically) when a newly absent
 * student has 3+ consecutive absences or has dropped below the attendance
 * threshold, and no open attendance signal exists.
 */
async function checkAbsencePatterns(req: Request, sec: { id: string; label: string; classTeacherId: string | null }, studentIds: string[], date: string, db: Queryable) {
  if (!studentIds.length) return [];
  const threshold = Number((await one<{ value: unknown }>(`SELECT value FROM system_settings WHERE key = 'early_warning.attendance_threshold'`, [], db))?.value ?? 82);
  const raised: { code: string; studentId: string; reason: string }[] = [];
  for (const sid of studentIds) {
    const open = await one(
      `SELECT 1 FROM early_warning_signals WHERE student_id = $1 AND signal_type = 'attendance' AND closed_at IS NULL AND COALESCE(review_decision, '') <> 'dismissed'`,
      [sid], db,
    );
    if (open) continue;
    const stats = await one<{ streak: number; pct: number | null; name: string }>(
      `SELECT (SELECT count(*)::int FROM (
                 SELECT status, row_number() OVER (ORDER BY attendance_date DESC) AS rn,
                        sum(CASE WHEN status <> 'absent' THEN 1 ELSE 0 END) OVER (ORDER BY attendance_date DESC) AS broken
                   FROM attendance_records WHERE student_id = $1 AND attendance_date <= $2) x WHERE x.broken = 0) AS streak,
              (SELECT round(100.0 * count(*) FILTER (WHERE a.status IN ('present', 'late')) / NULLIF(count(*), 0))::int
                 FROM attendance_records a JOIN academic_years ay ON ay.is_current AND a.attendance_date BETWEEN ay.starts_on AND ay.ends_on
                WHERE a.student_id = $1) AS pct,
              (SELECT full_name FROM students WHERE id = $1) AS name`,
      [sid, date], db,
    );
    if (!stats) continue;
    let reason: string | null = null;
    if (stats.streak >= 3) reason = `Absent ${stats.streak} consecutive school days`;
    else if (stats.pct != null && stats.pct < threshold) reason = `Attendance at ${stats.pct}% — below the ${threshold}% threshold`;
    if (!reason) continue;
    const code = await nextCode('early_warning_signals', 'code', 'SIG-', db, 3);
    const owner = sec.classTeacherId ?? req.user!.employeeId;
    const sig = await one<{ id: string }>(
      `INSERT INTO early_warning_signals (code, student_id, signal, signal_type, stage, owner_id, raised_on)
       VALUES ($1,$2,$3,'attendance',0,$4,$5) RETURNING id`,
      [code, sid, reason, owner, date], db,
    );
    await query(
      `INSERT INTO student_timeline_events (student_id, occurred_on, title, body, category, tone, created_by)
       VALUES ($1, $2, 'Early Warning signal raised', $3, 'attendance', 'critical', $4)`,
      [sid, date, `${code}: ${reason}. Awaiting teacher review.`, req.user!.id], db,
    );
    const ownerUser = owner ? await one<{ user_id: string | null }>('SELECT user_id FROM employees WHERE id = $1', [owner], db) : null;
    if (ownerUser?.user_id) {
      await notifyUsers([ownerUser.user_id], {
        category: 'Attention', topic: 'early_warning', icon: 'userCheck',
        title: `Early Warning: ${stats.name}`, body: `${reason} (${sec.label}). Review the signal — nothing is applied automatically.`,
        route: '/early-warning', entityType: 'early_warning_signal', entityId: sig!.id,
      }, db);
    }
    raised.push({ code, studentId: sid, reason });
  }
  return raised;
}

// =============================================================================
// School-wide figures
// =============================================================================
export async function attendanceSummary(campusId: string | undefined, dateIn?: string) {
  const date = dateIn ?? schoolToday();
  return one(
    `WITH sec AS (
       SELECT sec.id FROM sections sec JOIN classes c ON c.id = sec.class_id
        WHERE sec.academic_year_id = (SELECT id FROM academic_years WHERE is_current) AND ($1::uuid IS NULL OR c.campus_id = $1)
          AND EXISTS (SELECT 1 FROM students s WHERE s.section_id = sec.id AND s.deleted_at IS NULL AND s.status = 'active')),
     roster AS (
       SELECT s.id, s.section_id FROM students s WHERE s.section_id IN (SELECT id FROM sec) AND s.deleted_at IS NULL AND s.status = 'active'),
     marks AS (
       SELECT a.status, a.section_id FROM attendance_records a WHERE a.attendance_date = $2 AND a.student_id IN (SELECT id FROM roster))
     SELECT $2::text AS date,
            (SELECT count(*)::int FROM sec) AS sections,
            (SELECT count(*)::int FROM sec WHERE (SELECT count(*) FROM marks m WHERE m.section_id = sec.id) >= (SELECT count(*) FROM roster r WHERE r.section_id = sec.id)) AS "sectionsMarked",
            (SELECT count(*)::int FROM roster) AS students,
            (SELECT count(*)::int FROM marks) AS marked,
            (SELECT count(*)::int FROM marks WHERE status = 'present') AS present,
            (SELECT count(*)::int FROM marks WHERE status = 'late') AS late,
            (SELECT count(*)::int FROM marks WHERE status = 'absent') AS absent,
            (SELECT count(*)::int FROM marks WHERE status = 'leave') AS leave`,
    [campusId ?? null, date],
  );
}

export async function attendanceAnalytics(campusId: string | undefined) {
  const today = schoolToday();
  const c = campusId ?? null;
  const base = `FROM attendance_records a JOIN students s ON s.id = a.student_id AND s.deleted_at IS NULL AND s.status = 'active'
               WHERE ($1::uuid IS NULL OR s.campus_id = $1)`;
  const [todayRow, trend, byGrade, lateByTime, repeat, lateRoutes, weekday, postHoliday] = await Promise.all([
    attendanceSummary(campusId, today),
    many(
      `SELECT a.attendance_date AS date, round(100.0 * count(*) FILTER (WHERE a.status IN ('present', 'late')) / count(*), 1)::float AS pct
         ${base} AND a.attendance_date <= $2
        GROUP BY a.attendance_date ORDER BY a.attendance_date DESC LIMIT 10`,
      [c, today],
    ),
    many(
      `SELECT cl.grade_level AS "gradeLevel", 'G' || cl.grade_level AS label, count(*)::int AS marked,
              round(100.0 * count(*) FILTER (WHERE a.status IN ('present', 'late')) / count(*))::int AS present
         FROM attendance_records a
         JOIN students s ON s.id = a.student_id AND s.deleted_at IS NULL AND s.status = 'active'
         JOIN sections sec ON sec.id = a.section_id JOIN classes cl ON cl.id = sec.class_id
        WHERE ($1::uuid IS NULL OR s.campus_id = $1) AND a.attendance_date = $2
        GROUP BY cl.grade_level ORDER BY cl.grade_level`,
      [c, today],
    ),
    many(
      `SELECT to_char(date_trunc('hour', a.arrival_time::interval) + (floor(extract(minute FROM a.arrival_time) / 15) * interval '15 minutes'), 'HH24:MI') AS label,
              count(*)::int AS value
         ${base} AND a.status = 'late' AND a.arrival_time IS NOT NULL AND a.attendance_date > $2::date - 7 AND a.attendance_date <= $2
        GROUP BY 1 ORDER BY 1`,
      [c, today],
    ),
    one(
      `SELECT count(*)::int AS n FROM (
         SELECT a.student_id, array_agg(a.status ORDER BY a.attendance_date DESC) AS st
           ${base} AND a.attendance_date <= $2 AND a.attendance_date > $2::date - 10
          GROUP BY a.student_id) x
        WHERE x.st[1] = 'absent' AND x.st[2] = 'absent' AND x.st[3] = 'absent'`,
      [c, today],
    ),
    many(
      `SELECT tr.name AS route, count(*)::int AS n
         FROM attendance_records a
         JOIN students s ON s.id = a.student_id AND s.deleted_at IS NULL AND s.status = 'active'
         JOIN student_transport st ON st.student_id = s.id JOIN transport_routes tr ON tr.id = st.route_id
        WHERE ($1::uuid IS NULL OR s.campus_id = $1) AND a.status = 'late' AND a.attendance_date > $2::date - 30 AND a.attendance_date <= $2
        GROUP BY tr.name ORDER BY count(*) DESC LIMIT 3`,
      [c, today],
    ),
    many(
      `SELECT extract(isodow FROM a.attendance_date)::int AS dow, count(*)::int AS n
         ${base} AND a.status = 'absent' AND a.attendance_date > $2::date - 28 AND a.attendance_date <= $2
        GROUP BY 1 ORDER BY 1`,
      [c, today],
    ),
    one(
      `WITH days AS (SELECT DISTINCT attendance_date AS d FROM attendance_records WHERE attendance_date <= $2 AND attendance_date > $2::date - 90),
            gaps AS (SELECT d, d - lag(d) OVER (ORDER BY d) AS gap, extract(isodow FROM d) AS dow FROM days)
       SELECT count(*)::int AS n FROM attendance_records a JOIN students s ON s.id = a.student_id AND s.deleted_at IS NULL AND s.status = 'active'
        WHERE ($1::uuid IS NULL OR s.campus_id = $1) AND a.status = 'absent'
          AND a.attendance_date IN (SELECT d FROM gaps WHERE gap > 1 AND NOT (dow = 1 AND gap <= 3))`,
      [c, today],
    ),
  ]);

  const t = todayRow!;
  const pct = t.marked ? Math.round((1000 * (t.present + t.late)) / t.marked) / 10 : null;
  const series = trend.reverse();
  // Every day except today (when today has no marks yet, the last row is already a prior day).
  const prior = series.filter((x) => x.date !== today);
  const avgPrior = prior.length ? prior.reduce((a, x) => a + x.pct, 0) / prior.length : null;
  const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const top = [...weekday].sort((a, b) => b.n - a.n)[0];
  const monday = weekday.find((w) => w.dow === 1)?.n ?? 0;
  const lateRouteTotal = lateRoutes.reduce((a, r) => a + r.n, 0);
  return {
    date: today,
    today: t,
    kpis: {
      attendancePct: pct,
      delta: pct != null && avgPrior != null ? Math.round((pct - avgPrior) * 10) / 10 : null,
      tenDayAverage: avgPrior != null ? Math.round(avgPrior * 10) / 10 : null,
      absent: t.absent,
      late: t.late,
      lateTopRoute: lateRoutes[0] ?? null,
      repeatAbsentees: repeat?.n ?? 0,
    },
    trend: {
      labels: series.map((x) => (x.date === today ? 'Today' : new Date(`${x.date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', timeZone: 'UTC' }))),
      values: series.map((x) => x.pct),
    },
    byGrade: { labels: byGrade.map((g) => g.label), present: byGrade.map((g) => g.present) },
    lateByTime: { labels: lateByTime.map((l) => l.label), values: lateByTime.map((l) => l.value) },
    patterns: [
      { label: 'Monday absence', value: monday, note: top ? (top.dow === 1 ? 'highest weekday' : `${DAYS[top.dow]} is highest`) : 'last 4 weeks' },
      { label: 'Post-holiday dip', value: postHoliday?.n ?? 0, note: 'after a school holiday' },
      { label: 'Route-linked late arrivals', value: lateRouteTotal, note: lateRoutes[0] ? `${lateRoutes[0].route} highest` : 'last 30 days' },
      { label: 'Repeat absentees (3+ days)', value: repeat?.n ?? 0, note: 'raised to Early Warning' },
    ],
  };
}
