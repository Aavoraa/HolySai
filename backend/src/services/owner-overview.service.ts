import { many, one } from '../config/db.js';
import type { AuthUser } from '../types.js';
import { BAL, NET } from './finance-fees.service.js';

/**
 * Owner Overview — the Super Admin's landing page.
 *
 * Answers "is the school healthy, and what needs me?" rather than "what is
 * happening right now" (that is the Principal's Command Center). Three blocks:
 *
 *   welcome   when the owner last signed in, and how much has changed since
 *   revenue   money in, money out and what is still owed, this academic year
 *   activity  who did what since the last visit, and what awaits approval
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

  const [welcome, revenue, activity] = await Promise.all([
    welcomeBlock(since),
    user.permissions.has('finance.read') ? revenueBlock(campusId) : Promise.resolve(null),
    user.permissions.has('audit.read') ? activityBlock(since, campusId) : Promise.resolve(null),
  ]);

  return { previousVisit: visit, welcome, revenue, activity };
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
      `SELECT ${AGG('amount')} FROM reimbursements WHERE status IN ('Submitted', 'Under Review')`, []),
    one<Waiting>(
      `SELECT ${AGG('net_total')} FROM payroll_runs
        WHERE status IN ('Calculated', 'Under Review') AND ($1::uuid IS NULL OR campus_id = $1)`, [c]),
    one<Waiting>(
      `SELECT ${AGG('days')} FROM leave_requests WHERE status IN ('Submitted', 'Under Review')`, []),
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
