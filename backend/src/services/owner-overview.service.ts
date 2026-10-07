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

  const [fees, collection, spend, payroll, pending] = await Promise.all([
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
  };
}

// ---------------------------------------------------------------------------
// Management activity — since the previous visit
// ---------------------------------------------------------------------------
async function activityBlock(since: string | null, campusId: string | null) {
  const from = since;

  const [byModule, byPerson, important, approvals] = await Promise.all([
    many<{ module: string; count: number }>(
      `SELECT a.module, count(*)::int AS count
         FROM audit_logs a
        WHERE a.created_at > COALESCE($1::timestamptz, now() - interval '7 days')
          AND ${CHANGE_ACTIONS}
        GROUP BY a.module ORDER BY count DESC, a.module LIMIT 8`,
      [from],
    ),
    many<{ name: string; role: string; count: number }>(
      `SELECT a.user_name AS name, a.role_key AS role, count(*)::int AS count
         FROM audit_logs a
        WHERE a.created_at > COALESCE($1::timestamptz, now() - interval '7 days')
          AND ${CHANGE_ACTIONS} AND a.user_id IS NOT NULL
        GROUP BY a.user_name, a.role_key ORDER BY count DESC, a.user_name LIMIT 6`,
      [from],
    ),
    many(
      `SELECT a.id::text AS id, a.created_at AS at, a.user_name AS "userName", a.role_key AS role,
              a.action, a.module, a.description, a.entity_type AS "entityType", a.entity_id AS "entityId"
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

/** Items sitting in a review state that an owner or administrator clears. */
async function approvalsWaiting(campusId: string | null) {
  const c = campusId;
  const [expenses, concessions, reimbursements, payroll, leave] = await Promise.all([
    one<{ count: number }>(
      `SELECT count(*)::int AS count FROM expenses
        WHERE status IN ('Submitted', 'Under Review') AND ($1::uuid IS NULL OR campus_id = $1)`, [c]),
    one<{ count: number }>(
      `SELECT count(*)::int AS count FROM concessions co JOIN students s ON s.id = co.student_id
        WHERE co.status IN ('Submitted', 'Under Review') AND ($1::uuid IS NULL OR s.campus_id = $1)`, [c]),
    one<{ count: number }>(
      `SELECT count(*)::int AS count FROM reimbursements WHERE status IN ('Submitted', 'Under Review')`, []),
    one<{ count: number }>(
      `SELECT count(*)::int AS count FROM payroll_runs
        WHERE status IN ('Calculated', 'Under Review') AND ($1::uuid IS NULL OR campus_id = $1)`, [c]),
    one<{ count: number }>(
      `SELECT count(*)::int AS count FROM leave_requests WHERE status IN ('Submitted', 'Under Review')`, []),
  ]);

  return [
    { label: 'Expense claims', count: expenses?.count ?? 0, to: '/expenses', icon: 'receipt' },
    { label: 'Fee concessions', count: concessions?.count ?? 0, to: '/concessions', icon: 'percent' },
    { label: 'Reimbursements', count: reimbursements?.count ?? 0, to: '/reimbursements', icon: 'wallet' },
    { label: 'Payroll runs', count: payroll?.count ?? 0, to: '/payroll', icon: 'briefcase' },
    { label: 'Leave requests', count: leave?.count ?? 0, to: '/leave', icon: 'calendar' },
  ].filter((x) => x.count > 0);
}
