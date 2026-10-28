import { many, one } from '../config/db.js';
import type { Permission } from '../config/rbac.js';
import { Where } from '../utils/sql.js';
import { forbidden, notFound } from '../utils/errors.js';
import type { AuthUser } from '../types.js';
import { studentScope } from './access.service.js';
import { getActiveScale } from './grading.service.js';
import { gradeFromScale, ordered } from './grading-shared.js';
import { STUDENT_ROW_SQL } from './students.service.js';
import {
  INTERVENTION_SQL, STAGES, col, schoolToday,
  type CsvColumn, type ReportDef, type ReportParams,
} from './intelligence-common.service.js';
import { SYSTEM_REPORTS } from './intelligence-systemreports.service.js';

/**
 * Analytics and standard reports. Every figure is computed from live tables; student
 * figures honour the user's data scope, and finance / admissions / workforce / safety
 * areas appear only for users who hold the matching read permission.
 */

const has = (u: AuthUser, p: Permission) => u.permissions.has(p);

function scoped(user: AuthUser, campusId?: string, alias = 's') {
  const w = new Where().add(`${alias}.deleted_at IS NULL AND ${alias}.status = 'active'`);
  studentScope(user, w, alias);
  w.addIf(campusId, `${alias}.campus_id = ?`);
  return w;
}

export function availableAreas(user: AuthUser) {
  const areas: { id: string; label: string }[] = [
    { id: 'students', label: 'Students' },
    { id: 'attendance', label: 'Attendance' },
    { id: 'academics', label: 'Academics' },
  ];
  if (has(user, 'admissions.read')) areas.push({ id: 'admissions', label: 'Admissions' });
  if (has(user, 'finance.read')) areas.push({ id: 'finance', label: 'Finance' });
  if (has(user, 'hr.read')) areas.push({ id: 'workforce', label: 'Workforce' });
  if (has(user, 'safety.read')) areas.push({ id: 'safety', label: 'Safety' });
  return areas;
}

const ATT_YEAR = `JOIN academic_years ay ON ay.is_current AND a.attendance_date BETWEEN ay.starts_on AND ay.ends_on`;

async function studentsArea(user: AuthUser, campusId?: string) {
  const w = scoped(user, campusId);
  const [enrolment, bands, signals, attVsAvg, participation] = await Promise.all([
    many(`SELECT 'G' || c.grade_level AS label, count(*)::int AS value FROM students s
            JOIN sections sec ON sec.id = s.section_id JOIN classes c ON c.id = sec.class_id
          ${w.sql} GROUP BY c.grade_level ORDER BY c.grade_level`, w.params),
    many(`SELECT s.risk_level AS label, count(*)::int AS value FROM students s ${w.sql}
          GROUP BY s.risk_level ORDER BY array_position(ARRAY['On Track','Watch','Developing Risk','At Risk'], s.risk_level)`, w.params),
    many(`SELECT to_char(m, 'Mon') AS label,
                 (SELECT count(*) FROM early_warning_signals e JOIN students s ON s.id = e.student_id
                   ${w.sql} AND date_trunc('month', e.raised_on) = m)::int AS raised,
                 (SELECT count(*) FROM early_warning_signals e JOIN students s ON s.id = e.student_id
                   ${w.sql} AND e.stage = 5 AND date_trunc('month', e.closed_at) = m)::int AS closed
            FROM generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') m
           ORDER BY m`, w.params),
    many(`WITH per AS (
            SELECT s.id,
                   (SELECT 100.0 * count(*) FILTER (WHERE a.status IN ('present', 'late')) / NULLIF(count(*), 0)
                      FROM attendance_records a ${ATT_YEAR} WHERE a.student_id = s.id) AS att,
                   (SELECT avg(x.score) FROM (SELECT r.score, r.term_order, max(r.term_order) OVER () AS mx
                      FROM student_academic_records r JOIN academic_years y ON y.id = r.academic_year_id AND y.is_current
                     WHERE r.student_id = s.id) x WHERE x.term_order = x.mx) AS avg
              FROM students s ${w.sql})
          SELECT b.label, round(avg(per.avg))::int AS value, count(per.id)::int AS students
            FROM (VALUES (1, '<80%', 0, 80), (2, '80–85%', 80, 85), (3, '85–90%', 85, 90), (4, '90–95%', 90, 95), (5, '>95%', 95, 101)) b(o, label, lo, hi)
            LEFT JOIN per ON per.att >= b.lo AND per.att < b.hi
           GROUP BY b.o, b.label ORDER BY b.o`, w.params),
    one(`SELECT count(*)::int AS total,
                count(*) FILTER (WHERE EXISTS (SELECT 1 FROM student_activities sa WHERE sa.student_id = s.id AND sa.status = 'active'))::int AS participating
           FROM students s ${w.sql}`, w.params),
  ]);
  return { enrolment, bands, signals, attendanceVsAverage: attVsAvg, participation };
}

async function attendanceArea(user: AuthUser, campusId?: string) {
  const w = scoped(user, campusId);
  const [trend, byGrade, weekday, today] = await Promise.all([
    many(`SELECT * FROM (
            SELECT to_char(a.attendance_date, 'DD Mon') AS label, a.attendance_date AS date,
                   round(100.0 * count(*) FILTER (WHERE a.status IN ('present', 'late')) / NULLIF(count(*), 0), 1)::float AS value
              FROM attendance_records a JOIN students s ON s.id = a.student_id
             ${w.sql} AND a.attendance_date > current_date - 35
             GROUP BY a.attendance_date ORDER BY a.attendance_date DESC LIMIT 20) t ORDER BY date`, w.params),
    many(`SELECT 'G' || c.grade_level AS label,
                 round(100.0 * count(*) FILTER (WHERE a.status IN ('present', 'late')) / NULLIF(count(*), 0))::int AS value
            FROM attendance_records a JOIN students s ON s.id = a.student_id
            JOIN sections sec ON sec.id = a.section_id JOIN classes c ON c.id = sec.class_id
           ${w.sql} AND a.attendance_date > current_date - 30
           GROUP BY c.grade_level ORDER BY c.grade_level`, w.params),
    many(`SELECT trim(to_char(a.attendance_date, 'Dy')) AS label, extract(isodow FROM a.attendance_date)::int AS dow,
                 count(*) FILTER (WHERE a.status = 'absent')::int AS value
            FROM attendance_records a JOIN students s ON s.id = a.student_id
           ${w.sql} AND a.attendance_date > current_date - 60
           GROUP BY 1, 2 ORDER BY 2`, w.params),
    one(`SELECT count(s.id)::int AS students, count(a.id)::int AS marked,
                count(a.id) FILTER (WHERE a.status IN ('present', 'late'))::int AS present,
                count(a.id) FILTER (WHERE a.status = 'absent')::int AS absent,
                count(a.id) FILTER (WHERE a.status = 'late')::int AS late
           FROM students s LEFT JOIN attendance_records a ON a.student_id = s.id AND a.attendance_date = current_date ${w.sql}`, w.params),
  ]);
  return { trend, byGrade, weekday, today };
}

async function academicsArea(user: AuthUser, campusId?: string) {
  const w = scoped(user, campusId);
  const latest = `WITH r AS (
      SELECT r.student_id, r.subject_id, r.score, r.term, r.term_order, max(r.term_order) OVER () AS mx
        FROM student_academic_records r JOIN academic_years ay ON ay.id = r.academic_year_id AND ay.is_current
        JOIN students s ON s.id = r.student_id ${w.sql})`;
  const [subjects, terms, scoreCounts, coverage, completion, scale] = await Promise.all([
    many(`${latest} SELECT sub.name AS label, round(avg(r.score))::int AS value FROM r JOIN subjects sub ON sub.id = r.subject_id
           WHERE r.term_order = r.mx GROUP BY sub.name ORDER BY sub.name`, w.params),
    many(`${latest} SELECT r.term AS label, round(avg(r.score))::int AS value FROM r GROUP BY r.term, r.term_order ORDER BY r.term_order`, w.params),
    // Latest-term scores, bucketed below onto the Cambridge IGCSE scale (A*–G, U).
    many<{ score: number; n: number }>(`${latest} SELECT r.score::float AS score, count(*)::int AS n FROM r WHERE r.term_order = r.mx GROUP BY r.score`, w.params),
    many(`SELECT sub.name AS label, round(avg(o.coverage_pct))::int AS coverage, round(avg(o.mastery_pct))::int AS mastery, count(*)::int AS objectives
            FROM learning_objectives o JOIN subjects sub ON sub.id = o.subject_id GROUP BY sub.name ORDER BY sub.name`),
    (() => {
      const aw = new Where().add('a.held_on <= current_date').add('a.academic_year_id = (SELECT id FROM academic_years WHERE is_current)');
      if (campusId) aw.add('c.campus_id = ?', campusId);
      if (!has(user, 'students.read')) {
        aw.add(`a.class_id IN (SELECT sec.class_id FROM sections sec WHERE sec.id IN (
                  SELECT section_id FROM teacher_assignments WHERE employee_id = ? UNION SELECT id FROM sections WHERE class_teacher_id = ?))`,
        user.employeeId, user.employeeId);
      }
      return one(`SELECT count(*)::int AS assessments,
                         COALESCE(sum((SELECT count(*) FROM assessment_marks m WHERE m.assessment_id = a.id)), 0)::int AS entered,
                         COALESCE(sum((SELECT count(*) FROM students st WHERE st.deleted_at IS NULL AND st.status = 'active'
                                         AND (st.section_id = a.section_id OR (a.section_id IS NULL AND st.section_id IN (SELECT id FROM sections WHERE class_id = a.class_id))))), 0)::int AS expected
                    FROM assessments a JOIN classes c ON c.id = a.class_id
                   ${aw.sql}`, aw.params);
    })(),
    getActiveScale(),
  ]);
  const counts = new Map<string, number>();
  for (const x of scoreCounts) {
    const g = gradeFromScale(scale, x.score);
    counts.set(g, (counts.get(g) ?? 0) + x.n);
  }
  const distribution = ordered(scale).map((b) => ({ label: b.grade, value: counts.get(b.grade) ?? 0 }));
  return {
    subjects, terms, distribution, coverage,
    completion: { ...completion, pct: completion?.expected ? Math.round((completion.entered / completion.expected) * 100) : null },
  };
}

async function admissionsArea(campusId?: string) {
  const p = campusId ? [campusId] : [];
  const cf = campusId ? 'AND e.campus_id = $1' : '';
  const [stages, sources, monthly, totals] = await Promise.all([
    many(`SELECT e.stage AS label, count(*)::int AS value FROM enquiries e WHERE e.deleted_at IS NULL ${cf} GROUP BY e.stage`, p),
    many(`SELECT e.source AS label, count(*)::int AS value FROM enquiries e WHERE e.deleted_at IS NULL ${cf} GROUP BY e.source ORDER BY 2 DESC`, p),
    many(`SELECT to_char(m, 'Mon') AS label,
                 (SELECT count(*) FROM enquiries e WHERE e.deleted_at IS NULL ${cf} AND date_trunc('month', e.created_at) = m)::int AS enquiries,
                 (SELECT count(DISTINCT h.enquiry_id) FROM enquiry_stage_history h JOIN enquiries e ON e.id = h.enquiry_id
                   WHERE h.to_stage = 'Enrolled' ${cf} AND date_trunc('month', h.changed_at) = m)::int AS admissions
            FROM generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') m ORDER BY m`, p),
    one(`SELECT count(*)::int AS enquiries, count(*) FILTER (WHERE e.stage = 'Enrolled')::int AS enrolled,
                COALESCE(sum(e.acquisition_cost), 0)::numeric AS spend
           FROM enquiries e WHERE e.deleted_at IS NULL ${cf}`, p),
  ]);
  const ORDER = ['New Lead', 'Contacted', 'Qualified', 'Visit Scheduled', 'Visit Completed', 'Application', 'Assessment', 'Offer', 'Enrolled'];
  const counts = new Map(stages.map((s) => [s.label, s.value]));
  const cum = (i: number) => ORDER.slice(i).reduce((a, s) => a + (counts.get(s) ?? 0), 0);
  return {
    funnel: [['Enquiry', 0], ['Qualified', 2], ['Visit', 4], ['Application', 5], ['Assessment', 6], ['Offer', 7], ['Admission', 8]]
      .map(([label, i]) => ({ label, value: cum(i as number) })),
    sources, monthly, totals,
    conversion: totals?.enquiries ? Math.round((totals.enrolled / totals.enquiries) * 1000) / 10 : null,
    lost: counts.get('Lost') ?? 0,
  };
}

async function financeArea(campusId?: string) {
  const p = campusId ? [campusId] : [];
  const cf = campusId ? 'AND s.campus_id = $1' : '';
  const [trend, ageing, methods, totals] = await Promise.all([
    many(`SELECT to_char(date_trunc('month', f.due_date), 'Mon') AS label, date_trunc('month', f.due_date) AS m,
                 COALESCE(sum(f.amount_due - f.concession_amount), 0)::numeric AS billed, COALESCE(sum(f.amount_paid), 0)::numeric AS collected
            FROM student_fees f JOIN students s ON s.id = f.student_id
            JOIN academic_years ay ON ay.id = f.academic_year_id AND ay.is_current
           WHERE f.due_date <= current_date + 31 ${cf}
           GROUP BY 1, 2 ORDER BY 2`, p),
    many(`WITH od AS (
            SELECT current_date - f.due_date AS age, f.amount_due - f.concession_amount - f.amount_paid AS amount
              FROM student_fees f JOIN students s ON s.id = f.student_id
             WHERE f.due_date < current_date AND f.amount_paid < f.amount_due - f.concession_amount ${cf})
          SELECT b.label, COALESCE(sum(od.amount), 0)::numeric AS value
            FROM (VALUES (1, '0–30 days', 0, 30), (2, '31–60 days', 31, 60), (3, '61–90 days', 61, 90), (4, '90+ days', 91, 100000)) b(o, label, lo, hi)
            LEFT JOIN od ON od.age BETWEEN b.lo AND b.hi
           GROUP BY b.o, b.label ORDER BY b.o`, p),
    many(`SELECT p.method AS label, COALESCE(sum(p.amount), 0)::numeric AS value FROM fee_payments p JOIN students s ON s.id = p.student_id
           WHERE p.status = 'Success' ${cf} GROUP BY p.method ORDER BY 2 DESC`, p),
    one(`SELECT COALESCE(sum(f.amount_due - f.concession_amount), 0)::numeric AS billed, COALESCE(sum(f.amount_paid), 0)::numeric AS collected
           FROM student_fees f JOIN students s ON s.id = f.student_id JOIN academic_years ay ON ay.id = f.academic_year_id AND ay.is_current
          WHERE true ${cf}`, p),
  ]);
  return {
    trend: trend.map(({ m: _m, ...r }) => r), ageing, methods, totals,
    collectionRate: totals?.billed ? Math.round((totals.collected / totals.billed) * 1000) / 10 : null,
  };
}

async function workforceArea(campusId?: string) {
  const p = campusId ? [campusId] : [];
  const cf = campusId ? 'AND e.campus_id = $1' : '';
  const [composition, attendance, cpd] = await Promise.all([
    many(`SELECT e.category AS label, count(*)::int AS value FROM employees e
           WHERE e.deleted_at IS NULL AND e.employment_status = 'active' ${cf} GROUP BY e.category ORDER BY 2 DESC`, p),
    many(`SELECT e.department AS label,
                 round(100.0 * count(*) FILTER (WHERE sa.status IN ('Present', 'Late', 'Half Day')) / NULLIF(count(*), 0))::int AS value
            FROM staff_attendance sa JOIN employees e ON e.id = sa.employee_id
           WHERE sa.attendance_date > current_date - 30 ${cf} GROUP BY e.department ORDER BY e.department`, p),
    one(`SELECT round(avg(e.cpd_hours), 1)::float AS average, count(*)::int AS staff,
                count(*) FILTER (WHERE e.cpd_hours >= 24)::int AS "metTarget"
           FROM employees e WHERE e.deleted_at IS NULL AND e.employment_status = 'active' AND e.employee_type = 'teaching' ${cf}`, p),
  ]);
  return { composition, attendance, cpd: { ...cpd, target: 24 } };
}

async function safetyArea(campusId?: string) {
  const p = campusId ? [campusId] : [];
  const [arrivals, incidents, routes, delivery] = await Promise.all([
    many(`SELECT to_char(slot, 'HH24:MI') AS label,
                 (SELECT count(*) FROM gate_events g WHERE g.direction = 'in' AND g.occurred_at >= current_date
                    AND g.occurred_at < slot + interval '15 minutes' ${campusId ? 'AND g.campus_id = $1' : ''})::int AS value
            FROM generate_series(current_date + time '07:30', current_date + time '09:00', interval '15 minutes') slot
           ORDER BY slot`, p),
    many(`SELECT i.incident_type AS label, count(*)::int AS value FROM incidents i
           WHERE i.occurred_on >= current_date - 90 ${campusId ? 'AND i.campus_id = $1' : ''} GROUP BY 1 ORDER BY 2 DESC`, p),
    many(`SELECT tr.code AS label, tr.delay_minutes AS delay, tr.run_status AS status FROM transport_routes tr
           WHERE true ${campusId ? 'AND tr.campus_id = $1' : ''} ORDER BY tr.code`, p),
    one(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status IN ('sent', 'delivered'))::int AS delivered,
                count(*) FILTER (WHERE status = 'pending')::int AS pending, count(*) FILTER (WHERE status = 'failed')::int AS failed
           FROM notification_deliveries WHERE created_at > now() - interval '30 days'`),
  ]);
  return { arrivals, incidents, routes, delivery };
}

export async function analytics(user: AuthUser, area: string, campusId?: string) {
  const areas = availableAreas(user);
  if (!areas.some((a) => a.id === area)) throw forbidden(`The ${area} analytics area is not available for your role`);
  const data =
    area === 'students' ? await studentsArea(user, campusId)
      : area === 'attendance' ? await attendanceArea(user, campusId)
        : area === 'academics' ? await academicsArea(user, campusId)
          : area === 'admissions' ? await admissionsArea(campusId)
            : area === 'finance' ? await financeArea(campusId)
              : area === 'workforce' ? await workforceArea(campusId)
                : await safetyArea(campusId);
  return { area, areas, scope: has(user, 'students.read') ? 'school' : 'assigned classes', generatedAt: new Date().toISOString(), data };
}

// =============================================================================
// Standard reports (CSV)
// =============================================================================
// `ReportDef`, `ReportParams` and `col` live in intelligence-common.service.ts so the
// catalogue, the CSV export and the Report Centre preview all read one definition.

const CORE_REPORTS: ReportDef[] = [
  {
    key: 'attendance-daily', group: 'Students', title: 'Daily attendance summary',
    description: 'Present, absent and late by class and campus', perms: ['attendance.read'],
    filters: ['campus', 'date'],
    summary: [
      { key: 'present', label: 'Present', agg: 'sum', tone: 'teal' },
      { key: 'late', label: 'Late', agg: 'sum', tone: 'amber' },
      { key: 'absent', label: 'Absent', agg: 'sum', tone: 'critical' },
      { key: 'students', label: 'On roll', agg: 'sum', tone: 'info' },
    ],
    chart: { mode: 'value', labelKey: 'grade', valueKey: 'present', label: 'Present by grade' },
    build: async (user, p) => {
      const w = scoped(user, p.campusId);
      const date = p.date ?? schoolToday();
      const rows = await many(
        `SELECT cp.short_name AS campus, c.name AS grade, sec.name AS section, count(s.id)::int AS students,
                count(a.id)::int AS marked, count(a.id) FILTER (WHERE a.status = 'present')::int AS present,
                count(a.id) FILTER (WHERE a.status = 'late')::int AS late, count(a.id) FILTER (WHERE a.status = 'absent')::int AS absent,
                count(a.id) FILTER (WHERE a.status = 'leave')::int AS leave,
                round(100.0 * count(a.id) FILTER (WHERE a.status IN ('present', 'late')) / NULLIF(count(a.id), 0), 1) AS "presentPct"
           FROM students s JOIN campuses cp ON cp.id = s.campus_id
           JOIN sections sec ON sec.id = s.section_id JOIN classes c ON c.id = sec.class_id
           LEFT JOIN attendance_records a ON a.student_id = s.id AND a.attendance_date = ${'$' + (w.params.length + 1)}
          ${w.sql}
          GROUP BY cp.short_name, c.grade_level, c.name, sec.name ORDER BY cp.short_name, c.grade_level, sec.name`,
        [...w.params, date]);
      return {
        columns: [col('campus', 'Campus'), col('grade', 'Grade'), col('section', 'Section'), col('students', 'Students'), col('marked', 'Marked'),
          col('present', 'Present'), col('late', 'Late'), col('absent', 'Absent'), col('leave', 'Leave'), col('presentPct', 'Present %')],
        rows: rows.map((r) => ({ ...r, date })),
      };
    },
  },
  {
    key: 'early-warning', group: 'Students', title: 'Early Warning review list',
    description: 'Open signals, interventions and owners', perms: ['earlywarning.read'],
    filters: ['campus'],
    chart: { mode: 'count', labelKey: 'risk', label: 'Open signals by risk' },
    build: async (user, p) => {
      const w = new Where().add('s.deleted_at IS NULL').add('e.closed_at IS NULL');
      studentScope(user, w);
      w.addIf(p.campusId, 's.campus_id = ?');
      const rows = await many(
        `SELECT e.code, s.admission_no AS "admissionNo", s.full_name AS student, c.name || sec.name AS class, s.risk_level AS risk,
                e.signal_type AS type, e.signal, e.stage, COALESCE(e.review_decision, 'awaiting review') AS decision,
                o.full_name AS owner, e.action_plan AS "actionPlan", e.raised_on AS raised, e.next_review_on AS "nextReview"
           FROM early_warning_signals e JOIN students s ON s.id = e.student_id
           LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
           LEFT JOIN employees o ON o.id = e.owner_id
          ${w.sql} ORDER BY e.stage, e.raised_on`, w.params);
      return {
        columns: [col('code', 'Signal'), col('admissionNo', 'Admission no'), col('student', 'Student'), col('class', 'Class'), col('risk', 'Risk'),
          col('type', 'Type'), col('signal', 'Signal detail'), col('stageLabel', 'Stage'), col('decision', 'Review'), col('owner', 'Owner'),
          col('actionPlan', 'Action plan'), col('raised', 'Raised'), col('nextReview', 'Next review')],
        rows: rows.map((r) => ({ ...r, stageLabel: STAGES[r.stage] })),
      };
    },
  },
  {
    key: 'student-progress', group: 'Students', title: 'Student progress report',
    description: 'Academic trend, attendance and participation per student', perms: ['students.read', 'students.read_assigned'],
    filters: ['campus'],
    summary: [
      { key: 'attendance', label: 'Mean attendance', agg: 'avg', unit: '%', tone: 'teal' },
      { key: 'average', label: 'Mean latest average', agg: 'avg', unit: '%', tone: 'info' },
    ],
    chart: { mode: 'count', labelKey: 'risk', label: 'Students by risk band' },
    build: async (user, p) => {
      const w = scoped(user, p.campusId);
      const rows = await many(
        `SELECT q.*, ${INTERVENTION_SQL('q."interventionStage"', 'q."signalCode"')} AS intervention,
                (SELECT count(*) FROM student_activities sa WHERE sa.student_id = q.id AND sa.status = 'active')::int AS activities
           FROM (${STUDENT_ROW_SQL} ${w.sql}) q ORDER BY q."campusCode", q."gradeLevel", q.section, q."fullName"`, w.params);
      return {
        columns: [col('admissionNo', 'Admission no'), col('fullName', 'Student'), col('campusName', 'Campus'), col('grade', 'Grade'), col('section', 'Section'),
          col('attendance', 'Attendance %'), col('average', 'Latest average'), col('trend', 'Trend'), col('risk', 'Risk'),
          col('intervention', 'Intervention'), col('activities', 'Active activities')],
        rows,
      };
    },
  },
  {
    key: 'portfolio-completeness', group: 'Students', title: 'Portfolio completeness',
    description: 'Evidence coverage by grade', perms: ['students.read', 'students.read_assigned'],
    filters: ['campus'],
    summary: [
      { key: 'students', label: 'Students', agg: 'sum', tone: 'info' },
      { key: 'complete', label: 'Mean completeness', agg: 'avg', unit: '%', tone: 'teal' },
    ],
    chart: { mode: 'value', labelKey: 'label', valueKey: 'complete', label: 'Complete % by grade' },
    build: async (user, p) => {
      const { portfolioOverview } = await import('./intelligence-students.service.js');
      const o = await portfolioOverview(user, p.campusId);
      return {
        columns: [col('label', 'Grade'), col('students', 'Students'), col('achievements', 'Achievements %'), col('activities', 'Activities %'),
          col('projects', 'Projects %'), col('documents', 'Documents %'), col('complete', 'Complete %')],
        rows: o.byGrade,
      };
    },
  },
  {
    key: 'assessment-results', group: 'Academics', title: 'Assessment results pack',
    description: 'Results per assessment with averages and completion', perms: ['academics.read'],
    filters: ['campus'],
    summary: [
      { key: 'entered', label: 'Marks entered', agg: 'sum', tone: 'info' },
      { key: 'absent', label: 'Absent', agg: 'sum', tone: 'amber' },
      { key: 'averagePct', label: 'Mean average', agg: 'avg', unit: '%', tone: 'teal' },
    ],
    chart: { mode: 'count', labelKey: 'subject', label: 'Assessments by subject' },
    build: async (user, p) => {
      const w = new Where().add('a.academic_year_id = (SELECT id FROM academic_years WHERE is_current)');
      w.addIf(p.campusId, 'c.campus_id = ?');
      if (!has(user, 'students.read')) w.add(`a.section_id IN (SELECT section_id FROM teacher_assignments WHERE employee_id = ? UNION SELECT id FROM sections WHERE class_teacher_id = ?)`, user.employeeId, user.employeeId);
      const rows = await many(
        `SELECT a.code, a.name, c.name || COALESCE(sec.name, '') AS class, sub.name AS subject, a.assessment_type AS type, a.held_on AS "heldOn",
                a.max_marks AS "maxMarks", count(m.id)::int AS entered, count(m.id) FILTER (WHERE m.is_absent)::int AS absent,
                round(avg(100.0 * m.marks / a.max_marks) FILTER (WHERE NOT m.is_absent), 1) AS "averagePct",
                round(min(100.0 * m.marks / a.max_marks) FILTER (WHERE NOT m.is_absent), 1) AS "minPct",
                round(max(100.0 * m.marks / a.max_marks) FILTER (WHERE NOT m.is_absent), 1) AS "maxPct"
           FROM assessments a JOIN classes c ON c.id = a.class_id JOIN subjects sub ON sub.id = a.subject_id
           LEFT JOIN sections sec ON sec.id = a.section_id LEFT JOIN assessment_marks m ON m.assessment_id = a.id
          ${w.sql}
          GROUP BY a.id, c.name, c.grade_level, sec.name, sub.name ORDER BY a.held_on DESC, c.grade_level`, w.params);
      return {
        columns: [col('code', 'Code'), col('name', 'Assessment'), col('class', 'Class'), col('subject', 'Subject'), col('type', 'Type'), col('heldOn', 'Held on'),
          col('maxMarks', 'Max marks'), col('entered', 'Marks entered'), col('absent', 'Absent'), col('averagePct', 'Average %'), col('minPct', 'Lowest %'), col('maxPct', 'Highest %')],
        rows,
      };
    },
  },
  {
    key: 'curriculum-coverage', group: 'Academics', title: 'Curriculum coverage',
    description: 'Objectives taught against objectives planned', perms: ['academics.read'],
    filters: ['campus'],
    summary: [
      { key: 'coverage', label: 'Mean coverage', agg: 'avg', unit: '%', tone: 'teal' },
      { key: 'mastery', label: 'Mean mastery', agg: 'avg', unit: '%', tone: 'info' },
    ],
    chart: { mode: 'count', labelKey: 'subject', label: 'Objectives by subject' },
    build: async () => ({
      columns: [col('code', 'Objective'), col('subject', 'Subject'), col('stage', 'Stage'), col('description', 'Description'), col('coverage', 'Coverage %'), col('mastery', 'Mastery %')],
      rows: await many(`SELECT o.code, sub.name AS subject, o.stage_label AS stage, o.description, o.coverage_pct AS coverage, o.mastery_pct AS mastery
                          FROM learning_objectives o JOIN subjects sub ON sub.id = o.subject_id ORDER BY sub.name, o.code`),
    }),
  },
  {
    key: 'report-card-status', group: 'Academics', title: 'Report card status',
    description: 'Where every class sits in the release workflow', perms: ['academics.read'],
    filters: ['campus'],
    chart: { mode: 'count', labelKey: 'stageLabel', label: 'Classes by stage' },
    build: async (_user, p) => {
      const stages = ['Marks entry', 'Moderation', 'AI draft comments', 'Teacher review', 'Approval', 'Parent release'];
      const rows = await many(
        `SELECT cp.short_name AS campus, c.name || sec.name AS class, b.term, b.stage, b.due_on AS due, b.released_at AS released,
                (SELECT count(*) FROM report_card_comments rc WHERE rc.batch_id = b.id)::int AS comments,
                (SELECT count(*) FROM report_card_comments rc WHERE rc.batch_id = b.id AND rc.status = 'Approved')::int AS approved
           FROM report_card_batches b JOIN sections sec ON sec.id = b.section_id JOIN classes c ON c.id = sec.class_id
           JOIN campuses cp ON cp.id = c.campus_id
          WHERE ($1::uuid IS NULL OR c.campus_id = $1) ORDER BY cp.short_name, c.grade_level, sec.name`, [p.campusId ?? null]);
      return {
        columns: [col('campus', 'Campus'), col('class', 'Class'), col('term', 'Term'), col('stageLabel', 'Stage'), col('due', 'Due'),
          col('comments', 'Comments'), col('approved', 'Approved comments'), col('released', 'Released at')],
        rows: rows.map((r) => ({ ...r, stageLabel: stages[r.stage] })),
      };
    },
  },
  {
    key: 'admissions-funnel', group: 'Operations', title: 'Admissions funnel report',
    description: 'Stage movement, source mix and cost per admission', perms: ['admissions.read'],
    filters: ['campus'],
    summary: [{ key: 'enquiries', label: 'Enquiries', agg: 'sum', tone: 'info' }],
    chart: { mode: 'value', labelKey: 'source', valueKey: 'enquiries', label: 'Enquiries by source' },
    build: async (_user, p) => ({
      columns: [col('source', 'Source'), col('enquiries', 'Enquiries'), col('qualified', 'Qualified or later'), col('visits', 'Visited or later'),
        col('applications', 'Applications or later'), col('enrolled', 'Enrolled'), col('lost', 'Lost'), col('spend', 'Spend (INR)'), col('costPerAdmission', 'Cost per admission (INR)')],
      rows: await many(
        `SELECT e.source, count(*)::int AS enquiries,
                count(*) FILTER (WHERE e.stage IN ('Qualified','Visit Scheduled','Visit Completed','Application','Assessment','Offer','Enrolled'))::int AS qualified,
                count(*) FILTER (WHERE e.stage IN ('Visit Completed','Application','Assessment','Offer','Enrolled'))::int AS visits,
                count(*) FILTER (WHERE e.stage IN ('Application','Assessment','Offer','Enrolled'))::int AS applications,
                count(*) FILTER (WHERE e.stage = 'Enrolled')::int AS enrolled,
                count(*) FILTER (WHERE e.stage = 'Lost')::int AS lost,
                sum(e.acquisition_cost)::numeric AS spend,
                round(sum(e.acquisition_cost) / NULLIF(count(*) FILTER (WHERE e.stage = 'Enrolled'), 0))::numeric AS "costPerAdmission"
           FROM enquiries e WHERE e.deleted_at IS NULL AND ($1::uuid IS NULL OR e.campus_id = $1)
          GROUP BY e.source ORDER BY 2 DESC`, [p.campusId ?? null]),
    }),
  },
  {
    key: 'fee-collection', group: 'Operations', title: 'Fee collection and ageing',
    description: 'Collection, outstanding and overdue by head', perms: ['finance.read'],
    filters: ['campus'],
    summary: [
      { key: 'billed', label: 'Billed', agg: 'sum', unit: 'INR', tone: 'info' },
      { key: 'collected', label: 'Collected', agg: 'sum', unit: 'INR', tone: 'teal' },
      { key: 'outstanding', label: 'Outstanding', agg: 'sum', unit: 'INR', tone: 'critical' },
    ],
    chart: { mode: 'value', labelKey: 'head', valueKey: 'outstanding', label: 'Outstanding by fee head' },
    build: async (_user, p) => ({
      columns: [col('head', 'Fee head'), col('billed', 'Billed (INR)'), col('collected', 'Collected (INR)'), col('outstanding', 'Outstanding (INR)'),
        col('overdue', 'Overdue (INR)'), col('overdue30', 'Overdue > 30 days (INR)'), col('accounts', 'Students'), col('collectionPct', 'Collection %')],
      rows: await many(
        `SELECT h.name AS head, sum(f.amount_due - f.concession_amount)::numeric AS billed, sum(f.amount_paid)::numeric AS collected,
                sum(f.amount_due - f.concession_amount - f.amount_paid)::numeric AS outstanding,
                COALESCE(sum(f.amount_due - f.concession_amount - f.amount_paid) FILTER (WHERE f.due_date < current_date), 0)::numeric AS overdue,
                COALESCE(sum(f.amount_due - f.concession_amount - f.amount_paid) FILTER (WHERE f.due_date < current_date - 30), 0)::numeric AS overdue30,
                count(DISTINCT f.student_id)::int AS accounts,
                round(100.0 * sum(f.amount_paid) / NULLIF(sum(f.amount_due - f.concession_amount), 0), 1) AS "collectionPct"
           FROM student_fees f JOIN fee_heads h ON h.id = f.fee_head_id JOIN students s ON s.id = f.student_id
           JOIN academic_years ay ON ay.id = f.academic_year_id AND ay.is_current
          WHERE ($1::uuid IS NULL OR s.campus_id = $1)
          GROUP BY h.name ORDER BY h.name`, [p.campusId ?? null]),
    }),
  },
  {
    key: 'payroll-cost', group: 'Operations', title: 'Payroll cost report',
    description: 'Gross, deductions and net by employee category', perms: ['payroll.read'],
    filters: ['campus'],
    summary: [
      { key: 'employees', label: 'Payslips', agg: 'sum', tone: 'info' },
      { key: 'gross', label: 'Gross', agg: 'sum', unit: 'INR', tone: 'info' },
      { key: 'net', label: 'Net paid', agg: 'sum', unit: 'INR', tone: 'teal' },
    ],
    chart: { mode: 'value', labelKey: 'category', valueKey: 'net', label: 'Net pay by category' },
    build: async (_user, p) => ({
      columns: [col('month', 'Pay month'), col('status', 'Run status'), col('category', 'Category'), col('employees', 'Employees'),
        col('gross', 'Gross (INR)'), col('deductions', 'Deductions (INR)'), col('net', 'Net (INR)')],
      rows: await many(
        `SELECT to_char(r.pay_month, 'Mon YYYY') AS month, r.status, e.category, count(*)::int AS employees,
                sum(ps.gross)::numeric AS gross, sum(ps.total_deductions)::numeric AS deductions, sum(ps.net)::numeric AS net
           FROM payslips ps JOIN payroll_runs r ON r.id = ps.payroll_run_id JOIN employees e ON e.id = ps.employee_id
          WHERE ($1::uuid IS NULL OR e.campus_id = $1)
          GROUP BY r.pay_month, r.status, e.category ORDER BY r.pay_month DESC, e.category`, [p.campusId ?? null]),
    }),
  },
  {
    key: 'compliance-status', group: 'Operations', title: 'Compliance status',
    description: 'Every requirement, owner and due date', perms: ['operations.read'],
    filters: ['campus'],
    summary: [{ key: 'status', label: 'Overdue', agg: 'count', equals: 'Overdue', tone: 'critical' }],
    chart: { mode: 'count', labelKey: 'status', label: 'Requirements by status' },
    build: async (_user, p) => ({
      columns: [col('campus', 'Campus'), col('item', 'Requirement'), col('authority', 'Authority'), col('owner', 'Owner'), col('due', 'Due'),
        col('status', 'Status'), col('completed', 'Completed on')],
      rows: await many(
        `SELECT cp.short_name AS campus, ci.item, ci.authority, ci.owner_name AS owner, ci.due_on AS due,
                CASE WHEN ci.status <> 'Completed' AND ci.due_on < current_date THEN 'Overdue' ELSE ci.status END AS status,
                ci.completed_on AS completed
           FROM compliance_items ci JOIN campuses cp ON cp.id = ci.campus_id
          WHERE ($1::uuid IS NULL OR ci.campus_id = $1) ORDER BY ci.due_on`, [p.campusId ?? null]),
    }),
  },
  {
    key: 'safety-log', group: 'Operations', title: 'Safety and incident log',
    description: 'Transport, health, facilities and safeguarding incidents', perms: ['safety.read'],
    filters: ['campus', 'range'],
    chart: { mode: 'count', labelKey: 'severity', label: 'Incidents by severity' },
    build: async (user, p) => ({
      columns: [col('code', 'Incident'), col('date', 'Date'), col('campus', 'Campus'), col('type', 'Type'), col('severity', 'Severity'),
        col('status', 'Status'), col('summary', 'Summary'), col('owner', 'Owner')],
      rows: await many(
        `SELECT i.code, i.occurred_on AS date, cp.short_name AS campus, i.incident_type AS type, i.severity, i.status,
                CASE WHEN i.is_confidential AND NOT $2 THEN 'Confidential — restricted' ELSE i.summary END AS summary,
                o.full_name AS owner
           FROM incidents i JOIN campuses cp ON cp.id = i.campus_id LEFT JOIN employees o ON o.id = i.owner_id
          WHERE ($1::uuid IS NULL OR i.campus_id = $1)
            AND i.occurred_on BETWEEN COALESCE($3::date, current_date - 90) AND COALESCE($4::date, current_date)
          ORDER BY i.occurred_on DESC`, [p.campusId ?? null, has(user, 'students.sensitive'), p.from ?? null, p.to ?? null]),
    }),
  },
  {
    key: 'daily-brief', group: 'Management', title: 'Daily brief',
    description: 'The end-of-day summary the Principal receives', perms: ['dashboard.view'], alsoRequires: ['students.read'],
    filters: ['campus'],
    chart: { mode: 'count', labelKey: 'area', label: 'Measures by area' },
    build: async (user, p) => {
      const { commandCenter } = await import('./dashboard.service.js');
      const d: any = await commandCenter(user, p.campusId ?? null);
      const rows: Record<string, unknown>[] = [
        { area: 'Students', metric: 'Active students', value: d.students?.total },
        { area: 'Students', metric: 'At Risk / Developing Risk', value: `${d.students?.atRisk} / ${d.students?.developing}` },
        { area: 'Attendance', metric: 'Marked today', value: `${d.attendance?.today?.marked} of ${d.attendance?.today?.total}` },
        { area: 'Attendance', metric: 'Present today %', value: d.attendance?.todayPct },
        { area: 'Attendance', metric: 'Absent / late today', value: `${d.attendance?.today?.absent} / ${d.attendance?.today?.late}` },
        { area: 'Attendance', metric: 'Repeat absentees (3+ consecutive days, 30 days)', value: d.attendance?.repeatAbsentees },
        { area: 'Staff', metric: 'Staff present / total', value: `${d.staff?.present} / ${d.staff?.total}` },
      ];
      if (d.earlyWarning) rows.push({ area: 'Early Warning', metric: 'Open signals / awaiting review', value: `${d.earlyWarning.open} / ${d.earlyWarning.awaitingReview}` });
      if (d.admissions) rows.push({ area: 'Admissions', metric: 'Enquiries this month / overdue follow-ups', value: `${d.admissions.thisMonth} / ${d.admissions.overdueFollowUps}` });
      if (d.finance) rows.push({ area: 'Finance', metric: 'Collected today (INR)', value: d.finance.collectedToday }, { area: 'Finance', metric: 'Overdue (INR)', value: d.finance.overdue });
      rows.push({ area: 'Approvals', metric: 'Approvals waiting', value: d.approvals?.total });
      if (d.compliance) rows.push({ area: 'Compliance', metric: 'Overdue / due in 14 days', value: `${d.compliance.overdue} / ${d.compliance.dueSoon}` });
      return { columns: [col('area', 'Area'), col('metric', 'Measure'), col('value', 'Value')], rows };
    },
  },
  {
    key: 'campus-comparison', group: 'Management', title: 'Campus comparison',
    description: 'Every measure, campus by campus', perms: ['group.read'],
    summary: [
      { key: 'students', label: 'Students', agg: 'sum', tone: 'info' },
      { key: 'atRisk', label: 'At Risk', agg: 'sum', tone: 'critical' },
      { key: 'staff', label: 'Active staff', agg: 'sum', tone: 'info' },
    ],
    chart: { mode: 'value', labelKey: 'campus', valueKey: 'students', label: 'Students by campus' },
    build: async () => ({
      columns: [col('campus', 'Campus'), col('students', 'Students'), col('attendancePct', 'Attendance % (30 days)'), col('average', 'Latest average'),
        col('atRisk', 'At Risk'), col('openSignals', 'Open signals'), col('staff', 'Active staff')],
      rows: await many(
        `SELECT cp.name AS campus,
                (SELECT count(*) FROM students s WHERE s.campus_id = cp.id AND s.deleted_at IS NULL AND s.status = 'active')::int AS students,
                (SELECT round(100.0 * count(*) FILTER (WHERE a.status IN ('present', 'late')) / NULLIF(count(*), 0), 1)
                   FROM attendance_records a JOIN students s ON s.id = a.student_id WHERE s.campus_id = cp.id AND a.attendance_date > current_date - 30) AS "attendancePct",
                (SELECT round(avg(x.score)) FROM (SELECT r.score, r.term_order, max(r.term_order) OVER () AS mx FROM student_academic_records r
                   JOIN academic_years ay ON ay.id = r.academic_year_id AND ay.is_current JOIN students s ON s.id = r.student_id WHERE s.campus_id = cp.id) x
                  WHERE x.term_order = x.mx)::int AS average,
                (SELECT count(*) FROM students s WHERE s.campus_id = cp.id AND s.deleted_at IS NULL AND s.status = 'active' AND s.risk_level = 'At Risk')::int AS "atRisk",
                (SELECT count(*) FROM early_warning_signals e JOIN students s ON s.id = e.student_id WHERE s.campus_id = cp.id AND e.closed_at IS NULL)::int AS "openSignals",
                (SELECT count(*) FROM employees e WHERE e.campus_id = cp.id AND e.deleted_at IS NULL AND e.employment_status = 'active')::int AS staff
           FROM campuses cp WHERE cp.is_active ORDER BY cp.established`),
    }),
  },
];

/** Every standard report: the teaching-domain set plus the Super Admin platform set. */
export const REPORTS: ReportDef[] = [...CORE_REPORTS, ...SYSTEM_REPORTS];

const canRun = (u: AuthUser, r: ReportDef) =>
  (!r.roles || r.roles.includes(u.roleKey))
  && r.perms.some((p) => has(u, p))
  && (r.alsoRequires ?? []).every((p) => has(u, p));

export function reportCatalog(user: AuthUser) {
  // Role-restricted reports are hidden outright rather than shown as locked — a
  // School Admin has no way to obtain them, so listing them would only mislead.
  return REPORTS.filter((r) => !r.roles || r.roles.includes(user.roleKey)).map((r) => ({
    key: r.key, group: r.group, title: r.title, description: r.description,
    available: canRun(user, r),
    requires: r.perms,
    alsoRequires: r.alsoRequires ?? [],
    filters: r.filters ?? ['campus'],
    restricted: Boolean(r.roles),
  }));
}

/** Resolves a report the caller is allowed to run, or throws 404 / 403. */
export function reportFor(user: AuthUser, key: string): ReportDef {
  const def = REPORTS.find((r) => r.key === key);
  // An unauthorised role-restricted report reads as missing, so the catalogue and
  // a direct request tell the same story.
  if (!def || (def.roles && !def.roles.includes(user.roleKey))) throw notFound('Report not found', 'REPORT_NOT_FOUND');
  if (!canRun(user, def)) {
    throw forbidden(`This report needs one of: ${def.perms.join(', ')}${def.alsoRequires?.length ? ` and ${def.alsoRequires.join(', ')}` : ''}`);
  }
  return def;
}

export async function buildReport(user: AuthUser, key: string, params: ReportParams) {
  const def = reportFor(user, key);
  const out = await def.build(user, params);
  return { ...out, title: def.title, filename: `${def.key}-${params.date ?? schoolToday()}.csv` };
}
