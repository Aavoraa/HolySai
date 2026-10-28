import { many, one } from '../config/db.js';
import type { AuthUser } from '../types.js';
import { trackingSummary } from './tracking.service.js';

/**
 * Management Command Center. Every number is computed from live tables;
 * nothing here is a stored or hard-coded statistic. `campusId` null = group view.
 */
export async function commandCenter(user: AuthUser, campusId: string | null) {
  const c = campusId;
  const perms = user.permissions;

  const [students, attendanceToday, trend, byGrade, lateByHour, weekday, repeatAbsent, staff] = await Promise.all([
    one(`SELECT count(*)::int AS total,
                count(*) FILTER (WHERE risk_level = 'At Risk')::int AS "atRisk",
                count(*) FILTER (WHERE risk_level = 'Developing Risk')::int AS developing,
                count(*) FILTER (WHERE risk_level IN ('On Track', 'Watch'))::int AS "onTrack"
           FROM students WHERE deleted_at IS NULL AND status = 'active' AND ($1::uuid IS NULL OR campus_id = $1)`, [c]),
    one(`SELECT count(*) FILTER (WHERE a.status = 'present')::int AS present,
                count(*) FILTER (WHERE a.status = 'late')::int AS late,
                count(*) FILTER (WHERE a.status = 'absent')::int AS absent,
                count(*) FILTER (WHERE a.status = 'leave')::int AS leave,
                count(a.id)::int AS marked,
                count(s.id)::int AS total
           FROM students s LEFT JOIN attendance_records a ON a.student_id = s.id AND a.attendance_date = current_date
          WHERE s.deleted_at IS NULL AND s.status = 'active' AND ($1::uuid IS NULL OR s.campus_id = $1)`, [c]),
    many(`SELECT to_char(a.attendance_date, 'Dy DD') AS label, a.attendance_date AS date, to_char(a.attendance_date, 'YYYY-MM-DD') AS day,
                 round(100.0 * count(*) FILTER (WHERE a.status IN ('present', 'late')) / NULLIF(count(*), 0), 1)::float AS value
            FROM attendance_records a JOIN students s ON s.id = a.student_id
           WHERE a.attendance_date > current_date - 21 AND ($1::uuid IS NULL OR s.campus_id = $1)
           GROUP BY a.attendance_date ORDER BY a.attendance_date DESC LIMIT 10`, [c]),
    many(`SELECT c.name AS grade, c.grade_level AS level,
                 round(100.0 * count(*) FILTER (WHERE a.status IN ('present', 'late')) / NULLIF(count(*), 0))::int AS present
            FROM attendance_records a JOIN students s ON s.id = a.student_id
            JOIN sections sec ON sec.id = a.section_id JOIN classes c ON c.id = sec.class_id
           WHERE a.attendance_date > current_date - 7 AND ($1::uuid IS NULL OR s.campus_id = $1)
           GROUP BY c.name, c.grade_level ORDER BY c.grade_level`, [c]),
    many(`SELECT to_char(date_trunc('hour', a.arrival_time) + (floor(extract(minute FROM a.arrival_time) / 15) * interval '15 min'), 'HH24:MI') AS label,
                 count(*)::int AS value
            FROM attendance_records a JOIN students s ON s.id = a.student_id
           WHERE a.attendance_date > current_date - 30 AND a.status = 'late' AND a.arrival_time IS NOT NULL
             AND ($1::uuid IS NULL OR s.campus_id = $1)
           GROUP BY 1 ORDER BY 1`, [c]),
    many(`SELECT to_char(a.attendance_date, 'Day') AS day, extract(isodow FROM a.attendance_date)::int AS dow,
                 count(*) FILTER (WHERE a.status = 'absent')::int AS absences
            FROM attendance_records a JOIN students s ON s.id = a.student_id
           WHERE a.attendance_date > current_date - 60 AND ($1::uuid IS NULL OR s.campus_id = $1)
           GROUP BY 1, 2 ORDER BY 2`, [c]),
    one(`SELECT count(DISTINCT student_id)::int AS n FROM (
           SELECT a.student_id, a.attendance_date,
                  a.attendance_date - (row_number() OVER (PARTITION BY a.student_id ORDER BY a.attendance_date))::int AS grp
             FROM attendance_records a JOIN students s ON s.id = a.student_id
            WHERE a.status = 'absent' AND a.attendance_date > current_date - 30 AND ($1::uuid IS NULL OR s.campus_id = $1)) x
          GROUP BY student_id, grp HAVING count(*) >= 3`, [c]),
    one(`SELECT count(*)::int AS total,
                count(sa.id) FILTER (WHERE sa.status IN ('Present', 'Late', 'Half Day'))::int AS present,
                count(sa.id) FILTER (WHERE sa.status = 'Absent')::int AS absent,
                count(sa.id) FILTER (WHERE sa.status = 'On Leave')::int AS "onLeave",
                count(sa.id) FILTER (WHERE sa.status = 'Late')::int AS late,
                count(*) FILTER (WHERE e.employee_type = 'teaching')::int AS teaching,
                count(*) FILTER (WHERE e.employee_type = 'non_teaching')::int AS "nonTeaching",
                count(sa.id) FILTER (WHERE e.employee_type = 'teaching' AND sa.status IN ('Present', 'Late', 'Half Day'))::int AS "teachingPresent",
                count(sa.id) FILTER (WHERE e.employee_type = 'non_teaching' AND sa.status IN ('Present', 'Late', 'Half Day'))::int AS "nonTeachingPresent"
           FROM employees e LEFT JOIN staff_attendance sa ON sa.employee_id = e.id AND sa.attendance_date = current_date
          WHERE e.deleted_at IS NULL AND e.employment_status = 'active' AND ($1::uuid IS NULL OR e.campus_id = $1)`, [c]),
  ]);

  const out: Record<string, unknown> = {
    scope: c ? 'campus' : 'group',
    generatedAt: new Date().toISOString(),
    students,
    attendance: {
      today: attendanceToday,
      todayPct: attendanceToday && attendanceToday.marked
        ? Math.round(((attendanceToday.present + attendanceToday.late) / attendanceToday.marked) * 1000) / 10
        : null,
      trend: trend.reverse(),
      byGrade,
      lateByTime: lateByHour,
      weekdayAbsences: weekday,
      repeatAbsentees: repeatAbsent?.n ?? 0,
    },
    staff,
  };

  // History behind the dashboard sparklines: month-end headcounts for the last
  // seven months (current students and staff by admission / joining date) and
  // staff attendance on the same school days as the student trend.
  const history = async () => {
  const [growth, staffDays] = await Promise.all([
    many(`WITH m AS (SELECT (date_trunc('month', current_date) - make_interval(months => n) + interval '1 month - 1 day')::date AS month_end
                       FROM generate_series(0, 6) n)
          SELECT to_char(m.month_end, 'Mon') AS label,
                 (SELECT count(*)::int FROM students s
                   WHERE s.deleted_at IS NULL AND s.status = 'active' AND COALESCE(s.admitted_on, s.created_at::date) <= m.month_end
                     AND ($1::uuid IS NULL OR s.campus_id = $1)) AS students,
                 (SELECT count(*)::int FROM employees e
                   WHERE e.deleted_at IS NULL AND e.employment_status = 'active' AND COALESCE(e.join_date, e.created_at::date) <= m.month_end
                     AND ($1::uuid IS NULL OR e.campus_id = $1)) AS staff
            FROM m ORDER BY m.month_end`, [c]),
    many(`SELECT to_char(sa.attendance_date, 'YYYY-MM-DD') AS day,
                 round(100.0 * count(*) FILTER (WHERE sa.status IN ('Present', 'Late', 'Half Day')) / NULLIF(count(*), 0), 1)::float AS value
            FROM staff_attendance sa JOIN employees e ON e.id = sa.employee_id
           WHERE sa.attendance_date > current_date - 21 AND ($1::uuid IS NULL OR e.campus_id = $1)
           GROUP BY sa.attendance_date`, [c]),
  ]);
  const staffByDay = new Map(staffDays.map((r) => [r.day, r.value as number]));
  (out.attendance as { staffTrend?: (number | null)[] }).staffTrend = trend.map((t) => staffByDay.get(t.day) ?? null);
  out.history = { months: growth.map((g) => g.label), students: growth.map((g) => g.students), staff: growth.map((g) => g.staff) };
  };

  const admissions = async () => {
  if (perms.has('admissions.read')) {
    const [funnel, adm, sources, overdueFollowUps] = await Promise.all([
      many(`SELECT stage AS label, count(*)::int AS value FROM enquiries
             WHERE deleted_at IS NULL AND ($1::uuid IS NULL OR campus_id = $1) GROUP BY stage`, [c]),
      one(`SELECT count(*)::int AS enquiries,
                  count(*) FILTER (WHERE stage = 'Enrolled')::int AS admitted,
                  count(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS "thisMonth",
                  count(*) FILTER (WHERE counsellor_id IS NULL AND stage NOT IN ('Enrolled', 'Lost'))::int AS unassigned,
                  COALESCE(sum(acquisition_cost), 0)::numeric AS spend
             FROM enquiries WHERE deleted_at IS NULL AND ($1::uuid IS NULL OR campus_id = $1)`, [c]),
      many(`SELECT source AS label, count(*)::int AS value FROM enquiries
             WHERE deleted_at IS NULL AND ($1::uuid IS NULL OR campus_id = $1) GROUP BY source ORDER BY 2 DESC`, [c]),
      one(`SELECT count(*)::int AS n FROM follow_ups f JOIN enquiries e ON e.id = f.enquiry_id
            WHERE f.completed_at IS NULL AND f.status = 'Scheduled' AND f.scheduled_at < now()
              AND ($1::uuid IS NULL OR e.campus_id = $1)`, [c]),
    ]);
    // Cumulative funnel: a lead at a later stage has passed every earlier stage.
    const ORDER = ['New Lead', 'Contacted', 'Qualified', 'Visit Scheduled', 'Visit Completed', 'Application', 'Assessment', 'Offer', 'Enrolled'];
    const counts = new Map(funnel.map((f) => [f.label, f.value]));
    const cumulative = ORDER.map((label, i) => ({ label, value: ORDER.slice(i).reduce((a, s) => a + (counts.get(s) ?? 0), 0) }));
    out.admissions = {
      ...adm,
      conversion: adm && adm.enquiries ? Math.round((adm.admitted / adm.enquiries) * 1000) / 10 : 0,
      costPerAdmission: adm && adm.admitted ? Math.round(Number(adm.spend) / adm.admitted) : null,
      funnel: [
        { label: 'Enquiry', value: cumulative[0].value },
        { label: 'Qualified', value: cumulative[2].value },
        { label: 'Visit', value: cumulative[4].value },
        { label: 'Application', value: cumulative[5].value },
        { label: 'Assessment', value: cumulative[6].value },
        { label: 'Offer', value: cumulative[7].value },
        { label: 'Admission', value: cumulative[8].value },
      ],
      sources,
      overdueFollowUps: overdueFollowUps?.n ?? 0,
    };
  }
  };

  const finance = async () => {
  if (!perms.has('finance.read')) return;
  {
    out.finance = await one(
      `SELECT COALESCE(sum(f.amount_due - f.concession_amount), 0)::numeric AS billed,
              COALESCE(sum(f.amount_paid), 0)::numeric AS collected,
              COALESCE(sum(f.amount_due - f.concession_amount - f.amount_paid), 0)::numeric AS outstanding,
              COALESCE(sum(f.amount_due - f.concession_amount - f.amount_paid) FILTER (WHERE f.due_date < current_date), 0)::numeric AS overdue,
              count(DISTINCT f.student_id) FILTER (WHERE f.due_date < current_date AND f.amount_paid < f.amount_due - f.concession_amount)::int AS "overdueAccounts",
              COALESCE((SELECT sum(p.amount) FROM fee_payments p JOIN students s2 ON s2.id = p.student_id
                         WHERE p.status = 'Success' AND p.paid_at >= current_date AND ($1::uuid IS NULL OR s2.campus_id = $1)), 0)::numeric AS "collectedToday"
         FROM student_fees f JOIN students s ON s.id = f.student_id
         JOIN academic_years ay ON ay.id = f.academic_year_id AND ay.is_current
        WHERE ($1::uuid IS NULL OR s.campus_id = $1)`, [c]);
    const fin = out.finance as any;
    fin.collectionPct = fin.billed ? Math.round((fin.collected / fin.billed) * 1000) / 10 : 0;
    // Collection progress at each month end of the current academic year (successful payments to date / billed).
    const monthly = await many(
      `WITH ay AS (SELECT starts_on FROM academic_years WHERE is_current LIMIT 1),
            m AS (SELECT (date_trunc('month', current_date) - make_interval(months => n) + interval '1 month - 1 day')::date AS month_end
                    FROM generate_series(0, 6) n)
       SELECT to_char(m.month_end, 'Mon') AS label,
              COALESCE((SELECT sum(p.amount) FROM fee_payments p JOIN students s ON s.id = p.student_id
                         WHERE p.status = 'Success' AND p.paid_at::date >= ay.starts_on AND p.paid_at::date <= m.month_end
                           AND ($1::uuid IS NULL OR s.campus_id = $1)), 0)::float AS collected
         FROM m, ay WHERE m.month_end >= ay.starts_on ORDER BY m.month_end`, [c]);
    // Payments give the shape over time; scaled so the latest month equals the headline collection rate.
    const latest = monthly.length ? monthly[monthly.length - 1].collected : 0;
    fin.monthly = monthly.map((r) => ({ label: r.label, pct: latest ? Math.round(fin.collectionPct * (r.collected / latest) * 10) / 10 : 0 }));
  }
  };

  const earlyWarning = async () => {
  if (perms.has('earlywarning.read')) {
    out.earlyWarning = await one(
      `SELECT count(*) FILTER (WHERE e.closed_at IS NULL)::int AS open,
              count(*) FILTER (WHERE e.closed_at IS NULL AND e.stage = 0)::int AS "awaitingReview",
              count(*) FILTER (WHERE e.closed_at IS NULL AND e.review_decision = 'accepted')::int AS "inIntervention",
              count(*) FILTER (WHERE e.closed_at >= date_trunc('month', now()) - interval '2 months')::int AS "closedThisTerm"
         FROM early_warning_signals e JOIN students s ON s.id = e.student_id
        WHERE ($1::uuid IS NULL OR s.campus_id = $1)`, [c]);
  }
  };

  // Parent engagement: average engagement score and unanswered queries (for a campus,
  // the queries about its students or families — the Parent Communication campus rule).
  const UNANSWERED = `FROM communications cm WHERE cm.needs_reply AND cm.replied_at IS NULL
      AND ($1::uuid IS NULL OR (cm.student_id IS NULL AND cm.parent_id IS NULL)
           OR EXISTS (SELECT 1 FROM students cs WHERE cs.id = cm.student_id AND cs.campus_id = $1)
           OR (cm.student_id IS NULL AND EXISTS (SELECT 1 FROM student_guardians cg JOIN students cs ON cs.id = cg.student_id
                                                  WHERE cg.parent_id = cm.parent_id AND cs.campus_id = $1)))`;
  const engagement = async () => { out.parentEngagement = await one(
    `SELECT round(avg(p.engagement_score))::int AS score,
            (SELECT count(*) ${UNANSWERED})::int AS unanswered,
            (SELECT min(cm.occurred_at) ${UNANSWERED}) AS "oldestUnanswered"
       FROM parents p
      WHERE p.deleted_at IS NULL AND ($1::uuid IS NULL OR EXISTS (
            SELECT 1 FROM student_guardians sg JOIN students s ON s.id = sg.student_id WHERE sg.parent_id = p.id AND s.campus_id = $1))`, [c]); };

  // Academic performance: latest-term mean per grade.
  const academic = async () => { out.academic = {
    byGrade: await many(
      `WITH latest AS (
         SELECT r.student_id, r.score, r.term_order, max(r.term_order) OVER (PARTITION BY r.student_id) AS mx
           FROM student_academic_records r JOIN academic_years ay ON ay.id = r.academic_year_id AND ay.is_current)
       SELECT c.name AS grade, c.grade_level AS level, round(avg(l.score))::int AS average
         FROM latest l JOIN students s ON s.id = l.student_id
         JOIN sections sec ON sec.id = s.section_id JOIN classes c ON c.id = sec.class_id
        WHERE l.term_order = l.mx AND ($1::uuid IS NULL OR s.campus_id = $1)
        GROUP BY c.name, c.grade_level ORDER BY c.grade_level`, [c]),
  }; };

  // Pending approvals across modules.
  let approvals: any;
  const pending = async () => { approvals = await one(
    `SELECT
       (SELECT count(*) FROM expenses WHERE status IN ('Submitted', 'Under Review') AND ($1::uuid IS NULL OR campus_id = $1))::int AS expenses,
       (SELECT count(*) FROM leave_requests lr JOIN employees e ON e.id = lr.employee_id
         WHERE lr.status IN ('Submitted', 'Under Review') AND ($1::uuid IS NULL OR e.campus_id = $1))::int AS leave,
       (SELECT count(*) FROM overtime_entries o JOIN employees e ON e.id = o.employee_id
         WHERE o.status IN ('Submitted', 'Under Review') AND ($1::uuid IS NULL OR e.campus_id = $1))::int AS overtime,
       (SELECT count(*) FROM concessions WHERE status IN ('Submitted', 'Under Review'))::int AS concessions,
       (SELECT count(*) FROM reimbursements WHERE status IN ('Submitted', 'Under Review'))::int AS reimbursements,
       (SELECT count(*) FROM certificates WHERE status IN ('Submitted', 'Under Review'))::int AS certificates,
       (SELECT count(*) FROM payroll_runs WHERE status = 'Under Review')::int AS payroll`, [c]);
  out.approvals = { ...approvals, total: Object.values(approvals ?? {}).reduce((a: number, b) => a + Number(b), 0) }; };

  const tracking = async () => {
    if (perms.has('tracking.read_all') || perms.has('tracking.read_assigned')) out.tracking = await trackingSummary(user, c ?? undefined);
  };

  // Today's attention panel — derived, each item links to its module.
  let compliance: any;
  let busDelays: any[] = [];
  const operations = async () => { [compliance, busDelays] = await Promise.all([one(
    `SELECT count(*) FILTER (WHERE due_on < current_date AND status <> 'Completed')::int AS overdue,
            count(*) FILTER (WHERE due_on BETWEEN current_date AND current_date + 14 AND status <> 'Completed')::int AS "dueSoon",
            (SELECT item FROM compliance_items WHERE due_on < current_date AND status <> 'Completed' AND ($1::uuid IS NULL OR campus_id = $1) ORDER BY due_on LIMIT 1) AS "firstOverdue"
       FROM compliance_items WHERE ($1::uuid IS NULL OR campus_id = $1)`, [c]),
    many(
    `SELECT tr.name, tr.delay_minutes AS delay FROM transport_routes tr
      WHERE tr.run_status = 'Delayed' AND ($1::uuid IS NULL OR tr.campus_id = $1) ORDER BY tr.delay_minutes DESC`, [c])]); };

  // Live activity feed from the audit trail and gate.
  const activity = async () => { out.activity = await many(
    `SELECT * FROM (
       SELECT created_at AS at, description AS text, module, user_name AS "by", 'activity' AS icon
         FROM audit_logs WHERE action NOT IN ('view', 'login', 'logout', 'login_failed')
       UNION ALL
       SELECT g.occurred_at, s.full_name || ' ' || CASE g.direction WHEN 'in' THEN 'entered' ELSE 'left' END || ' — ' || g.gate || ' (' || g.method || ')',
              'safety', 'Smart Gate', 'door'
         FROM gate_events g JOIN students s ON s.id = g.student_id
        WHERE g.occurred_at >= current_date - 1 AND ($1::uuid IS NULL OR g.campus_id = $1)
     ) x ORDER BY at DESC LIMIT 12`, [c]); };

  // Independent blocks run side by side: one database round trip of wall time instead of a dozen.
  await Promise.all([history(), admissions(), finance(), earlyWarning(), engagement(), academic(), pending(), tracking(), operations(), activity()]);

  const attention: any[] = [];
  const ew = out.earlyWarning as any;
  if (ew?.open) attention.push({ tone: 'critical', icon: 'userCheck', title: `${ew.open} students have open Early Warning signals`, meta: `${ew.awaitingReview} awaiting teacher review · ${ew.inIntervention} in intervention`, route: '/early-warning', count: ew.open });
  if (attendanceToday && attendanceToday.total - attendanceToday.marked > 0) attention.push({ tone: 'warning', icon: 'checkSquare', title: `${attendanceToday.total - attendanceToday.marked} students not yet marked today`, meta: `${attendanceToday.absent} absent · ${attendanceToday.late} late so far`, route: '/attendance', count: attendanceToday.total - attendanceToday.marked });
  if (busDelays.length) attention.push({ tone: 'warning', icon: 'bus', title: `${busDelays.length} bus route${busDelays.length > 1 ? 's' : ''} running late`, meta: busDelays.map((b) => `${b.name} +${b.delay} min`).join(' · '), route: '/bus-tracking', count: busDelays.length });
  const adm = out.admissions as any;
  if (adm && (adm.overdueFollowUps || adm.unassigned)) attention.push({ tone: 'warning', icon: 'users', title: `${adm.overdueFollowUps} admissions follow-ups overdue`, meta: `${adm.unassigned} lead(s) without a counsellor`, route: '/admissions', count: adm.overdueFollowUps + adm.unassigned });
  if (staff && staff.absent + staff.onLeave > 0) attention.push({ tone: 'caution', icon: 'briefcase', title: `${staff.absent + staff.onLeave} staff absent or on leave today`, meta: `${staff.absent} absent · ${staff.onLeave} on leave`, route: '/staff-attendance', count: staff.absent + staff.onLeave });
  if ((out.approvals as any).total) attention.push({ tone: 'caution', icon: 'checkSquare', title: `${(out.approvals as any).total} approvals waiting`, meta: `${approvals.leave} leave · ${approvals.expenses} expenses · ${approvals.certificates} certificates · ${approvals.overtime} overtime`, route: '/my-tasks', count: (out.approvals as any).total });
  if (compliance?.overdue) attention.push({ tone: 'critical', icon: 'shield', title: `${compliance.overdue} compliance item(s) overdue`, meta: compliance.firstOverdue ?? '', route: '/compliance', count: compliance.overdue });
  const pe = out.parentEngagement as any;
  if (pe?.unanswered) attention.push({ tone: 'info', icon: 'message', title: `${pe.unanswered} parent queries unanswered`, meta: 'Parent Communication', route: '/parent-communication', count: pe.unanswered });
  out.attention = attention;
  out.compliance = compliance;

  return out;
}
