import type { Request } from 'express';
import { randomBytes } from 'node:crypto';
import { many, one, query, tx, type Queryable } from '../config/db.js';
import { Where } from '../utils/sql.js';
import { likeTerm, limitOffset, orderBy } from '../utils/pagination.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { nextCode } from '../utils/codes.js';
import { audit } from './audit.service.js';
import { notifyGuardians, type Channel } from './notification.service.js';
import { studentScope } from './access.service.js';
import type { AuthUser } from '../types.js';

/**
 * Finance — fees side: structures, student ledgers, the payment rule,
 * receipts, reminders, concessions and the collection dashboard.
 *
 * Every figure is computed from student_fees / fee_payments /
 * fee_payment_allocations. "Effective status" treats an unpaid charge past its
 * due date as Overdue even before a status refresh has run.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
const YEAR = `(SELECT id FROM academic_years WHERE is_current)`;
/** Net amount the family owes on a charge. */
export const NET = (a = 'f') => `(${a}.amount_due - ${a}.concession_amount)`;
export const BAL = (a = 'f') => `(${a}.amount_due - ${a}.concession_amount - ${a}.amount_paid)`;
export const EFF_STATUS = (a = 'f') =>
  `(CASE WHEN ${a}.status IN ('Pending', 'Partial') AND ${a}.due_date < current_date AND ${BAL(a)} > 0 THEN 'Overdue' ELSE ${a}.status END)`;

const toPaise = (v: number) => Math.round(Number(v) * 100);
const fromPaise = (p: number) => p / 100;
const inr = (v: number) => '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });

async function currentYear(db?: Queryable) {
  const y = await one<{ id: string; label: string; starts_on: string; ends_on: string }>(
    'SELECT id, label, starts_on, ends_on FROM academic_years WHERE is_current', [], db);
  if (!y) throw badRequest('No current academic year is configured', 'NO_CURRENT_YEAR');
  return y;
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------
export async function lookups() {
  const [feeHeads, vendors, categories, employees, campuses] = await Promise.all([
    many(`SELECT id, code, name, is_optional AS "isOptional" FROM fee_heads ORDER BY name`),
    many(`SELECT id, name, category FROM vendors WHERE status <> 'Suspended' ORDER BY name`),
    many(`SELECT DISTINCT category FROM budgets UNION SELECT DISTINCT category FROM expenses ORDER BY 1`).then((r) => r.map((x) => x.category)),
    many(`SELECT id, full_name AS "fullName", employee_code AS code, department, category, employee_type AS "employeeType",
                 campus_id AS "campusId", basic_salary AS "basicSalary"
            FROM employees WHERE deleted_at IS NULL AND employment_status = 'active' ORDER BY full_name`),
    many(`SELECT id, short_name AS name FROM campuses WHERE is_active ORDER BY established`),
  ]);
  const employeeCategories = [...new Set(employees.map((e) => e.category))].sort();
  return { feeHeads, vendors, expenseCategories: categories, employees, employeeCategories, campuses };
}

// ---------------------------------------------------------------------------
// Fee structures
// ---------------------------------------------------------------------------
export async function structureSummary(campusId?: string) {
  const w = new Where().add(`fs.academic_year_id = ${YEAR}`);
  w.addIf(campusId, 'c.campus_id = ?');
  return many(
    `WITH per_class AS (
       SELECT c.id AS class_id, c.campus_id, c.stage, c.grade_level,
              sum(fs.amount) FILTER (WHERE fh.code = 'TUITION') AS tuition,
              sum(fs.amount) FILTER (WHERE fh.code = 'TRANSPORT') AS transport,
              sum(fs.amount) FILTER (WHERE fh.code = 'ACTIVITIES') AS activities,
              count(DISTINCT fs.term) FILTER (WHERE fh.code = 'TUITION') AS terms,
              bool_or(fs.status = 'Draft') AS has_draft
         FROM fee_structures fs
         JOIN classes c ON c.id = fs.class_id
         JOIN fee_heads fh ON fh.id = fs.fee_head_id
         ${w.sql} AND fs.status <> 'Archived'
        GROUP BY c.id)
     SELECT pc.campus_id AS "campusId", cp.short_name AS campus, pc.stage,
            min(pc.grade_level) AS "fromGrade", max(pc.grade_level) AS "toGrade",
            count(*)::int AS classes,
            COALESCE(max(pc.tuition), 0) AS tuition, COALESCE(max(pc.transport), 0) AS transport,
            COALESCE(max(pc.activities), 0) AS activities, max(pc.terms)::int AS terms,
            (SELECT count(*)::int FROM students s JOIN sections sec ON sec.id = s.section_id
              WHERE sec.class_id = ANY(array_agg(pc.class_id)) AND s.status = 'active' AND s.deleted_at IS NULL) AS students,
            CASE WHEN bool_or(pc.has_draft) THEN 'Draft' ELSE 'Active' END AS status
       FROM per_class pc JOIN campuses cp ON cp.id = pc.campus_id
      GROUP BY pc.campus_id, cp.short_name, cp.established, pc.stage
      ORDER BY cp.established, min(pc.grade_level)`,
    w.params,
  );
}

const STRUCT_SORT: Record<string, string> = {
  class: 'cp.established, c.grade_level', head: 'fh.name', term: 'fs.term', amount: 'fs.amount', dueDate: 'fs.due_date', status: 'fs.status',
};

export async function listStructures(f: any) {
  const w = new Where().add(`fs.academic_year_id = ${YEAR}`);
  w.addIf(f.campusId, 'c.campus_id = ?');
  w.addIf(f.classId, 'c.id = ?');
  w.addIf(f.feeHeadId, 'fh.id = ?');
  w.addIf(f.status, 'fs.status = ?');
  if (f.q) w.add('(c.name ILIKE ? OR fh.name ILIKE ? OR c.stage ILIKE ?)', likeTerm(f.q), likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT fs.id, c.id AS "classId", c.name AS class, c.stage, cp.short_name AS campus, fh.id AS "feeHeadId", fh.name AS head,
            fs.term, fs.amount, fs.due_date AS "dueDate", fs.status,
            (SELECT count(*)::int FROM student_fees sf WHERE sf.fee_structure_id = fs.id) AS applied,
            count(*) OVER() AS total
       FROM fee_structures fs JOIN classes c ON c.id = fs.class_id JOIN campuses cp ON cp.id = c.campus_id
       JOIN fee_heads fh ON fh.id = fs.fee_head_id
       ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, STRUCT_SORT, 'class')}, fh.name, fs.term
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export async function createStructures(req: Request, input: any) {
  return tx(async (db) => {
    const year = await currentYear(db);
    const head = await one('SELECT id, name FROM fee_heads WHERE id = $1', [input.feeHeadId], db);
    if (!head) throw badRequest('Fee head not found', 'FEE_HEAD_NOT_FOUND');
    const ids: string[] = [];
    for (const classId of input.classIds as string[]) {
      const cls = await one('SELECT id, name FROM classes WHERE id = $1', [classId], db);
      if (!cls) throw badRequest('Class not found', 'CLASS_NOT_FOUND');
      const r = await one<{ id: string }>(
        `INSERT INTO fee_structures (academic_year_id, class_id, fee_head_id, term, amount, due_date, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (academic_year_id, class_id, fee_head_id, term) DO NOTHING RETURNING id`,
        [year.id, classId, input.feeHeadId, input.term, input.amount, input.dueDate, input.status, req.user!.id], db);
      if (!r) throw conflict(`${cls.name} already has a ${head.name} structure for ${input.term}`, 'STRUCTURE_EXISTS');
      ids.push(r.id);
    }
    let applied = 0;
    if (input.applyNow && input.status === 'Active') {
      for (const id of ids) applied += await applyStructureTx(db, id);
    }
    await audit(req, {
      action: 'create', module: 'finance', entityType: 'fee_structure', entityId: ids[0],
      description: `Created ${head.name} ${input.term} fee structure for ${ids.length} class(es)${applied ? `, raised ${applied} charges` : ''}`,
      metadata: { ids, amount: input.amount, applied },
    }, db);
    return { ids, applied };
  });
}

export async function updateStructure(req: Request, id: string, input: any) {
  return tx(async (db) => {
    const cur = await one('SELECT fs.*, (SELECT count(*)::int FROM student_fees sf WHERE sf.fee_structure_id = fs.id) AS applied FROM fee_structures fs WHERE fs.id = $1 FOR UPDATE', [id], db);
    if (!cur) throw notFound('Fee structure not found');
    if (cur.applied > 0 && (input.amount != null && Number(input.amount) !== Number(cur.amount))) {
      throw conflict('This structure has already been applied to student accounts; raise an adjustment instead of changing the amount', 'STRUCTURE_APPLIED');
    }
    const row = await one(
      `UPDATE fee_structures SET amount = COALESCE($2, amount), due_date = COALESCE($3, due_date), status = COALESCE($4, status)
        WHERE id = $1 RETURNING id, amount, due_date AS "dueDate", status`,
      [id, input.amount ?? null, input.dueDate ?? null, input.status ?? null], db);
    if (input.dueDate && cur.applied > 0) {
      // Keep unpaid charges in step with the structure's due date; a charge that is
      // no longer past due stops being Overdue.
      await query(
        `UPDATE student_fees SET due_date = $2,
                status = CASE WHEN status = 'Overdue' AND $2::date >= current_date
                              THEN (CASE WHEN amount_paid > 0 THEN 'Partial' ELSE 'Pending' END) ELSE status END
          WHERE fee_structure_id = $1 AND status <> 'Paid'`, [id, input.dueDate], db);
    }
    await audit(req, { action: 'update', module: 'finance', entityType: 'fee_structure', entityId: id, description: 'Updated fee structure', metadata: input }, db);
    return row;
  });
}

async function applyStructureTx(db: Queryable, structureId: string) {
  const fs = await one(
    `SELECT fs.*, fh.code AS head_code, fh.name AS head_name, c.name AS class_name
       FROM fee_structures fs JOIN fee_heads fh ON fh.id = fs.fee_head_id JOIN classes c ON c.id = fs.class_id
      WHERE fs.id = $1`, [structureId], db);
  if (!fs) throw notFound('Fee structure not found');
  if (fs.status !== 'Active') throw badRequest('Only active structures can be applied', 'STRUCTURE_NOT_ACTIVE');
  const transportOnly = fs.head_code === 'TRANSPORT';
  const r = await query(
    `INSERT INTO student_fees (student_id, academic_year_id, fee_head_id, fee_structure_id, description, amount_due, due_date, status)
     SELECT s.id, $2, $3, $1,
            CASE WHEN $6 THEN $4 || ' — ' || COALESCE(tr.name, 'Transport') || ', ' || $5 ELSE $4 || ' — ' || $5 END,
            $7, $8, 'Pending'
       FROM students s JOIN sections sec ON sec.id = s.section_id
       LEFT JOIN student_transport st ON st.student_id = s.id
       LEFT JOIN transport_routes tr ON tr.id = st.route_id
      WHERE sec.class_id = $9 AND s.status = 'active' AND s.deleted_at IS NULL
        AND (NOT $6 OR st.student_id IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM student_fees x WHERE x.student_id = s.id AND x.fee_structure_id = $1)`,
    [structureId, fs.academic_year_id, fs.fee_head_id, fs.head_name, fs.term, transportOnly, fs.amount, fs.due_date, fs.class_id], db);
  return r.rowCount ?? 0;
}

export async function applyStructure(req: Request, id: string) {
  return tx(async (db) => {
    const n = await applyStructureTx(db, id);
    await audit(req, { action: 'update', module: 'finance', entityType: 'fee_structure', entityId: id, description: `Applied fee structure to ${n} student accounts` }, db);
    return { applied: n };
  });
}

// ---------------------------------------------------------------------------
// Student accounts
// ---------------------------------------------------------------------------
const ACCOUNT_SORT: Record<string, string> = {
  name: 'q."fullName"', admissionNo: 'q."admissionNo"', grade: 'q."gradeLevel", q.section',
  billed: 'q.billed', paid: 'q.paid', balance: 'q.balance', overdue: 'q.overdue',
  feeStatus: `array_position(ARRAY['Overdue','Partial','Pending','Paid'], q."feeStatus")`,
};

export async function listAccounts(user: AuthUser, f: any) {
  const w = new Where().add('s.deleted_at IS NULL').add(`s.status = 'active'`);
  studentScope(user, w);
  w.addIf(f.campusId, 's.campus_id = ?');
  w.addIf(f.classId, 'sec.class_id = ?');
  if (f.q) w.add('(s.full_name ILIKE ? OR s.admission_no ILIKE ?)', likeTerm(f.q), likeTerm(f.q));
  const outer = f.feeStatus ? `WHERE q."feeStatus" = ${w.param(f.feeStatus)}` : '';
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT q.*, count(*) OVER() AS total FROM (
       SELECT s.id, s.admission_no AS "admissionNo", s.full_name AS "fullName", c.name AS grade, c.grade_level AS "gradeLevel",
              sec.name AS section, cp.short_name AS campus,
              COALESCE(a.billed, 0) AS billed, COALESCE(a.paid, 0) AS paid, COALESCE(a.balance, 0) AS balance,
              COALESCE(a.overdue, 0) AS overdue, a.next_due AS "nextDue",
              CASE WHEN a.n_overdue > 0 THEN 'Overdue' WHEN a.n_partial > 0 THEN 'Partial'
                   WHEN a.n_pending > 0 THEN 'Pending' ELSE 'Paid' END AS "feeStatus"
         FROM students s
         JOIN campuses cp ON cp.id = s.campus_id
         LEFT JOIN sections sec ON sec.id = s.section_id
         LEFT JOIN classes c ON c.id = sec.class_id
         LEFT JOIN LATERAL (
           SELECT sum(${NET()}) AS billed, sum(f.amount_paid) AS paid, sum(${BAL()}) AS balance,
                  sum(${BAL()}) FILTER (WHERE ${EFF_STATUS()} = 'Overdue') AS overdue,
                  min(f.due_date) FILTER (WHERE ${BAL()} > 0 AND f.due_date >= current_date) AS next_due,
                  count(*) FILTER (WHERE ${EFF_STATUS()} = 'Overdue') AS n_overdue,
                  count(*) FILTER (WHERE ${EFF_STATUS()} = 'Partial') AS n_partial,
                  count(*) FILTER (WHERE ${EFF_STATUS()} = 'Pending') AS n_pending
             FROM student_fees f WHERE f.student_id = s.id AND f.academic_year_id = ${YEAR}) a ON true
         ${w.sql}) q
     ${outer}
     ORDER BY ${orderBy(f.sort, f.dir, ACCOUNT_SORT, 'name')}, q."fullName"
     LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export const LINE_SQL = `
  SELECT f.id, f.description, fh.name AS head, fh.code AS "headCode", f.amount_due AS "amountDue",
         f.concession_amount AS concession, f.amount_paid AS "amountPaid", ${BAL()} AS balance,
         f.due_date AS "dueDate", ${EFF_STATUS()} AS status, f.created_at AS "raisedAt"
    FROM student_fees f JOIN fee_heads fh ON fh.id = f.fee_head_id`;

export const PAYMENT_SQL = `
  SELECT p.id, p.receipt_no AS "receiptNo", p.amount, p.method, p.gateway_ref AS "gatewayRef", p.status,
         p.paid_at AS "paidAt", p.reconciled, p.receipt_sent_at AS "receiptSentAt",
         CASE WHEN p.receipt_sent_at IS NOT NULL THEN 'Delivered' ELSE 'Pending' END AS delivery,
         cu.full_name AS "collectedBy", pp.full_name AS "paidBy"
    FROM fee_payments p
    LEFT JOIN users cu ON cu.id = p.collected_by
    LEFT JOIN parents pp ON pp.id = p.paid_by_parent_id`;

async function feeSummary(studentId: string, db?: Queryable) {
  return one(
    `SELECT COALESCE(sum(f.amount_due), 0) AS gross, COALESCE(sum(f.concession_amount), 0) AS concession,
            COALESCE(sum(${NET()}), 0) AS billed, COALESCE(sum(f.amount_paid), 0) AS paid,
            COALESCE(sum(${BAL()}), 0) AS outstanding,
            COALESCE(sum(${BAL()}) FILTER (WHERE ${EFF_STATUS()} = 'Overdue'), 0) AS overdue,
            min(f.due_date) FILTER (WHERE ${BAL()} > 0) AS "nextDue",
            (SELECT sum(${BAL('g')}) FROM student_fees g WHERE g.student_id = $1 AND g.academic_year_id = ${YEAR}
               AND ${BAL('g')} > 0 AND g.due_date = min(f.due_date) FILTER (WHERE ${BAL()} > 0)) AS "nextDueAmount"
       FROM student_fees f WHERE f.student_id = $1 AND f.academic_year_id = ${YEAR}`,
    [studentId], db);
}

export async function getAccount(studentId: string) {
  const [student, summary, lines, payments, concessions] = await Promise.all([
    one(`SELECT s.id, s.admission_no AS "admissionNo", s.full_name AS "fullName", c.name AS grade, sec.name AS section,
                cp.short_name AS campus, tr.name AS "busRoute",
                g.full_name AS "parentName", g.phone AS "parentPhone"
           FROM students s JOIN campuses cp ON cp.id = s.campus_id
           LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
           LEFT JOIN student_transport st ON st.student_id = s.id LEFT JOIN transport_routes tr ON tr.id = st.route_id
           LEFT JOIN LATERAL (SELECT p.full_name, p.phone FROM student_guardians sg JOIN parents p ON p.id = sg.parent_id
                               WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC LIMIT 1) g ON true
          WHERE s.id = $1`, [studentId]),
    feeSummary(studentId),
    many(`${LINE_SQL} WHERE f.student_id = $1 AND f.academic_year_id = ${YEAR} ORDER BY f.due_date, fh.name`, [studentId]),
    many(`${PAYMENT_SQL} WHERE p.student_id = $1 ORDER BY p.paid_at DESC`, [studentId]),
    many(`SELECT k.id, k.concession_type AS type, k.percent, k.amount, k.status, k.reason,
                 u.full_name AS "approvedBy", k.approved_at AS "approvedAt", ay.ends_on AS "validUntil"
            FROM concessions k LEFT JOIN users u ON u.id = k.approved_by JOIN academic_years ay ON ay.id = k.academic_year_id
           WHERE k.student_id = $1 ORDER BY k.created_at DESC`, [studentId]),
  ]);
  if (!student) throw notFound('Student not found', 'STUDENT_NOT_FOUND');
  return { student, summary, lines, payments, concessions };
}

export async function raiseCharge(req: Request, studentId: string, input: any) {
  return tx(async (db) => {
    const year = await currentYear(db);
    const head = await one('SELECT id, name FROM fee_heads WHERE id = $1', [input.feeHeadId], db);
    if (!head) throw badRequest('Fee head not found', 'FEE_HEAD_NOT_FOUND');
    const row = await one(
      `INSERT INTO student_fees (student_id, academic_year_id, fee_head_id, description, amount_due, due_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,'Pending') RETURNING id`,
      [studentId, year.id, input.feeHeadId, input.description, input.amount, input.dueDate], db);
    await audit(req, {
      action: 'create', module: 'finance', entityType: 'student_fee', entityId: row!.id,
      description: `Raised charge "${input.description}" of ${inr(input.amount)}`, metadata: { studentId },
    }, db);
    await notifyGuardians(studentId, {
      category: 'Information', topic: 'fees', icon: 'wallet', title: `New charge: ${input.description}`,
      body: `${inr(input.amount)} due by ${input.dueDate}`, route: '/parent-360?tab=fees', entityType: 'student_fee', entityId: row!.id,
    }, db);
    return row;
  });
}

// ---------------------------------------------------------------------------
// The payment rule — the ONLY place a fee payment is recorded.
// ---------------------------------------------------------------------------
export interface PaymentInput {
  studentId: string;
  amount: number;
  method: string;
  feeIds?: string[];
  gatewayRef?: string | null;
  paidByParentId?: string | null;
  collectedBy?: string | null;
}

/**
 * Records a payment inside one transaction:
 *   1. locks the student's outstanding charges (oldest due first, or the given ids)
 *   2. rejects overpayment
 *   3. inserts fee_payments with the next RCT-<year>-NNNNNN receipt number
 *   4. allocates the amount across the charges (fee_payment_allocations) and
 *      updates amount_paid / status (Paid, Partial, or Overdue when past due)
 *   5. audits and notifies the guardians
 */
export async function recordPayment(req: Request, db: Queryable, input: PaymentInput) {
  const amountP = toPaise(input.amount);
  if (amountP <= 0) throw badRequest('Amount must be greater than zero', 'INVALID_AMOUNT');

  const params: unknown[] = [input.studentId];
  let idFilter = '';
  if (input.feeIds?.length) {
    params.push(input.feeIds);
    idFilter = 'AND f.id = ANY($2)';
  }
  const lines = await many<{ id: string; description: string; balance: number; due_date: string }>(
    `SELECT f.id, f.description, ${BAL()} AS balance, f.due_date
       FROM student_fees f
      WHERE f.student_id = $1 AND f.status IN ('Pending', 'Partial', 'Overdue') AND ${BAL()} > 0 ${idFilter}
      ORDER BY f.due_date, f.created_at, f.id
      FOR UPDATE`,
    params, db);
  if (input.feeIds?.length && lines.length !== new Set(input.feeIds).size) {
    throw badRequest('One or more selected charges are not outstanding for this student', 'INVALID_FEE_SELECTION');
  }
  if (!lines.length) throw badRequest('There is nothing outstanding to pay', 'NOTHING_DUE');
  const outstandingP = lines.reduce((a, l) => a + toPaise(l.balance), 0);
  if (amountP > outstandingP) {
    throw badRequest(`Amount exceeds the outstanding balance of ${inr(fromPaise(outstandingP))}`, 'OVERPAYMENT', { outstanding: fromPaise(outstandingP) });
  }

  // Serialise receipt numbering so concurrent payments never collide.
  await query(`SELECT pg_advisory_xact_lock(hashtext('fee_payments.receipt_no'))`, [], db);
  const year = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(new Date());
  const receiptNo = await nextCode('fee_payments', 'receipt_no', `RCT-${year}-`, db, 6);
  const pay = await one<{ id: string }>(
    `INSERT INTO fee_payments (receipt_no, student_id, amount, method, gateway_ref, status, paid_at, paid_by_parent_id, collected_by)
     VALUES ($1,$2,$3,$4,$5,'Success', now(),$6,$7) RETURNING id`,
    [receiptNo, input.studentId, fromPaise(amountP), input.method, input.gatewayRef ?? null, input.paidByParentId ?? null, input.collectedBy ?? null],
    db);

  let remaining = amountP;
  const allocated: { id: string; description: string; amount: number }[] = [];
  for (const l of lines) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, toPaise(l.balance));
    if (take <= 0) continue;
    remaining -= take;
    await query('INSERT INTO fee_payment_allocations (payment_id, student_fee_id, amount) VALUES ($1,$2,$3)', [pay!.id, l.id, fromPaise(take)], db);
    await query(
      `UPDATE student_fees
          SET amount_paid = amount_paid + $2,
              status = CASE WHEN amount_paid + $2 >= amount_due - concession_amount THEN 'Paid'
                            WHEN due_date < current_date THEN 'Overdue'
                            ELSE 'Partial' END
        WHERE id = $1`,
      [l.id, fromPaise(take)], db);
    allocated.push({ id: l.id, description: l.description, amount: fromPaise(take) });
  }

  const student = await one<{ full_name: string; admission_no: string }>('SELECT full_name, admission_no FROM students WHERE id = $1', [input.studentId], db);
  await audit(req, {
    action: 'create', module: 'finance', entityType: 'fee_payment', entityId: pay!.id,
    description: `Payment ${receiptNo} of ${inr(fromPaise(amountP))} (${input.method}) for ${student?.full_name} (${student?.admission_no})`,
    metadata: { allocations: allocated, gatewayRef: input.gatewayRef ?? null, byParent: !!input.paidByParentId },
  }, db);
  await notifyGuardians(input.studentId, {
    category: 'Completed', topic: 'fees', icon: 'receipt',
    title: `Payment received — receipt ${receiptNo}`,
    body: `${inr(fromPaise(amountP))} received for ${student?.full_name} via ${input.method}.`,
    route: '/parent-360?tab=fees', entityType: 'fee_payment', entityId: pay!.id,
  }, db);
  return getReceipt(pay!.id, db);
}

export async function counterPayment(req: Request, studentId: string, input: any) {
  return tx((db) => recordPayment(req, db, {
    studentId, amount: input.amount, method: input.method, feeIds: input.feeIds,
    gatewayRef: input.reference ?? null, collectedBy: req.user!.id,
  }));
}

// ---------------------------------------------------------------------------
// Receipts & payments register
// ---------------------------------------------------------------------------
export async function getReceipt(paymentId: string, db?: Queryable) {
  const p = await one(
    `SELECT p.id, p.receipt_no AS "receiptNo", p.amount, p.method, p.gateway_ref AS "gatewayRef", p.status,
            p.paid_at AS "paidAt", p.receipt_sent_at AS "receiptSentAt", p.reconciled,
            CASE WHEN p.receipt_sent_at IS NOT NULL THEN 'Delivered' ELSE 'Pending' END AS delivery,
            cu.full_name AS "collectedBy", pp.full_name AS "paidBy",
            json_build_object('id', s.id, 'admissionNo', s.admission_no, 'fullName', s.full_name,
                              'grade', c.name, 'section', sec.name, 'campus', cp.name, 'campusShort', cp.short_name) AS student,
            (SELECT label FROM academic_years WHERE is_current) AS "academicYear",
            COALESCE((SELECT json_agg(json_build_object('feeId', a.student_fee_id, 'description', f.description, 'head', fh.name,
                                                        'amount', a.amount, 'balanceAfter', ${BAL()}) ORDER BY f.due_date)
                        FROM fee_payment_allocations a JOIN student_fees f ON f.id = a.student_fee_id
                        JOIN fee_heads fh ON fh.id = f.fee_head_id WHERE a.payment_id = p.id), '[]') AS lines
       FROM fee_payments p
       JOIN students s ON s.id = p.student_id
       JOIN campuses cp ON cp.id = s.campus_id
       LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
       LEFT JOIN users cu ON cu.id = p.collected_by
       LEFT JOIN parents pp ON pp.id = p.paid_by_parent_id
      WHERE p.id = $1`, [paymentId], db);
  if (!p) throw notFound('Receipt not found', 'RECEIPT_NOT_FOUND');
  return { ...p, studentId: p.student.id };
}

const PAY_SORT: Record<string, string> = {
  date: 'p.paid_at', amount: 'p.amount', receiptNo: 'p.receipt_no', method: 'p.method', status: 'p.status', student: 's.full_name',
};

function paymentWhere(user: AuthUser, f: any) {
  const w = new Where().add('s.deleted_at IS NULL');
  studentScope(user, w);
  w.addIf(f.campusId, 's.campus_id = ?');
  if (f.method === 'Cash / DD') w.add(`p.method IN ('Cash', 'DD', 'Cheque')`);
  else w.addIf(f.method, 'p.method = ?');
  w.addIf(f.status, 'p.status = ?');
  if (f.delivery === 'Delivered') w.add('p.receipt_sent_at IS NOT NULL');
  if (f.delivery === 'Pending') w.add('p.receipt_sent_at IS NULL');
  if (f.reconciled !== undefined) w.add('p.reconciled = ?', f.reconciled);
  w.addIf(f.from, `p.paid_at >= (?::date)::timestamp AT TIME ZONE 'Asia/Kolkata'`);
  w.addIf(f.to, `p.paid_at < ((?::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`);
  if (f.q) w.add('(s.full_name ILIKE ? OR s.admission_no ILIKE ? OR p.receipt_no ILIKE ? OR p.gateway_ref ILIKE ?)', likeTerm(f.q), likeTerm(f.q), likeTerm(f.q), likeTerm(f.q));
  return w;
}

export async function listPayments(user: AuthUser, f: any) {
  const w = paymentWhere(user, f);
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT p.id, p.receipt_no AS "receiptNo", p.amount, p.method, p.gateway_ref AS "gatewayRef", p.status,
            p.paid_at AS "paidAt", p.reconciled, p.receipt_sent_at AS "receiptSentAt",
            CASE WHEN p.receipt_sent_at IS NOT NULL THEN 'Delivered' ELSE 'Pending' END AS delivery,
            s.id AS "studentId", s.full_name AS "studentName", s.admission_no AS "admissionNo",
            c.name AS grade, sec.name AS section, cp.short_name AS campus,
            cu.full_name AS "collectedBy", (p.paid_by_parent_id IS NOT NULL) AS "paidOnline",
            count(*) OVER() AS total
       FROM fee_payments p JOIN students s ON s.id = p.student_id JOIN campuses cp ON cp.id = s.campus_id
       LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
       LEFT JOIN users cu ON cu.id = p.collected_by
       ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, PAY_SORT, 'date')}, p.receipt_no DESC
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params);
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export async function exportPayments(user: AuthUser, f: any) {
  const { rows } = await listPayments(user, { ...f, page: 1, pageSize: 5000 });
  const head = ['Receipt', 'Paid at', 'Student', 'Admission no', 'Grade', 'Campus', 'Amount', 'Method', 'Reference', 'Status', 'Reconciled', 'Receipt delivery'];
  const esc = (v: unknown) => {
    const s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r: any) => [r.receiptNo, r.paidAt, r.studentName, r.admissionNo, `${r.grade ?? ''}${r.section ?? ''}`, r.campus,
    r.amount, r.method, r.gatewayRef, r.status, r.reconciled ? 'Yes' : 'No', r.delivery].map(esc).join(','));
  return [head.join(','), ...lines].join('\n');
}

export async function paymentSummary(user: AuthUser, campusId?: string) {
  const w = new Where().add('s.deleted_at IS NULL');
  studentScope(user, w);
  w.addIf(campusId, 's.campus_id = ?');
  return one(
    `SELECT COALESCE(sum(p.amount) FILTER (WHERE p.status = 'Success' AND p.paid_at >= current_date), 0) AS "collectedToday",
            count(*) FILTER (WHERE p.paid_at >= current_date)::int AS "transactionsToday",
            count(*) FILTER (WHERE p.status IN ('Initiated', 'Failed') AND p.paid_at >= current_date - 7)::int AS "failedOrPending",
            count(*) FILTER (WHERE p.status = 'Success' AND NOT p.reconciled AND p.method IN ('UPI', 'Card', 'Net Banking'))::int AS unreconciled,
            COALESCE(sum(p.amount) FILTER (WHERE p.status = 'Success' AND p.paid_at >= current_date - 30), 0) AS "collected30d",
            count(*) FILTER (WHERE p.status = 'Success' AND p.receipt_sent_at IS NULL)::int AS "receiptsPending",
            count(*) FILTER (WHERE p.status = 'Success' AND p.receipt_sent_at IS NOT NULL)::int AS "receiptsDelivered"
       FROM fee_payments p JOIN students s ON s.id = p.student_id ${w.sql}`,
    w.params);
}

export async function sendReceipt(req: Request, paymentId: string) {
  return tx(async (db) => {
    const r = await getReceipt(paymentId, db);
    if (r.status !== 'Success') throw badRequest('Only successful payments have a receipt', 'NOT_PAID');
    const ids = await notifyGuardians(r.studentId, {
      category: 'Completed', topic: 'fees', icon: 'receipt', channels: ['whatsapp'],
      title: `Receipt ${r.receiptNo} — ${inr(r.amount)}`,
      body: `Receipt for ${r.student.fullName} (${r.student.admissionNo}), paid ${inr(r.amount)} via ${r.method}.`,
      route: '/parent-360?tab=fees', entityType: 'fee_payment', entityId: r.id,
    }, db);
    if (!ids.length) throw badRequest('No guardian with an app account is linked to this student', 'NO_GUARDIAN_ACCOUNT');
    await query('UPDATE fee_payments SET receipt_sent_at = now() WHERE id = $1', [paymentId], db);
    await audit(req, { action: 'update', module: 'finance', entityType: 'fee_payment', entityId: paymentId, description: `Receipt ${r.receiptNo} queued to guardians on WhatsApp` }, db);
    return { queued: ids.length };
  });
}

// ---------------------------------------------------------------------------
// Collection dashboard
// ---------------------------------------------------------------------------
export async function feeDashboard(user: AuthUser, campusId?: string) {
  const w = new Where().add('s.deleted_at IS NULL').add(`f.academic_year_id = ${YEAR}`);
  studentScope(user, w);
  w.addIf(campusId, 's.campus_id = ?');
  const FROM = `FROM student_fees f JOIN students s ON s.id = f.student_id ${w.sql}`;
  const P = w.params;
  const year = await currentYear();

  const [kpis, trend, ageing, methods, byCampus, byHead, attention] = await Promise.all([
    one(
      `SELECT COALESCE(sum(${NET()}), 0) AS billed, COALESCE(sum(f.amount_paid), 0) AS collected,
              COALESCE(sum(${BAL()}), 0) AS outstanding,
              count(DISTINCT f.student_id) FILTER (WHERE ${BAL()} > 0)::int AS "outstandingAccounts",
              COALESCE(sum(${BAL()}) FILTER (WHERE f.due_date < current_date - 30 AND ${BAL()} > 0), 0) AS overdue,
              count(DISTINCT f.student_id) FILTER (WHERE f.due_date < current_date - 30 AND ${BAL()} > 0)::int AS "overdueAccounts",
              COALESCE(sum(${BAL()}) FILTER (WHERE f.due_date < current_date AND ${BAL()} > 0), 0) AS "overdueAll",
              count(DISTINCT f.student_id) FILTER (WHERE f.due_date < current_date AND ${BAL()} > 0)::int AS "overdueAllAccounts",
              COALESCE(sum(${BAL()}) FILTER (WHERE f.due_date >= current_date AND f.due_date < (date_trunc('month', current_date) + interval '1 month')::date), 0) AS expected,
              count(DISTINCT f.student_id) FILTER (WHERE ${BAL()} > 0 AND f.due_date BETWEEN current_date AND current_date + 7)::int AS "dueSoonAccounts"
         ${FROM}`, P),
    many(
      `WITH months AS (
         SELECT generate_series(date_trunc('month', $${P.length + 1}::date - interval '2 months'), date_trunc('month', current_date), interval '1 month')::date AS m)
       SELECT to_char(m, 'Mon') AS label, m AS month,
              COALESCE((SELECT sum(${NET()}) ${FROM} AND date_trunc('month', f.created_at AT TIME ZONE 'Asia/Kolkata') = m), 0) AS billed,
              COALESCE((SELECT sum(a.amount) FROM fee_payment_allocations a JOIN fee_payments p ON p.id = a.payment_id
                          JOIN student_fees f ON f.id = a.student_fee_id JOIN students s ON s.id = f.student_id
                          ${w.sql} AND p.status = 'Success' AND date_trunc('month', p.paid_at AT TIME ZONE 'Asia/Kolkata') = m), 0) AS collected
         FROM months ORDER BY m`, [...P, year.starts_on]),
    one(
      `SELECT COALESCE(sum(${BAL()}) FILTER (WHERE current_date - f.due_date BETWEEN 1 AND 30), 0) AS d30,
              COALESCE(sum(${BAL()}) FILTER (WHERE current_date - f.due_date BETWEEN 31 AND 60), 0) AS d60,
              COALESCE(sum(${BAL()}) FILTER (WHERE current_date - f.due_date BETWEEN 61 AND 90), 0) AS d90,
              COALESCE(sum(${BAL()}) FILTER (WHERE current_date - f.due_date > 90), 0) AS d90plus
         ${FROM} AND ${BAL()} > 0`, P),
    many(
      `SELECT CASE WHEN p.method IN ('Cash', 'DD', 'Cheque') THEN 'Cash / DD' ELSE p.method END AS label,
              sum(a.amount) AS amount, count(DISTINCT p.id)::int AS count
         FROM fee_payment_allocations a JOIN fee_payments p ON p.id = a.payment_id
         JOIN student_fees f ON f.id = a.student_fee_id JOIN students s ON s.id = f.student_id
         ${w.sql} AND p.status = 'Success'
        GROUP BY 1 ORDER BY 2 DESC`, P),
    // Campus comparison always spans the group so campuses can be compared.
    many(
      `SELECT cp.id, cp.short_name AS label, COALESCE(sum(f.amount_paid), 0) AS collected, COALESCE(sum(${BAL()}), 0) AS outstanding
         FROM campuses cp LEFT JOIN students s ON s.campus_id = cp.id AND s.deleted_at IS NULL
         LEFT JOIN student_fees f ON f.student_id = s.id AND f.academic_year_id = ${YEAR}
        WHERE cp.is_active GROUP BY cp.id ORDER BY cp.established`),
    many(
      `SELECT fh.name AS head, COALESCE(sum(${NET()}), 0) AS billed, COALESCE(sum(f.amount_paid), 0) AS collected
         FROM student_fees f JOIN students s ON s.id = f.student_id JOIN fee_heads fh ON fh.id = f.fee_head_id
         ${w.sql} GROUP BY fh.name ORDER BY 2 DESC`, P),
    many(
      `SELECT s.id, s.full_name AS "fullName", s.admission_no AS "admissionNo", c.name AS grade, sec.name AS section,
              sum(${BAL()}) AS outstanding, max(current_date - f.due_date)::int AS "ageDays", 'Overdue' AS "feeStatus"
         FROM student_fees f JOIN students s ON s.id = f.student_id
         LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
         ${w.sql} AND ${BAL()} > 0 AND f.due_date < current_date - 30
        GROUP BY s.id, c.name, sec.name ORDER BY outstanding DESC LIMIT 8`, P),
  ]);

  // Collected in the last 30 days vs the 30 before — the only trend delta we can compute honestly.
  const delta = await one(
    `SELECT COALESCE(sum(p.amount) FILTER (WHERE p.paid_at >= current_date - 30), 0) AS cur,
            COALESCE(sum(p.amount) FILTER (WHERE p.paid_at < current_date - 30 AND p.paid_at >= current_date - 60), 0) AS prev
       FROM fee_payments p JOIN students s ON s.id = p.student_id
      WHERE p.status = 'Success' ${campusId ? 'AND s.campus_id = $1' : ''}`, campusId ? [campusId] : []);
  const totalMethods = methods.reduce((a, m) => a + Number(m.amount), 0) || 1;
  return {
    kpis: {
      ...kpis,
      collectionPct: kpis!.billed ? Math.round((kpis!.collected / kpis!.billed) * 1000) / 10 : 0,
      collected30dDelta: delta!.prev ? Math.round(((delta!.cur - delta!.prev) / delta!.prev) * 1000) / 10 : null,
    },
    trend,
    ageing: [
      { label: '0–30 days', value: ageing!.d30 },
      { label: '31–60 days', value: ageing!.d60 },
      { label: '61–90 days', value: ageing!.d90 },
      { label: '90+ days', value: ageing!.d90plus },
    ],
    methods: methods.map((m) => ({ ...m, pct: Math.round((Number(m.amount) / totalMethods) * 100) })),
    byCampus,
    byHead,
    attention,
  };
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------
const AUDIENCE: Record<string, string> = {
  overdue30: `f.due_date < current_date - 30`,
  outstanding: `true`,
  due7: `f.due_date BETWEEN current_date AND current_date + 7`,
};

export async function reminderAudience(user: AuthUser, campusId?: string) {
  const w = new Where().add('s.deleted_at IS NULL').add(`s.status = 'active'`).add(`${BAL()} > 0`);
  studentScope(user, w);
  w.addIf(campusId, 's.campus_id = ?');
  return one(
    `SELECT count(DISTINCT s.id) FILTER (WHERE ${AUDIENCE.overdue30})::int AS overdue30,
            count(DISTINCT s.id)::int AS outstanding,
            count(DISTINCT s.id) FILTER (WHERE ${AUDIENCE.due7})::int AS due7,
            count(DISTINCT s.id) FILTER (WHERE f.due_date < current_date)::int AS overdue
       FROM student_fees f JOIN students s ON s.id = f.student_id ${w.sql}`, w.params);
}

const CHANNELS: Record<string, Channel[]> = { whatsapp_app: ['whatsapp', 'push'], whatsapp: ['whatsapp'], sms_app: ['sms', 'push'] };

export async function sendReminders(req: Request, input: any) {
  const w = new Where().add('s.deleted_at IS NULL').add(`s.status = 'active'`).add(`${BAL()} > 0`);
  studentScope(req.user!, w);
  if (input.studentIds) w.add('s.id = ANY(?)', input.studentIds);
  else w.add(AUDIENCE[input.audience]);
  w.addIf(input.campusId, 's.campus_id = ?');
  const students = await many<{ id: string; full_name: string; first_name: string; balance: number }>(
    `SELECT s.id, s.full_name, s.first_name, sum(${BAL()}) AS balance
       FROM student_fees f JOIN students s ON s.id = f.student_id ${w.sql}
      GROUP BY s.id ORDER BY s.full_name LIMIT 2000`, w.params);
  if (!students.length) throw badRequest('No outstanding accounts match this audience', 'EMPTY_AUDIENCE');
  return tx(async (db) => {
    let notifications = 0;
    for (const s of students) {
      const body = String(input.message).replace(/\{student\}/g, s.first_name).replace(/\{amount\}/g, inr(s.balance));
      const ids = await notifyGuardians(s.id, {
        category: 'Attention', topic: 'fees', icon: 'wallet', channels: CHANNELS[input.channel],
        title: `Fee reminder — ${inr(s.balance)} outstanding`, body, route: '/parent-360?tab=fees', entityType: 'student', entityId: s.id,
      }, db);
      notifications += ids.length;
    }
    await audit(req, {
      action: 'create', module: 'finance', entityType: 'fee_reminder',
      description: `Sent fee reminders for ${students.length} account(s) (${input.audience ?? 'selected students'})`,
      metadata: { students: students.length, notifications, channel: input.channel },
    }, db);
    return { students: students.length, notifications };
  });
}

// ---------------------------------------------------------------------------
// Concessions
// ---------------------------------------------------------------------------
const SCHOLARSHIP = `('Merit scholarship', 'Need-based support', 'Sports quota')`;

export async function concessionSummary(user: AuthUser, campusId?: string) {
  const w = new Where().add(`k.academic_year_id = ${YEAR}`);
  studentScope(user, w);
  w.addIf(campusId, 's.campus_id = ?');
  const [types, tuition, scholarships] = await Promise.all([
    many(
      `SELECT t.type, count(DISTINCT k.student_id) FILTER (WHERE k.status = 'Approved')::int AS students,
              COALESCE(sum(k.amount) FILTER (WHERE k.status = 'Approved'), 0) AS value,
              count(*) FILTER (WHERE k.status IN ('Submitted', 'Under Review'))::int AS pending
         FROM unnest(ARRAY['Sibling concession', 'Staff ward concession', 'Merit scholarship', 'Need-based support', 'Sports quota']) AS t(type)
         LEFT JOIN (concessions k JOIN students s ON s.id = k.student_id) ON k.concession_type = t.type AND ${w.sql.replace(/^WHERE /, '')}
        GROUP BY t.type ORDER BY array_position(ARRAY['Sibling concession', 'Staff ward concession', 'Merit scholarship', 'Need-based support', 'Sports quota'], t.type)`,
      w.params),
    one(
      `SELECT COALESCE(sum(f.amount_due), 0) AS tuition FROM student_fees f JOIN students s ON s.id = f.student_id
         JOIN fee_heads fh ON fh.id = f.fee_head_id
        WHERE fh.code = 'TUITION' AND f.academic_year_id = ${YEAR} ${campusId ? 'AND s.campus_id = $1' : ''}`, campusId ? [campusId] : []),
    one(
      `SELECT count(*) FILTER (WHERE k.status = 'Approved')::int AS awards,
              COALESCE(sum(k.amount) FILTER (WHERE k.status = 'Approved'), 0) AS value,
              count(*) FILTER (WHERE k.status IN ('Submitted', 'Under Review'))::int AS "underReview"
         FROM concessions k JOIN students s ON s.id = k.student_id
        ${w.sql} AND k.concession_type IN ${SCHOLARSHIP}`, w.params),
  ]);
  return { types, tuitionBilled: tuition!.tuition, scholarships };
}

const CONC_SORT: Record<string, string> = { date: 'k.created_at', student: 's.full_name', amount: 'k.amount', status: 'k.status', type: 'k.concession_type' };

export async function listConcessions(user: AuthUser, f: any) {
  const w = new Where().add(`k.academic_year_id = ${YEAR}`);
  studentScope(user, w);
  w.addIf(f.campusId, 's.campus_id = ?');
  w.addIf(f.status, 'k.status = ?');
  w.addIf(f.type, 'k.concession_type = ?');
  if (f.group === 'scholarship') w.add(`k.concession_type IN ${SCHOLARSHIP}`);
  if (f.q) w.add('(s.full_name ILIKE ? OR s.admission_no ILIKE ? OR k.reason ILIKE ?)', likeTerm(f.q), likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT k.id, k.concession_type AS type, k.percent, k.amount, k.status, k.reason, k.created_at AS "createdAt",
            k.approved_at AS "decidedAt", au.full_name AS "decidedBy", cu.full_name AS "requestedBy",
            s.id AS "studentId", s.full_name AS "studentName", s.admission_no AS "admissionNo", c.name AS grade, sec.name AS section,
            count(*) OVER() AS total
       FROM concessions k JOIN students s ON s.id = k.student_id
       LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
       LEFT JOIN users au ON au.id = k.approved_by LEFT JOIN users cu ON cu.id = k.created_by
       ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, CONC_SORT, 'date')}
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`, w.params);
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export async function createConcession(req: Request, input: any) {
  return tx(async (db) => {
    const year = await currentYear(db);
    const open = await one(
      `SELECT 1 FROM concessions WHERE student_id = $1 AND concession_type = $2 AND academic_year_id = $3 AND status IN ('Submitted', 'Under Review', 'Approved')`,
      [input.studentId, input.type, year.id], db);
    if (open) throw conflict('This student already has this concession requested or approved for the year', 'CONCESSION_EXISTS');
    let amount = input.amount ?? 0;
    if (input.percent != null) {
      const t = await one(
        `SELECT COALESCE(sum(f.amount_due), 0) AS tuition FROM student_fees f JOIN fee_heads fh ON fh.id = f.fee_head_id
          WHERE f.student_id = $1 AND f.academic_year_id = $2 AND fh.code = 'TUITION'`, [input.studentId, year.id], db);
      amount = Math.round(Number(t!.tuition) * input.percent) / 100;
    }
    const row = await one(
      `INSERT INTO concessions (student_id, concession_type, percent, amount, academic_year_id, status, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,'Submitted',$6,$7) RETURNING id, status, amount`,
      [input.studentId, input.type, input.percent ?? null, amount, year.id, input.reason, req.user!.id], db);
    await audit(req, { action: 'create', module: 'finance', entityType: 'concession', entityId: row!.id, description: `Requested ${input.type} of ${inr(amount)}`, metadata: { studentId: input.studentId } }, db);
    return row;
  });
}

/**
 * Approving a concession reduces what the family owes: the value is spread
 * over the student's outstanding charges (tuition first, latest due first),
 * never below what has already been paid. The applied value is recorded.
 */
export async function decideConcession(req: Request, id: string, decision: 'Approved' | 'Rejected', reason?: string) {
  return tx(async (db) => {
    const k = await one('SELECT * FROM concessions WHERE id = $1 FOR UPDATE', [id], db);
    if (!k) throw notFound('Concession not found');
    if (!['Submitted', 'Under Review'].includes(k.status)) throw conflict(`This concession is already ${k.status}`, 'INVALID_STATE');
    let applied = 0;
    if (decision === 'Approved') {
      const lines = await many<{ id: string; balance: number }>(
        `SELECT f.id, ${BAL()} AS balance FROM student_fees f JOIN fee_heads fh ON fh.id = f.fee_head_id
          WHERE f.student_id = $1 AND f.academic_year_id = $2 AND ${BAL()} > 0
          ORDER BY (fh.code = 'TUITION') DESC, f.due_date DESC FOR UPDATE OF f`,
        [k.student_id, k.academic_year_id], db);
      let remaining = toPaise(k.amount);
      for (const l of lines) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, toPaise(l.balance));
        remaining -= take;
        applied += take;
        await query(
          `UPDATE student_fees SET concession_amount = concession_amount + $2,
                  status = CASE WHEN amount_paid >= amount_due - concession_amount - $2 THEN 'Paid'
                                WHEN amount_paid > 0 THEN (CASE WHEN due_date < current_date THEN 'Overdue' ELSE 'Partial' END)
                                ELSE status END
            WHERE id = $1`, [l.id, fromPaise(take)], db);
      }
      if (!applied) throw badRequest('The student has no outstanding charges to apply this concession to', 'NOTHING_TO_APPLY');
      applied = fromPaise(applied);
    }
    const row = await one(
      `UPDATE concessions SET status = $2, approved_by = $3, approved_at = now(),
              amount = CASE WHEN $2 = 'Approved' THEN $4::numeric ELSE amount END,
              reason = CASE WHEN $5::text IS NULL THEN reason ELSE COALESCE(reason, '') || ' — Decision: ' || $5 END
        WHERE id = $1 RETURNING id, status, amount`,
      [id, decision, req.user!.id, applied, reason ?? null], db);
    await audit(req, {
      action: decision === 'Approved' ? 'approve' : 'reject', module: 'finance', entityType: 'concession', entityId: id,
      description: decision === 'Approved' ? `Approved ${k.concession_type}; ${inr(applied)} applied to the student account` : `Rejected ${k.concession_type}: ${reason}`,
    }, db);
    await notifyGuardians(k.student_id, {
      category: decision === 'Approved' ? 'Completed' : 'Information', topic: 'fees', icon: 'percent',
      title: decision === 'Approved' ? `${k.concession_type} approved — ${inr(applied)}` : `${k.concession_type} request was not approved`,
      route: '/parent-360?tab=fees', entityType: 'concession', entityId: id, channels: ['push'],
    }, db);
    return row;
  });
}

export async function reviewConcession(req: Request, id: string) {
  const row = await one(`UPDATE concessions SET status = 'Under Review' WHERE id = $1 AND status = 'Submitted' RETURNING id, status`, [id]);
  if (!row) throw conflict('Only submitted concessions can be moved to review', 'INVALID_STATE');
  await audit(req, { action: 'update', module: 'finance', entityType: 'concession', entityId: id, description: 'Concession moved to review' });
  return row;
}

// ---------------------------------------------------------------------------
// Family (Parent 360) — own children only
// ---------------------------------------------------------------------------
export async function familyFees(studentId: string) {
  const [s, lines, payments] = await Promise.all([
    feeSummary(studentId),
    many(`${LINE_SQL} WHERE f.student_id = $1 AND f.academic_year_id = ${YEAR} ORDER BY f.due_date, fh.name`, [studentId]),
    many(`SELECT p.id, p.receipt_no AS "receiptNo", p.amount, p.method, p.paid_at AS "paidAt", p.status
            FROM fee_payments p WHERE p.student_id = $1 ORDER BY p.paid_at DESC`, [studentId]),
  ]);
  return {
    summary: { billed: s!.billed, paid: s!.paid, outstanding: s!.outstanding, nextDue: s!.nextDue ? { date: s!.nextDue, amount: s!.nextDueAmount } : null },
    lines: lines.map((l) => ({
      id: l.id, description: l.description, head: l.head, amountDue: l.amountDue, concession: l.concession,
      amountPaid: l.amountPaid, balance: l.balance, dueDate: l.dueDate, status: l.status,
    })),
    payments,
  };
}

export async function familyPay(req: Request, studentId: string, input: { amount: number; method: string; feeIds?: string[] }) {
  // SIMULATED GATEWAY: no payment provider is integrated yet. We treat the
  // charge as successful and generate a clearly-marked simulated reference.
  const gatewayRef = `SIM-${randomBytes(6).toString('hex').toUpperCase()}`;
  const receipt = await tx((db) => recordPayment(req, db, {
    studentId, amount: input.amount, method: input.method, feeIds: input.feeIds,
    gatewayRef, paidByParentId: req.user!.parentId,
  }));
  return { ...receipt, simulated: true };
}

export async function familyReceipt(parentId: string, paymentId: string) {
  const own = await one(
    `SELECT 1 FROM fee_payments p JOIN student_guardians sg ON sg.student_id = p.student_id
      WHERE p.id = $1 AND sg.parent_id = $2`, [paymentId, parentId]);
  if (!own) throw notFound('Receipt not found', 'RECEIPT_NOT_FOUND');
  return getReceipt(paymentId);
}
