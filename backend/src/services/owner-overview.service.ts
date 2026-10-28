import { many, one } from '../config/db.js';
import type { AuthUser } from '../types.js';
import { BAL, NET } from './finance-fees.service.js';
import { schoolToday } from './academics.service.js';

/**
 * Owner Overview — the Super Admin's landing page.
 *
 * Answers "is the school healthy, and what needs me?" rather than "what is
 * happening right now" (that is the Principal's Command Center). Three blocks:
 *
 *   welcome   when the owner last signed in, and how much has changed since
 *   revenue   money in, money out and what is still owed, this academic year
 *   activity  who did what since the last visit, and what awaits approval
 *   school    standards, discipline, strategic goals, final approvals,
 *             critical exceptions and governance for the selected campus
 *
 * Every figure is computed live. The revenue and activity blocks are returned
 * only when the caller holds finance.read / audit.read, so the page degrades
 * cleanly for roles that may open it without full rights.
 */

const YEAR_START = `(SELECT starts_on FROM academic_years WHERE is_current)`;
const YEAR_ID = `(SELECT id FROM academic_years WHERE is_current)`;

/** Actions that change data. `view`, `login` and `logout` are noise on this page. */
const CHANGE_ACTIONS = `a.action NOT IN ('view', 'login', 'logout')`;

/**
 * Changes an owner would want to see named individually: anything destructive,
 * any approval or rejection, anything touching accounts or settings, and every
 * failed authentication attempt.
 */
const IMPORTANT = `(a.action IN ('delete', 'approve', 'reject', 'broadcast', 'export')
                    OR a.module IN ('users', 'settings')
                    OR a.action LIKE '%\\_failed')`;

export interface PreviousVisit {
  at: string | null;
  device: string | null;
  ip: string | null;
  /** True when this is the first recorded sign-in, so "since" is a 7-day window. */
  firstVisit: boolean;
}

export async function ownerOverview(user: AuthUser, campusId: string | null) {
  const previous = await one<{ at: string; device: string | null; ip: string | null }>(
    `SELECT a.created_at AS at, a.device, host(a.ip_address) AS ip
       FROM audit_logs a
      WHERE a.user_id = $1 AND a.action = 'login'
      ORDER BY a.created_at DESC, a.id DESC
      OFFSET 1 LIMIT 1`,
    [user.id],
  );

  // The current session's own login row sits at OFFSET 0, so OFFSET 1 is the
  // previous visit. On a first-ever sign-in there is none; fall back to a week.
  const visit: PreviousVisit = {
    at: previous?.at ?? null,
    device: previous?.device ?? null,
    ip: previous?.ip ?? null,
    firstVisit: !previous,
  };
  const since = previous?.at ?? null;

  const [welcome, revenue, activity, school] = await Promise.all([
    welcomeBlock(since),
    user.permissions.has('finance.read') ? revenueBlock(campusId) : Promise.resolve(null),
    user.permissions.has('audit.read') ? activityBlock(since, campusId) : Promise.resolve(null),
    user.permissions.has('audit.read') ? schoolBlock(campusId) : Promise.resolve(null),
  ]);

  return { previousVisit: visit, welcome, revenue, activity, school };
}

// ---------------------------------------------------------------------------
// Welcome — volume of change since the last visit
// ---------------------------------------------------------------------------
async function welcomeBlock(since: string | null) {
  const row = await one<{ changes: number; people: number; important: number }>(
    `SELECT count(*)::int AS changes,
            count(DISTINCT a.user_id)::int AS people,
            count(*) FILTER (WHERE ${IMPORTANT})::int AS important
       FROM audit_logs a
      WHERE a.created_at > COALESCE($1::timestamptz, now() - interval '7 days')
        AND ${CHANGE_ACTIONS}`,
    [since],
  );
  return row ?? { changes: 0, people: 0, important: 0 };
}

// ---------------------------------------------------------------------------
// Revenue — this academic year to date
// ---------------------------------------------------------------------------
async function revenueBlock(campusId: string | null) {
  const c = campusId;

  const [fees, collection, spend, payroll, pending, detail] = await Promise.all([
    // Charges raised on families this year: billed, collected, written down, still owed.
    one<Record<string, number>>(
      `SELECT COALESCE(sum(${NET()}), 0)::float               AS billed,
              COALESCE(sum(f.amount_paid), 0)::float          AS collected,
              COALESCE(sum(f.concession_amount), 0)::float    AS concessions,
              COALESCE(sum(${BAL()}), 0)::float               AS outstanding,
              COALESCE(sum(${BAL()}) FILTER (WHERE f.due_date >= current_date), 0)::float AS "notYetDue",
              COALESCE(sum(${BAL()}) FILTER (WHERE f.due_date < current_date
                        AND f.due_date >= current_date - 30), 0)::float AS "due0to30",
              COALESCE(sum(${BAL()}) FILTER (WHERE f.due_date < current_date - 30
                        AND f.due_date >= current_date - 60), 0)::float AS "due31to60",
              COALESCE(sum(${BAL()}) FILTER (WHERE f.due_date < current_date - 60), 0)::float AS "due60plus",
              count(DISTINCT f.student_id) FILTER (
                WHERE ${BAL()} > 0 AND f.due_date < current_date)::int AS "familiesOverdue"
         FROM student_fees f JOIN students s ON s.id = f.student_id
        WHERE f.academic_year_id = ${YEAR_ID}
          AND s.deleted_at IS NULL
          AND ($1::uuid IS NULL OR s.campus_id = $1)`,
      [c],
    ),
    // Receipts, so the owner can see whether collection is speeding up or slowing.
    one<Record<string, number>>(
      `SELECT COALESCE(sum(p.amount) FILTER (
                WHERE p.paid_at >= date_trunc('month', current_date)), 0)::float AS "thisMonth",
              COALESCE(sum(p.amount) FILTER (
                WHERE p.paid_at >= date_trunc('month', current_date) - interval '1 month'
                  AND p.paid_at <  date_trunc('month', current_date)), 0)::float AS "lastMonth",
              COALESCE(sum(p.amount) FILTER (WHERE p.paid_at >= current_date - 30), 0)::float AS "last30",
              count(*) FILTER (WHERE p.paid_at >= current_date - 30)::int AS "receipts30"
         FROM fee_payments p JOIN students s ON s.id = p.student_id
        WHERE p.status = 'Success'
          AND s.deleted_at IS NULL
          AND ($1::uuid IS NULL OR s.campus_id = $1)`,
      [c],
    ),
    // Expenses booked against this academic year.
    one<Record<string, number>>(
      `SELECT COALESCE(sum(e.amount) FILTER (WHERE e.status IN ('Approved', 'Paid')), 0)::float AS spent,
              COALESCE(sum(e.amount) FILTER (WHERE e.status IN ('Submitted', 'Under Review')), 0)::float AS awaiting,
              count(*) FILTER (WHERE e.status IN ('Submitted', 'Under Review'))::int AS "awaitingCount"
         FROM expenses e
        WHERE e.expense_date >= ${YEAR_START}
          AND ($1::uuid IS NULL OR e.campus_id = $1)`,
      [c],
    ),
    // Salary cost for the year so far. A group-level run has no campus, so a
    // campus filter reports only that campus's own runs.
    one<{ payroll: number; months: number }>(
      `SELECT COALESCE(sum(r.net_total), 0)::float AS payroll,
              count(DISTINCT r.pay_month)::int     AS months
         FROM payroll_runs r
        WHERE r.status IN ('Approved', 'Released', 'Paid')
          AND r.pay_month >= ${YEAR_START}
          AND ($1::uuid IS NULL OR r.campus_id = $1)`,
      [c],
    ),
    // Concessions still waiting on a decision — money the school may give up.
    one<{ count: number; amount: number }>(
      `SELECT count(*)::int AS count, COALESCE(sum(co.amount), 0)::float AS amount
         FROM concessions co JOIN students s ON s.id = co.student_id
        WHERE co.status IN ('Submitted', 'Under Review')
          AND co.academic_year_id = ${YEAR_ID}
          AND ($1::uuid IS NULL OR s.campus_id = $1)`,
      [c],
    ),
    revenueDetail(c),
  ]);

  const moneyOut = (spend?.spent ?? 0) + (payroll?.payroll ?? 0);

  return {
    billed: fees!.billed,
    collected: fees!.collected,
    collectedPct: fees!.billed > 0 ? Math.round((fees!.collected / fees!.billed) * 1000) / 10 : null,
    concessions: fees!.concessions,
    outstanding: fees!.outstanding,
    aged: {
      notYetDue: fees!.notYetDue,
      due0to30: fees!.due0to30,
      due31to60: fees!.due31to60,
      due60plus: fees!.due60plus,
      familiesOverdue: fees!.familiesOverdue,
    },
    collection: {
      thisMonth: collection!.thisMonth,
      lastMonth: collection!.lastMonth,
      changePct: collection!.lastMonth > 0
        ? Math.round(((collection!.thisMonth - collection!.lastMonth) / collection!.lastMonth) * 1000) / 10
        : null,
      last30: collection!.last30,
      receipts30: collection!.receipts30,
    },
    out: {
      expenses: spend!.spent,
      payroll: payroll!.payroll,
      payrollMonths: payroll!.months,
      total: moneyOut,
    },
    net: fees!.collected - moneyOut,
    pending: {
      expenses: { count: spend!.awaitingCount, amount: spend!.awaiting },
      concessions: { count: pending!.count, amount: pending!.amount },
    },
    ...detail,
  };
}

/**
 * The drill-down behind the headline figures: how money moved month by month,
 * which families owe the most, and where the balance sits by class, fee head
 * and (for a group view) campus.
 */
async function revenueDetail(c: string | null) {
  const [trend, topOwing, byClass, byHead, byCampus] = await Promise.all([
    // One row per month from the start of the academic year to this month.
    many<{ month: string; label: string; collected: number; payroll: number; expenses: number }>(
      `WITH months AS (
         SELECT generate_series(date_trunc('month', ${YEAR_START}), date_trunc('month', current_date), interval '1 month')::date AS m
       )
       SELECT to_char(m.m, 'YYYY-MM') AS month, to_char(m.m, 'Mon') AS label,
              COALESCE((SELECT sum(p.amount) FROM fee_payments p JOIN students s ON s.id = p.student_id
                         WHERE p.status = 'Success' AND s.deleted_at IS NULL
                           AND ($1::uuid IS NULL OR s.campus_id = $1)
                           AND date_trunc('month', p.paid_at)::date = m.m), 0)::float AS collected,
              COALESCE((SELECT sum(r.net_total) FROM payroll_runs r
                         WHERE r.status IN ('Approved', 'Released', 'Paid')
                           AND ($1::uuid IS NULL OR r.campus_id = $1)
                           AND date_trunc('month', r.pay_month)::date = m.m), 0)::float AS payroll,
              COALESCE((SELECT sum(e.amount) FROM expenses e
                         WHERE e.status IN ('Approved', 'Paid')
                           AND ($1::uuid IS NULL OR e.campus_id = $1)
                           AND date_trunc('month', e.expense_date)::date = m.m), 0)::float AS expenses
         FROM months m ORDER BY m.m`,
      [c],
    ),
    // Families furthest behind: overdue balance, how long, and where to chase.
    many<{ studentId: string; name: string; admissionNo: string; className: string | null; campus: string;
           overdue: number; charges: number; oldestDue: string; daysOverdue: number }>(
      `SELECT s.id AS "studentId", s.full_name AS name, s.admission_no AS "admissionNo",
              CASE WHEN cl.id IS NULL THEN NULL ELSE cl.name || COALESCE(' ' || sec.name, '') END AS "className",
              ca.short_name AS campus,
              sum(${BAL()})::float AS overdue,
              count(*)::int AS charges,
              min(f.due_date)::text AS "oldestDue",
              (current_date - min(f.due_date))::int AS "daysOverdue"
         FROM student_fees f
         JOIN students s ON s.id = f.student_id
         JOIN campuses ca ON ca.id = s.campus_id
         LEFT JOIN sections sec ON sec.id = s.section_id
         LEFT JOIN classes cl ON cl.id = sec.class_id
        WHERE f.academic_year_id = ${YEAR_ID}
          AND s.deleted_at IS NULL
          AND ${BAL()} > 0 AND f.due_date < current_date
          AND ($1::uuid IS NULL OR s.campus_id = $1)
        GROUP BY s.id, s.full_name, s.admission_no, cl.id, cl.name, sec.name, ca.short_name
        ORDER BY overdue DESC, "daysOverdue" DESC
        LIMIT 8`,
      [c],
    ),
    // Where the unpaid balance sits by class. Grade names repeat across
    // campuses, so classes are grouped by grade level.
    many<{ grade: string; students: number; outstanding: number; overdue: number }>(
      `SELECT COALESCE(min(cl.name), 'No class') AS grade,
              count(DISTINCT s.id) FILTER (WHERE ${BAL()} > 0)::int AS students,
              COALESCE(sum(${BAL()}), 0)::float AS outstanding,
              COALESCE(sum(${BAL()}) FILTER (WHERE f.due_date < current_date), 0)::float AS overdue
         FROM student_fees f
         JOIN students s ON s.id = f.student_id
         LEFT JOIN sections sec ON sec.id = s.section_id
         LEFT JOIN classes cl ON cl.id = sec.class_id
        WHERE f.academic_year_id = ${YEAR_ID}
          AND s.deleted_at IS NULL
          AND ($1::uuid IS NULL OR s.campus_id = $1)
        GROUP BY cl.grade_level
        HAVING sum(${BAL()}) > 0
        ORDER BY cl.grade_level NULLS LAST`,
      [c],
    ),
    // Billed, collected, waived and owed for each fee head.
    many<{ head: string; billed: number; collected: number; concessions: number; outstanding: number }>(
      `SELECT h.name AS head,
              COALESCE(sum(${NET()}), 0)::float            AS billed,
              COALESCE(sum(f.amount_paid), 0)::float       AS collected,
              COALESCE(sum(f.concession_amount), 0)::float AS concessions,
              COALESCE(sum(${BAL()}), 0)::float            AS outstanding
         FROM student_fees f
         JOIN fee_heads h ON h.id = f.fee_head_id
         JOIN students s ON s.id = f.student_id
        WHERE f.academic_year_id = ${YEAR_ID}
          AND s.deleted_at IS NULL
          AND ($1::uuid IS NULL OR s.campus_id = $1)
        GROUP BY h.id, h.name
        ORDER BY billed DESC`,
      [c],
    ),
    // Only meaningful across campuses; a single-campus view skips it.
    c ? Promise.resolve([]) : many<{ campus: string; billed: number; collected: number; outstanding: number; spent: number }>(
      `SELECT ca.short_name AS campus,
              COALESCE(fe.billed, 0)::float      AS billed,
              COALESCE(fe.collected, 0)::float   AS collected,
              COALESCE(fe.outstanding, 0)::float AS outstanding,
              (COALESCE(ex.spent, 0) + COALESCE(pr.paid, 0))::float AS spent
         FROM campuses ca
         LEFT JOIN (
           SELECT s.campus_id, sum(${NET()}) AS billed, sum(f.amount_paid) AS collected, sum(${BAL()}) AS outstanding
             FROM student_fees f JOIN students s ON s.id = f.student_id
            WHERE f.academic_year_id = ${YEAR_ID} AND s.deleted_at IS NULL
            GROUP BY s.campus_id
         ) fe ON fe.campus_id = ca.id
         LEFT JOIN (
           SELECT campus_id, sum(amount) AS spent FROM expenses
            WHERE status IN ('Approved', 'Paid') AND expense_date >= ${YEAR_START}
            GROUP BY campus_id
         ) ex ON ex.campus_id = ca.id
         LEFT JOIN (
           SELECT campus_id, sum(net_total) AS paid FROM payroll_runs
            WHERE status IN ('Approved', 'Released', 'Paid') AND pay_month >= ${YEAR_START}
            GROUP BY campus_id
         ) pr ON pr.campus_id = ca.id
        WHERE ca.is_active
        ORDER BY ca.established`,
      [],
    ),
  ]);

  return { trend, topOwing, byClass, byHead, byCampus };
}

// ---------------------------------------------------------------------------
// Management activity — since the previous visit
// ---------------------------------------------------------------------------
async function activityBlock(since: string | null, campusId: string | null) {
  const from = since;

  const [byModule, byPerson, important, approvals] = await Promise.all([
    // Per area: how many changes, of what kind, and who made most of them.
    many<{ module: string; count: number; actions: { action: string; count: number }[]; topPerson: string | null; topCount: number }>(
      `WITH recent AS (
         SELECT a.module, a.action, a.user_name
           FROM audit_logs a
          WHERE a.created_at > COALESCE($1::timestamptz, now() - interval '7 days')
            AND ${CHANGE_ACTIONS}
       ), mods AS (
         SELECT module, count(*)::int AS count FROM recent
          GROUP BY module ORDER BY count DESC, module LIMIT 8
       )
       SELECT m.module, m.count,
              (SELECT COALESCE(json_agg(json_build_object('action', x.action, 'count', x.n) ORDER BY x.n DESC), '[]'::json)
                 FROM (SELECT action, count(*)::int AS n FROM recent r WHERE r.module = m.module
                        GROUP BY action ORDER BY n DESC LIMIT 4) x) AS actions,
              tp.user_name AS "topPerson", COALESCE(tp.n, 0)::int AS "topCount"
         FROM mods m
         LEFT JOIN LATERAL (
           SELECT user_name, count(*)::int AS n FROM recent r
            WHERE r.module = m.module AND r.user_name IS NOT NULL
            GROUP BY user_name ORDER BY n DESC, user_name LIMIT 1
         ) tp ON true
        ORDER BY m.count DESC, m.module`,
      [from],
    ),
    // Per person: volume, the areas they worked in, and when they were last active.
    many<{ name: string; role: string; count: number; lastAt: string; modules: { module: string; count: number }[] }>(
      `WITH recent AS (
         SELECT a.user_id, a.user_name, a.role_key, a.module, a.created_at
           FROM audit_logs a
          WHERE a.created_at > COALESCE($1::timestamptz, now() - interval '7 days')
            AND ${CHANGE_ACTIONS} AND a.user_id IS NOT NULL
       ), people AS (
         SELECT user_id, user_name, role_key, count(*)::int AS count, max(created_at) AS last_at
           FROM recent GROUP BY user_id, user_name, role_key
          ORDER BY count DESC, user_name LIMIT 6
       )
       SELECT p.user_name AS name, p.role_key AS role, p.count, p.last_at AS "lastAt",
              (SELECT COALESCE(json_agg(json_build_object('module', x.module, 'count', x.n) ORDER BY x.n DESC), '[]'::json)
                 FROM (SELECT module, count(*)::int AS n FROM recent r WHERE r.user_id = p.user_id
                        GROUP BY module ORDER BY n DESC LIMIT 3) x) AS modules
         FROM people p
        ORDER BY p.count DESC, p.user_name`,
      [from],
    ),
    many(
      `SELECT a.id::text AS id, a.created_at AS at, a.user_name AS "userName", a.role_key AS role,
              a.action, a.module, a.description, a.entity_type AS "entityType", a.entity_id AS "entityId",
              a.device, host(a.ip_address) AS ip, a.metadata
         FROM audit_logs a
        WHERE a.created_at > COALESCE($1::timestamptz, now() - interval '7 days')
          AND ${CHANGE_ACTIONS} AND ${IMPORTANT}
        ORDER BY a.created_at DESC, a.id DESC LIMIT 12`,
      [from],
    ),
    approvalsWaiting(campusId),
  ]);

  return { byModule, byPerson, important, approvals };
}

interface Waiting { count: number; total: number; oldest: string | null }

/**
 * Items sitting in a review state that an owner or administrator clears, with
 * the sum at stake (rupees, or days for leave) and how long the oldest has waited.
 */
async function approvalsWaiting(campusId: string | null) {
  const c = campusId;
  const AGG = (amount: string, a = '') =>
    `count(*)::int AS count, COALESCE(sum(${amount}), 0)::float AS total, min(${a}created_at) AS oldest`;
  const [expenses, concessions, reimbursements, payroll, leave] = await Promise.all([
    one<Waiting>(
      `SELECT ${AGG('amount')} FROM expenses
        WHERE status IN ('Submitted', 'Under Review') AND ($1::uuid IS NULL OR campus_id = $1)`, [c]),
    one<Waiting>(
      `SELECT ${AGG('co.amount', 'co.')} FROM concessions co JOIN students s ON s.id = co.student_id
        WHERE co.status IN ('Submitted', 'Under Review') AND ($1::uuid IS NULL OR s.campus_id = $1)`, [c]),
    one<Waiting>(
      `SELECT ${AGG('rb.amount', 'rb.')} FROM reimbursements rb JOIN employees emp ON emp.id = rb.employee_id
        WHERE rb.status IN ('Submitted', 'Under Review') AND ($1::uuid IS NULL OR emp.campus_id = $1)`, [c]),
    one<Waiting>(
      `SELECT ${AGG('net_total')} FROM payroll_runs
        WHERE status IN ('Calculated', 'Under Review') AND ($1::uuid IS NULL OR campus_id = $1)`, [c]),
    one<Waiting>(
      `SELECT ${AGG('lr.days', 'lr.')} FROM leave_requests lr JOIN employees emp ON emp.id = lr.employee_id
        WHERE lr.status IN ('Submitted', 'Under Review') AND ($1::uuid IS NULL OR emp.campus_id = $1)`, [c]),
  ]);

  const row = (label: string, w: Waiting | null, to: string, icon: string, unit: 'money' | 'days') => ({
    label, to, icon, unit, count: w?.count ?? 0, total: w?.total ?? 0, oldest: w?.oldest ?? null,
  });
  return [
    row('Expense claims', expenses, '/expenses', 'receipt', 'money'),
    row('Fee concessions', concessions, '/concessions', 'percent', 'money'),
    row('Reimbursements', reimbursements, '/reimbursements', 'wallet', 'money'),
    row('Payroll runs', payroll, '/payroll', 'briefcase', 'money'),
    row('Leave requests', leave, '/leave', 'calendar', 'days'),
  ].filter((x) => x.count > 0);
}

// ---------------------------------------------------------------------------
// School — the per-campus owner view: standards, discipline, strategic goals,
// final approvals, critical exceptions and governance
// ---------------------------------------------------------------------------
async function schoolBlock(campusId: string | null) {
  const c = campusId;
  const [standards, discipline, goals, approvals, exceptions, governance] = await Promise.all([
    standardsBlock(c), disciplineBlock(c), goalsBlock(c), finalApprovals(c), criticalExceptions(c), governanceBlock(c),
  ]);
  return { standards, discipline, goals, approvals, exceptions, governance };
}

/** Results this year, syllabus coverage and attendance over the last 30 days. */
async function standardsBlock(c: string | null) {
  const [results, syllabus, attendance] = await Promise.all([
    one<{ avgScore: number | null; assessments: number; belowPass: number; students: number }>(
      `SELECT round(avg(m.marks / a.max_marks * 100)::numeric, 1)::float AS "avgScore",
              count(DISTINCT a.id)::int AS assessments,
              count(DISTINCT m.student_id) FILTER (WHERE m.marks / a.max_marks < 0.35)::int AS "belowPass",
              count(DISTINCT m.student_id)::int AS students
         FROM assessment_marks m
         JOIN assessments a ON a.id = m.assessment_id
         JOIN students s ON s.id = m.student_id
        WHERE a.academic_year_id = ${YEAR_ID}
          AND NOT m.is_absent AND m.marks IS NOT NULL
          AND s.deleted_at IS NULL
          AND ($1::uuid IS NULL OR s.campus_id = $1)`,
      [c],
    ),
    // Learning objectives belong to the curriculum, not to a campus.
    one<{ coverage: number | null; mastery: number | null }>(
      `SELECT round(avg(coverage_pct))::int AS coverage, round(avg(mastery_pct))::int AS mastery
         FROM learning_objectives`,
      [],
    ),
    one<{ pct: number | null }>(
      `SELECT round(100.0 * count(*) FILTER (WHERE r.status IN ('present', 'late')) / NULLIF(count(*), 0), 1)::float AS pct
         FROM attendance_records r JOIN students s ON s.id = r.student_id
        WHERE r.attendance_date >= current_date - 30
          AND s.deleted_at IS NULL
          AND ($1::uuid IS NULL OR s.campus_id = $1)`,
      [c],
    ),
  ]);
  return {
    avgScore: results?.avgScore ?? null,
    assessments: results?.assessments ?? 0,
    belowPass: results?.belowPass ?? 0,
    assessed: results?.students ?? 0,
    syllabus: syllabus?.coverage ?? null,
    mastery: syllabus?.mastery ?? null,
    attendance: attendance?.pct ?? null,
  };
}

/** Open safety incidents, and behaviour recorded over the last 30 days. */
async function disciplineBlock(c: string | null) {
  const [incidents, behaviour] = await Promise.all([
    one<{ open: number; critical: number; escalated: number; month: number }>(
      `SELECT count(*) FILTER (WHERE status <> 'Closed')::int AS open,
              count(*) FILTER (WHERE status <> 'Closed' AND severity = 'Critical')::int AS critical,
              count(*) FILTER (WHERE status = 'Escalated')::int AS escalated,
              count(*) FILTER (WHERE occurred_on >= current_date - 30)::int AS month
         FROM incidents
        WHERE ($1::uuid IS NULL OR campus_id = $1)`,
      [c],
    ),
    one<{ concerns: number; positive: number }>(
      `SELECT count(*) FILTER (WHERE b.record_type IN ('Concern', 'Incident'))::int AS concerns,
              count(*) FILTER (WHERE b.record_type = 'Positive')::int AS positive
         FROM behaviour_records b JOIN students s ON s.id = b.student_id
        WHERE b.recorded_on >= current_date - 30
          AND s.deleted_at IS NULL
          AND ($1::uuid IS NULL OR s.campus_id = $1)`,
      [c],
    ),
  ]);
  return {
    openIncidents: incidents?.open ?? 0,
    critical: incidents?.critical ?? 0,
    escalated: incidents?.escalated ?? 0,
    incidents30: incidents?.month ?? 0,
    concerns30: behaviour?.concerns ?? 0,
    positive30: behaviour?.positive ?? 0,
  };
}

/**
 * Strategic goals: institutional targets as percentages, task progress by
 * department, who holds the overdue work, and the projects that are stuck.
 * Tasks have no campus of their own; a campus view counts the tasks assigned
 * to people of that campus.
 */
async function goalsBlock(c: string | null) {
  const [targets, departments, staff, blockers] = await Promise.all([
    one<{ fees: number | null; attendance: number | null; syllabus: number | null; compliance: number | null; tasks: number | null }>(
      `SELECT
         (SELECT round(100.0 * sum(f.amount_paid) / NULLIF(sum(${NET()}), 0))::int
            FROM student_fees f JOIN students s ON s.id = f.student_id
           WHERE f.academic_year_id = ${YEAR_ID} AND s.deleted_at IS NULL
             AND ($1::uuid IS NULL OR s.campus_id = $1)) AS fees,
         (SELECT round(100.0 * count(*) FILTER (WHERE r.status IN ('present', 'late')) / NULLIF(count(*), 0))::int
            FROM attendance_records r JOIN students s ON s.id = r.student_id
           WHERE r.attendance_date >= current_date - 30 AND s.deleted_at IS NULL
             AND ($1::uuid IS NULL OR s.campus_id = $1)) AS attendance,
         (SELECT round(avg(coverage_pct))::int FROM learning_objectives) AS syllabus,
         (SELECT round(100.0 * count(*) FILTER (WHERE status = 'Completed') / NULLIF(count(*), 0))::int
            FROM compliance_items WHERE ($1::uuid IS NULL OR campus_id = $1)) AS compliance,
         (SELECT round(100.0 * count(*) FILTER (WHERE t.status = 'Completed') / NULLIF(count(*), 0))::int
            FROM tasks t LEFT JOIN users u ON u.id = t.assignee_user_id
           WHERE t.status <> 'Cancelled' AND ($1::uuid IS NULL OR u.campus_id = $1)) AS tasks`,
      [c],
    ),
    many<{ module: string; total: number; done: number; overdue: number }>(
      `SELECT t.module, count(*)::int AS total,
              count(*) FILTER (WHERE t.status = 'Completed')::int AS done,
              count(*) FILTER (WHERE t.status IN ('Pending', 'Under Review') AND t.due_on < current_date)::int AS overdue
         FROM tasks t LEFT JOIN users u ON u.id = t.assignee_user_id
        WHERE t.status <> 'Cancelled' AND ($1::uuid IS NULL OR u.campus_id = $1)
        GROUP BY t.module
        ORDER BY overdue DESC, total DESC
        LIMIT 6`,
      [c],
    ),
    many<{ name: string; role: string; open: number; overdue: number; oldestDue: string | null }>(
      `SELECT u.full_name AS name, r.name AS role,
              count(*)::int AS open,
              count(*) FILTER (WHERE t.due_on < current_date)::int AS overdue,
              (min(t.due_on) FILTER (WHERE t.due_on < current_date))::text AS "oldestDue"
         FROM tasks t JOIN users u ON u.id = t.assignee_user_id JOIN roles r ON r.id = u.role_id
        WHERE t.status IN ('Pending', 'Under Review') AND ($1::uuid IS NULL OR u.campus_id = $1)
        GROUP BY u.id, u.full_name, r.name
        HAVING count(*) FILTER (WHERE t.due_on < current_date) > 0
        ORDER BY overdue DESC, open DESC
        LIMIT 5`,
      [c],
    ),
    many<{ kind: string; title: string; meta: string; daysLate: number; to: string }>(
      `SELECT * FROM (
         SELECT 'Project' AS kind, p.title || ' — ' || m.title AS title,
                'Milestone due ' || to_char(m.due_on, 'DD Mon') AS meta,
                (current_date - m.due_on)::int AS "daysLate", '/projects/' || p.id AS to
           FROM innovation_milestones m
           JOIN innovation_projects p ON p.id = m.project_id
           JOIN students s ON s.id = p.lead_student_id
          WHERE m.completed_on IS NULL AND m.due_on < current_date
            AND ($1::uuid IS NULL OR s.campus_id = $1)
         UNION ALL
         SELECT 'Compliance', ci.item, ci.authority || ' · ' || ci.owner_name,
                (current_date - ci.due_on)::int, '/compliance'
           FROM compliance_items ci
          WHERE ci.status <> 'Completed' AND ci.due_on < current_date
            AND ($1::uuid IS NULL OR ci.campus_id = $1)
       ) x
       ORDER BY "daysLate" DESC
       LIMIT 5`,
      [c],
    ),
  ]);

  const list = [
    { label: 'Fee collection', pct: targets?.fees ?? null, to: '/student-accounts' },
    { label: 'Attendance (30 days)', pct: targets?.attendance ?? null, to: '/attendance' },
    { label: 'Syllabus coverage', pct: targets?.syllabus ?? null, to: '/curriculum' },
    { label: 'Compliance completed', pct: targets?.compliance ?? null, to: '/compliance' },
    { label: 'Tasks closed', pct: targets?.tasks ?? null, to: '/my-tasks' },
  ];
  const known = list.filter((t) => t.pct != null);
  const overall = known.length ? Math.round(known.reduce((s, t) => s + (t.pct ?? 0), 0) / known.length) : null;
  return { overall, targets: list, departments, staff, blockers };
}

/** Days allowed for a decision once an item is raised. Payroll and leave are tighter, below. */
const DECISION_DAYS = 7;

/**
 * Individual items awaiting a final decision: who raised them, the sum at
 * stake, how long they have waited and when a decision is due.
 */
async function finalApprovals(c: string | null) {
  const rows = await many<{
    id: string; kind: string; title: string; requestor: string | null; amount: number | null; days: number | null;
    raisedAt: string; deadline: string; to: string;
  }>(
    `SELECT * FROM (
       SELECT e.id::text AS id, 'Expense' AS kind, e.code || ' · ' || e.description AS title,
              COALESCE(emp.full_name, cu.full_name) AS requestor, e.amount::float AS amount, NULL::float AS days,
              e.created_at AS "raisedAt", (e.created_at::date + ${DECISION_DAYS})::text AS deadline, '/expenses' AS to
         FROM expenses e
         LEFT JOIN employees emp ON emp.id = e.submitted_by
         LEFT JOIN users cu ON cu.id = e.created_by
        WHERE e.status IN ('Submitted', 'Under Review') AND ($1::uuid IS NULL OR e.campus_id = $1)
       UNION ALL
       SELECT co.id::text, 'Concession', co.concession_type || ' · ' || s.full_name,
              cu.full_name, co.amount::float, NULL,
              co.created_at, (co.created_at::date + ${DECISION_DAYS})::text, '/concessions'
         FROM concessions co
         JOIN students s ON s.id = co.student_id
         LEFT JOIN users cu ON cu.id = co.created_by
        WHERE co.status IN ('Submitted', 'Under Review') AND ($1::uuid IS NULL OR s.campus_id = $1)
       UNION ALL
       SELECT rb.id::text, 'Reimbursement', rb.code || ' · ' || rb.claim_type,
              emp.full_name, rb.amount::float, NULL,
              rb.created_at, (rb.created_at::date + ${DECISION_DAYS})::text, '/reimbursements'
         FROM reimbursements rb JOIN employees emp ON emp.id = rb.employee_id
        WHERE rb.status IN ('Submitted', 'Under Review') AND ($1::uuid IS NULL OR emp.campus_id = $1)
       UNION ALL
       -- Salaries must go out on time: three days to decide.
       SELECT pr.id::text, 'Payroll', 'Payroll ' || to_char(pr.pay_month, 'Mon YYYY') || COALESCE(' · ' || ca.short_name, ''),
              cu.full_name, pr.net_total::float, NULL,
              pr.created_at, (pr.created_at::date + 3)::text, '/payroll'
         FROM payroll_runs pr
         LEFT JOIN campuses ca ON ca.id = pr.campus_id
         LEFT JOIN users cu ON cu.id = pr.created_by
        WHERE pr.status IN ('Calculated', 'Under Review') AND ($1::uuid IS NULL OR pr.campus_id = $1)
       UNION ALL
       -- Leave has to be decided before it starts.
       SELECT lr.id::text, 'Leave', lt.name || ' · from ' || to_char(lr.from_date, 'DD Mon'),
              emp.full_name, NULL, lr.days::float,
              lr.created_at, LEAST(lr.from_date - 1, lr.created_at::date + ${DECISION_DAYS})::text, '/leave'
         FROM leave_requests lr
         JOIN employees emp ON emp.id = lr.employee_id
         JOIN leave_types lt ON lt.id = lr.leave_type_id
        WHERE lr.status IN ('Submitted', 'Under Review') AND ($1::uuid IS NULL OR emp.campus_id = $1)
     ) x
     ORDER BY deadline, "raisedAt"`,
    [c],
  );

  // Past its deadline, payroll, or a large sum is High; due within two days or a mid-sized sum is Medium.
  // School dates (Asia/Kolkata), like the deadlines; a UTC date lags by a day before 05:30 IST.
  const today = schoolToday();
  const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
  const rank = { High: 0, Medium: 1, Low: 2 } as const;
  const items = rows.map((r) => {
    const priority: keyof typeof rank =
      r.deadline < today || r.kind === 'Payroll' || (r.amount ?? 0) >= 100_000 ? 'High'
        : r.deadline <= soon || (r.amount ?? 0) >= 25_000 ? 'Medium' : 'Low';
    return { ...r, priority };
  }).sort((a, b) => rank[a.priority] - rank[b.priority] || a.deadline.localeCompare(b.deadline));

  return {
    total: items.length,
    overdue: items.filter((i) => i.deadline < today).length,
    amount: items.reduce((s, i) => s + (i.amount ?? 0), 0),
    items: items.slice(0, 8),
  };
}

/** Exceptions an owner should know about: academic delays, safety, overdue work and money at risk. */
async function criticalExceptions(c: string | null) {
  const row = await one<{
    marksLate: number; plansWaiting: number; safetyOpen: number; tasksOverdue: number; tasksHigh: number;
    fees60: number; families60: number; overBudget: number;
  }>(
    `SELECT
       (SELECT count(*) FROM assessments a JOIN classes cl ON cl.id = a.class_id
         WHERE a.academic_year_id = ${YEAR_ID} AND a.status <> 'Completed' AND a.held_on < current_date - 7
           AND ($1::uuid IS NULL OR cl.campus_id = $1))::int AS "marksLate",
       (SELECT count(*) FROM lesson_plans lp JOIN employees emp ON emp.id = lp.author_id
         WHERE lp.status IN ('Submitted', 'Under Review') AND lp.updated_at < now() - interval '7 days'
           AND ($1::uuid IS NULL OR emp.campus_id = $1))::int AS "plansWaiting",
       (SELECT count(*) FROM incidents
         WHERE status <> 'Closed' AND (severity = 'Critical' OR status = 'Escalated')
           AND ($1::uuid IS NULL OR campus_id = $1))::int AS "safetyOpen",
       (SELECT count(*) FROM tasks t LEFT JOIN users u ON u.id = t.assignee_user_id
         WHERE t.status IN ('Pending', 'Under Review') AND t.due_on < current_date
           AND ($1::uuid IS NULL OR u.campus_id = $1))::int AS "tasksOverdue",
       (SELECT count(*) FROM tasks t LEFT JOIN users u ON u.id = t.assignee_user_id
         WHERE t.status IN ('Pending', 'Under Review') AND t.due_on < current_date AND t.priority = 'High'
           AND ($1::uuid IS NULL OR u.campus_id = $1))::int AS "tasksHigh",
       (SELECT COALESCE(sum(${BAL()}), 0) FROM student_fees f JOIN students s ON s.id = f.student_id
         WHERE f.academic_year_id = ${YEAR_ID} AND s.deleted_at IS NULL AND f.due_date < current_date - 60
           AND ($1::uuid IS NULL OR s.campus_id = $1))::float AS "fees60",
       (SELECT count(DISTINCT f.student_id) FROM student_fees f JOIN students s ON s.id = f.student_id
         WHERE f.academic_year_id = ${YEAR_ID} AND s.deleted_at IS NULL AND f.due_date < current_date - 60
           AND ${BAL()} > 0 AND ($1::uuid IS NULL OR s.campus_id = $1))::int AS "families60",
       (SELECT count(*) FROM budgets b
         WHERE b.academic_year_id = ${YEAR_ID} AND ($1::uuid IS NULL OR b.campus_id = $1)
           AND b.allocated < (SELECT COALESCE(sum(e.amount), 0) FROM expenses e
                               WHERE e.campus_id = b.campus_id AND e.category = b.category
                                 AND e.status IN ('Approved', 'Paid') AND e.expense_date >= ${YEAR_START}))::int AS "overBudget"`,
    [c],
  );
  return row ?? { marksLate: 0, plansWaiting: 0, safetyOpen: 0, tasksOverdue: 0, tasksHigh: 0, fees60: 0, families60: 0, overBudget: 0 };
}

/** Setup completeness, access controls, policies, audit volume and the reporting structure. */
async function governanceBlock(c: string | null) {
  const [setup, access, policies, trail, hierarchy] = await Promise.all([
    one<Record<string, boolean>>(
      `SELECT EXISTS (SELECT 1 FROM academic_years WHERE is_current) AS "academicYear",
              EXISTS (SELECT 1 FROM classes cl WHERE ($1::uuid IS NULL OR cl.campus_id = $1)) AS classes,
              EXISTS (SELECT 1 FROM fee_structures fs JOIN classes cl ON cl.id = fs.class_id
                       WHERE fs.academic_year_id = ${YEAR_ID} AND fs.status = 'Active'
                         AND ($1::uuid IS NULL OR cl.campus_id = $1)) AS fees,
              EXISTS (SELECT 1 FROM timetable_entries te JOIN sections sec ON sec.id = te.section_id
                        JOIN classes cl ON cl.id = sec.class_id
                       WHERE ($1::uuid IS NULL OR cl.campus_id = $1)) AS timetable,
              EXISTS (SELECT 1 FROM employees emp WHERE emp.deleted_at IS NULL
                         AND ($1::uuid IS NULL OR emp.campus_id = $1)) AS staff,
              EXISTS (SELECT 1 FROM transport_routes) AS transport`,
      [c],
    ),
    one<{ active: number; suspended: number; invited: number; locked: number; dormant: number; roles: number; failed7: number }>(
      `SELECT count(*) FILTER (WHERE u.status = 'active')::int AS active,
              count(*) FILTER (WHERE u.status = 'suspended')::int AS suspended,
              count(*) FILTER (WHERE u.status = 'invited')::int AS invited,
              count(*) FILTER (WHERE u.locked_until > now())::int AS locked,
              count(*) FILTER (WHERE u.status = 'active'
                AND (u.last_login_at IS NULL OR u.last_login_at < now() - interval '30 days'))::int AS dormant,
              count(DISTINCT u.role_id)::int AS roles,
              (SELECT count(*) FROM audit_logs a
                WHERE a.action LIKE '%\\_failed' AND a.created_at > now() - interval '7 days')::int AS failed7
         FROM users u
        WHERE u.deleted_at IS NULL AND ($1::uuid IS NULL OR u.campus_id = $1)`,
      [c],
    ),
    one<{ active: number; review: number; draft: number; lastChange: string | null }>(
      `SELECT count(*) FILTER (WHERE status = 'Active')::int AS active,
              count(*) FILTER (WHERE status = 'Under review')::int AS review,
              count(*) FILTER (WHERE status = 'Draft')::int AS draft,
              max(updated_at) AS "lastChange"
         FROM group_policies`,
      [],
    ),
    one<{ day: number; week: number; sensitive: number }>(
      `SELECT count(*) FILTER (WHERE a.created_at > now() - interval '1 day')::int AS day,
              count(*)::int AS week,
              count(*) FILTER (WHERE ${IMPORTANT})::int AS sensitive
         FROM audit_logs a
        WHERE a.created_at > now() - interval '7 days' AND ${CHANGE_ACTIONS}`,
      [],
    ),
    many<{ role: string; users: number }>(
      `SELECT r.name AS role, count(u.id)::int AS users
         FROM roles r
         JOIN users u ON u.role_id = r.id AND u.deleted_at IS NULL AND u.status = 'active'
        WHERE r.scope = 'school' AND ($1::uuid IS NULL OR u.campus_id = $1)
        GROUP BY r.id, r.name
        ORDER BY min(r.created_at), r.name
        LIMIT 8`,
      [c],
    ),
  ]);

  const checks = [
    { label: 'Academic year', ok: !!setup?.academicYear },
    { label: 'Classes', ok: !!setup?.classes },
    { label: 'Fee structures', ok: !!setup?.fees },
    { label: 'Timetable', ok: !!setup?.timetable },
    { label: 'Staff records', ok: !!setup?.staff },
    { label: 'Transport routes', ok: !!setup?.transport },
  ];
  return {
    setup: { pct: Math.round((checks.filter((x) => x.ok).length / checks.length) * 100), checks },
    access: access ?? { active: 0, suspended: 0, invited: 0, locked: 0, dormant: 0, roles: 0, failed7: 0 },
    policies: policies ?? { active: 0, review: 0, draft: 0, lastChange: null },
    trail: trail ?? { day: 0, week: 0, sensitive: 0 },
    hierarchy,
  };
}
