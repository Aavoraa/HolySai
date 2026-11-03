import type { Request } from 'express';
import { many, one, query, tx } from '../config/db.js';
import { Where } from '../utils/sql.js';
import { likeTerm, limitOffset, orderBy, type Pagination } from '../utils/pagination.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { nextCode } from '../utils/codes.js';
import { audit } from './audit.service.js';
import { openStoredFile, safeFilename, verifyUploadedFile } from './documents.service.js';

/** "Today" in the school timezone, for SQL. A trusted constant, never user input. */
export const TODAY = `(now() AT TIME ZONE 'Asia/Kolkata')::date`;
export const MONTH_START = `date_trunc('month', ${TODAY})::date`;

export function todayKolkata() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Employees that count as the current workforce. */
export const ACTIVE = `e.deleted_at IS NULL AND e.employment_status <> 'exited'`;

/**
 * Row shape for every employee list (directory, teaching, non-teaching).
 * Derived values come from transactional tables:
 *   today        — today's staff_attendance status (or 'Not marked')
 *   leaveBalance — entitled − used across leave types for the current year
 *   overtime     — hours claimed this month (not rejected)
 */
export const EMPLOYEE_ROW_SQL = `
  SELECT e.id, e.employee_code AS code, e.full_name AS "fullName", e.gender, e.phone, e.email,
         e.campus_id AS "campusId", cp.short_name AS "campusName", cp.code AS "campusCode",
         e.department, e.designation, e.employee_type AS "employeeType", e.category,
         e.shift_name AS shift, e.join_date AS "joinDate", e.employment_status AS "employmentStatus",
         e.workload_periods AS workload, e.cpd_hours AS cpd, e.background_verified AS "backgroundVerified",
         (e.user_id IS NOT NULL) AS "hasAccount",
         COALESCE(sa.status, 'Not marked') AS today, to_char(sa.check_in, 'HH24:MI') AS "checkIn",
         to_char(sa.check_out, 'HH24:MI') AS "checkOut",
         COALESCE(lb.balance, 0)::float AS "leaveBalance", COALESCE(lb.entitled, 0)::float AS "leaveEntitled",
         COALESCE(ot.hours, 0)::float AS overtime
    FROM employees e
    JOIN campuses cp ON cp.id = e.campus_id
    LEFT JOIN staff_attendance sa ON sa.employee_id = e.id AND sa.attendance_date = ${TODAY}
    LEFT JOIN LATERAL (
      SELECT sum(b.entitled - b.used) AS balance, sum(b.entitled) AS entitled
        FROM leave_balances b JOIN academic_years ay ON ay.id = b.academic_year_id AND ay.is_current
       WHERE b.employee_id = e.id) lb ON true
    LEFT JOIN LATERAL (
      SELECT sum(o.hours) AS hours FROM overtime_entries o
       WHERE o.employee_id = e.id AND o.work_date >= ${MONTH_START} AND o.status <> 'Rejected') ot ON true`;

const SORTS: Record<string, string> = {
  name: 'e.full_name',
  code: 'e.employee_code',
  category: 'e.category',
  department: 'e.department',
  shift: 'e.shift_name',
  today: `COALESCE(sa.status, 'Not marked')`,
  leaveBalance: 'lb.balance',
  overtime: 'ot.hours',
  workload: 'e.workload_periods',
  cpd: 'e.cpd_hours',
  campus: 'cp.short_name',
};

export interface EmployeeFilters extends Pagination {
  campusId?: string; employeeType?: string; department?: string; category?: string; today?: string; employmentStatus?: string;
}

export async function listEmployees(f: EmployeeFilters) {
  const w = new Where();
  w.add('e.deleted_at IS NULL');
  if (f.employmentStatus) w.add('e.employment_status = ?', f.employmentStatus);
  else w.add(`e.employment_status <> 'exited'`);
  w.addIf(f.campusId, 'e.campus_id = ?');
  w.addIf(f.employeeType, 'e.employee_type = ?');
  w.addIf(f.department, 'e.department = ?');
  w.addIf(f.category, 'e.category = ?');
  w.addIf(f.today, `COALESCE(sa.status, 'Not marked') = ?`);
  if (f.q) w.add('(e.full_name ILIKE ? OR e.employee_code ILIKE ? OR e.designation ILIKE ?)', likeTerm(f.q), likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `${EMPLOYEE_ROW_SQL.replace('SELECT e.id,', 'SELECT count(*) OVER() AS total, e.id,')}
      ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, SORTS, 'name')}, e.full_name
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export async function departments(campusId?: string) {
  const w = new Where().add(ACTIVE);
  w.addIf(campusId, 'e.campus_id = ?');
  const rows = await many<{ department: string }>(`SELECT DISTINCT e.department FROM employees e ${w.sql} ORDER BY 1`, w.params);
  return rows.map((r) => r.department);
}

/** Workforce 360 dashboard figures (also used by the teaching / non-teaching pages). */
export async function workforceSummary(campusId?: string, employeeType?: string) {
  const w = new Where().add(ACTIVE);
  w.addIf(campusId, 'e.campus_id = ?');
  w.addIf(employeeType, 'e.employee_type = ?');
  const scope = `SELECT e.id FROM employees e ${w.sql}`;
  const p = w.params;

  const [counts, categories, overtime, pending, cpd, uncovered, recentJoiners, runs, depts] = await Promise.all([
    one(`SELECT count(*)::int AS total,
                count(*) FILTER (WHERE e.employee_type = 'teaching')::int AS teaching,
                count(*) FILTER (WHERE e.employee_type = 'non_teaching')::int AS "nonTeaching",
                count(*) FILTER (WHERE sa.status = 'Present')::int AS present,
                count(*) FILTER (WHERE sa.status = 'Absent')::int AS absent,
                count(*) FILTER (WHERE sa.status = 'On Leave')::int AS leave,
                count(*) FILTER (WHERE sa.status = 'Late')::int AS late,
                count(*) FILTER (WHERE sa.status = 'Half Day')::int AS "halfDay",
                count(*) FILTER (WHERE sa.status IS NULL)::int AS "notMarked",
                round(avg(NULLIF(e.workload_periods, 0)) FILTER (WHERE e.category = 'Teachers'))::int AS "avgWorkload"
           FROM employees e
           LEFT JOIN staff_attendance sa ON sa.employee_id = e.id AND sa.attendance_date = ${TODAY}
          ${w.sql}`, p),
    many(`SELECT e.category AS label, count(*)::int AS value FROM employees e ${w.sql} GROUP BY e.category ORDER BY count(*) DESC`, p),
    one(`SELECT COALESCE(sum(o.hours), 0)::float AS hours,
                COALESCE(sum(o.hours) FILTER (WHERE o.status IN ('Approved', 'Paid')), 0)::float AS approved,
                COALESCE(sum(o.hours) FILTER (WHERE o.status IN ('Submitted', 'Under Review')), 0)::float AS pending
           FROM overtime_entries o WHERE o.employee_id IN (${scope}) AND o.work_date >= ${MONTH_START} AND o.status <> 'Rejected'`, p),
    one(`SELECT (SELECT count(*) FROM leave_requests l WHERE l.employee_id IN (${scope}) AND l.status IN ('Submitted', 'Under Review'))::int AS leave,
                (SELECT count(*) FROM overtime_entries o WHERE o.employee_id IN (${scope}) AND o.status IN ('Submitted', 'Under Review'))::int AS overtime,
                (SELECT count(*) FROM allowances a WHERE a.employee_id IN (${scope}) AND a.status = 'Submitted')::int AS allowances,
                (SELECT count(*) FROM reimbursements r WHERE r.employee_id IN (${scope}) AND r.status IN ('Submitted', 'Under Review'))::int AS reimbursements`, p),
    one(`SELECT COALESCE(sum(c.hours) FILTER (WHERE c.status = 'Completed'), 0)::int AS hours
           FROM cpd_records c WHERE c.employee_id IN (${scope})`, p),
    one(`SELECT count(*)::int AS n FROM shift_rosters r WHERE r.employee_id IN (${scope}) AND r.roster_date = ${TODAY} AND r.status = 'Cover needed'`, p),
    one(`SELECT count(*)::int AS n FROM employees e ${w.sql} AND e.join_date >= ${TODAY} - 365`, p),
    many(`SELECT r.pay_month AS "payMonth", r.status FROM payroll_runs r
           WHERE ($1::uuid IS NULL OR r.campus_id = $1) ORDER BY r.pay_month DESC, r.created_at DESC LIMIT 3`, [campusId ?? null]),
    departments(campusId),
  ]);
  const payrollPending = pending!.leave + pending!.overtime + pending!.allowances + pending!.reimbursements;
  const latest = runs[0] ?? null;
  return {
    kpis: {
      ...counts,
      overtimeHours: overtime!.hours,
      overtimeApproved: overtime!.approved,
      overtimePending: overtime!.pending,
      payrollPending,
      cpdHours: cpd!.hours,
      openLeave: pending!.leave,
      uncoveredToday: uncovered!.n,
    },
    pending,
    categories,
    departments: depts,
    journey: {
      joinedThisYear: recentJoiners!.n,
      active: counts!.total,
      openLeave: pending!.leave,
      overtimeHours: overtime!.hours,
      pendingApprovals: payrollPending,
      currentRun: latest,
    },
  };
}

// ---------------------------------------------------------------------------
// Employee profile (the full journey)
// ---------------------------------------------------------------------------
export async function getEmployeeProfile(id: string, opts: { payroll: boolean }) {
  const base = await one(
    `${EMPLOYEE_ROW_SQL.replace('SELECT e.id,', `SELECT e.basic_salary AS "basicSalary", e.bank_account_masked AS "bankAccount",
            e.date_of_birth AS "dateOfBirth", cp.name AS "campusFullName",
            t.qualification, t.specialisation, t.is_mentor AS "isMentor", t.max_periods_week AS "maxPeriodsWeek",
            n.staff_category AS "staffCategory", n.licence_no_masked AS "licenceNoMasked", n.licence_expiry AS "licenceExpiry", e.id,`)}
       LEFT JOIN teachers t ON t.employee_id = e.id
       LEFT JOIN non_teaching_staff n ON n.employee_id = e.id
      WHERE e.id = $1 AND e.deleted_at IS NULL`,
    [id],
  );
  if (!base) throw notFound('Employee not found', 'EMPLOYEE_NOT_FOUND');
  if (!opts.payroll) { delete base.basicSalary; delete base.bankAccount; }

  const [attendance, recentAttendance, leaveBalances, leaveRequests, overtime, allowances, cpd, documents, roster, payslips, pendingApprovals] = await Promise.all([
    one(`SELECT count(*)::int AS marked,
                count(*) FILTER (WHERE status IN ('Present', 'Late', 'Half Day'))::int AS present,
                count(*) FILTER (WHERE status = 'Late')::int AS late,
                count(*) FILTER (WHERE status = 'Absent')::int AS absent,
                count(*) FILTER (WHERE status = 'On Leave')::int AS leave,
                round(100.0 * count(*) FILTER (WHERE status IN ('Present', 'Late', 'Half Day', 'On Leave')) / NULLIF(count(*), 0))::int AS pct
           FROM staff_attendance WHERE employee_id = $1 AND attendance_date >= ${MONTH_START}`, [id]),
    many(`SELECT attendance_date AS date, status, to_char(check_in, 'HH24:MI') AS "checkIn", to_char(check_out, 'HH24:MI') AS "checkOut", source
            FROM staff_attendance WHERE employee_id = $1 ORDER BY attendance_date DESC LIMIT 14`, [id]),
    leaveBalancesFor(id),
    many(`SELECT l.id, l.code, lt.name AS type, l.from_date AS "fromDate", l.to_date AS "toDate", l.days::float AS days, l.status
            FROM leave_requests l JOIN leave_types lt ON lt.id = l.leave_type_id
           WHERE l.employee_id = $1 ORDER BY l.from_date DESC LIMIT 6`, [id]),
    many(`SELECT id, work_date AS "workDate", hours::float AS hours, reason, rate_per_hour::float AS rate, status
            FROM overtime_entries WHERE employee_id = $1 ORDER BY work_date DESC LIMIT 6`, [id]),
    many(`SELECT id, allowance_type AS type, amount::float AS amount, frequency, effective_month AS "effectiveMonth", status
            FROM allowances WHERE employee_id = $1 ORDER BY status, allowance_type`, [id]),
    many(`SELECT id, programme, provider, hours, completed_on AS "completedOn", status
            FROM cpd_records WHERE employee_id = $1 ORDER BY completed_on DESC NULLS FIRST`, [id]),
    many(`SELECT id, name, category, status, verified_at AS "verifiedAt", requested_on AS "requestedOn", (storage_key IS NOT NULL) AS "hasFile"
            FROM documents WHERE employee_id = $1 AND deleted_at IS NULL ORDER BY created_at, name`, [id]),
    many(`SELECT r.id, r.roster_date AS date, r.post, r.status, s.name AS shift, c.full_name AS "coveredBy"
            FROM shift_rosters r JOIN shifts s ON s.id = r.shift_id LEFT JOIN employees c ON c.id = r.covered_by
           WHERE r.employee_id = $1 AND r.roster_date BETWEEN ${TODAY} - 6 AND ${TODAY} + 7 ORDER BY r.roster_date`, [id]),
    opts.payroll
      ? many(`SELECT p.id, r.pay_month AS "payMonth", p.gross::float AS gross, p.net::float AS net, p.status, r.status AS "runStatus"
                FROM payslips p JOIN payroll_runs r ON r.id = p.payroll_run_id
               WHERE p.employee_id = $1 ORDER BY r.pay_month DESC LIMIT 6`, [id])
      : Promise.resolve([]),
    one(`SELECT ((SELECT count(*) FROM leave_requests WHERE employee_id = $1 AND status IN ('Submitted', 'Under Review'))
               + (SELECT count(*) FROM overtime_entries WHERE employee_id = $1 AND status IN ('Submitted', 'Under Review'))
               + (SELECT count(*) FROM allowances WHERE employee_id = $1 AND status = 'Submitted'))::int AS n`, [id]),
  ]);

  const latestSlip = payslips[0] as { payMonth: string; status: string; runStatus: string } | undefined;
  const docsDone = documents.filter((d) => d.status === 'Verified').length;
  const journey = [
    { label: 'Recruitment', meta: base.joinDate ? `Joined ${base.joinDate.slice(0, 7)}` : 'Join date not recorded', state: 'done' },
    { label: 'Profile', meta: documents.length && docsDone === documents.length ? 'Complete' : `${docsDone} of ${documents.length} documents verified`, state: 'done' },
    { label: 'Attendance', meta: base.today, state: 'done' },
    { label: 'Leave', meta: `${base.leaveBalance} days left`, state: 'done' },
    { label: 'Overtime', meta: `${base.overtime} hours`, state: 'done' },
    { label: 'Approval', meta: pendingApprovals!.n ? `${pendingApprovals!.n} pending` : 'Nothing pending', state: pendingApprovals!.n ? 'active' : 'done' },
    { label: 'Payroll', meta: latestSlip ? `${latestSlip.runStatus} run` : opts.payroll ? 'No run yet' : 'Restricted', state: latestSlip && ['Released', 'Paid'].includes(latestSlip.runStatus) ? 'done' : undefined },
    { label: 'Payslip', meta: latestSlip ? (latestSlip.status === 'Released' ? 'Released' : 'Not released') : '—', state: latestSlip?.status === 'Released' ? 'done' : undefined },
  ];
  // What a teacher teaches this year (teacher profile).
  const teaching = base.employeeType === 'teaching'
    ? await many(
      `SELECT c.name || sec.name AS section, sub.name AS subject, ta.periods_per_week AS periods, (sec.class_teacher_id = ta.employee_id) AS "classTeacher"
         FROM teacher_assignments ta JOIN sections sec ON sec.id = ta.section_id JOIN classes c ON c.id = sec.class_id
         JOIN subjects sub ON sub.id = ta.subject_id JOIN academic_years ay ON ay.id = ta.academic_year_id AND ay.is_current
        WHERE ta.employee_id = $1 ORDER BY c.grade_level, sec.name, sub.name`, [id])
    : [];
  return { employee: base, journey, attendance, recentAttendance, leaveBalances, leaveRequests, overtime, allowances, cpd, documents, roster, payslips, teaching };
}

// ---------------------------------------------------------------------------
// Employee documents (qualification certificates, ID, contract …) — HR uploads
// a scan, either for a requested item on the checklist or as a new document.
// ---------------------------------------------------------------------------
export async function uploadEmployeeDocument(req: Request, employeeId: string, file: Express.Multer.File | undefined,
  b: { name?: string; category?: string; documentId?: string }) {
  if (!file) throw badRequest('Attach a file in the "file" field', 'FILE_REQUIRED', [{ field: 'file', message: 'Choose a file' }]);
  const emp = await one<{ full_name: string }>('SELECT full_name FROM employees WHERE id = $1 AND deleted_at IS NULL', [employeeId]);
  if (!emp) throw notFound('Employee not found', 'EMPLOYEE_NOT_FOUND');
  const stored = await verifyUploadedFile(file);
  const u = req.user!;
  let id: string;
  if (b.documentId) {
    const row = await one<{ id: string; name: string }>(
      `UPDATE documents SET storage_key = $3, original_name = $4, mime_type = $5, size_bytes = $6, checksum_sha256 = $7,
              status = 'Verified', verified_by = $8, verified_at = now(), uploaded_by = $8
        WHERE id = $1 AND employee_id = $2 AND deleted_at IS NULL RETURNING id, name`,
      [b.documentId, employeeId, stored.storageKey, safeFilename(file.originalname), file.mimetype, stored.size, stored.checksum, u.id]);
    if (!row) throw notFound('Document not found on this employee', 'DOCUMENT_NOT_FOUND');
    id = row.id;
    b.name = row.name;
  } else {
    if (!b.name || b.name.trim().length < 2) throw badRequest('Name the document', 'VALIDATION_ERROR', [{ field: 'name', message: 'Name the document' }]);
    const row = await one<{ id: string }>(
      `INSERT INTO documents (owner_type, owner_id, employee_id, name, category, status, storage_key, original_name, mime_type, size_bytes,
                              checksum_sha256, uploaded_by, verified_by, verified_at)
       VALUES ('employee', $1, $1, $2, $3, 'Verified', $4, $5, $6, $7, $8, $9, $9, now()) RETURNING id`,
      [employeeId, b.name.trim(), b.category || 'Qualification certificate', stored.storageKey, safeFilename(file.originalname), file.mimetype,
        stored.size, stored.checksum, u.id]);
    id = row!.id;
  }
  await audit(req, { action: 'create', module: 'workforce', description: `Uploaded "${b.name}" for ${emp.full_name}`, entityType: 'document', entityId: id, metadata: { employeeId } });
  return { id };
}

export async function openEmployeeDocument(req: Request, employeeId: string, documentId: string) {
  const d = await one<{ id: string; storage_key: string | null; original_name: string | null; mime_type: string | null; name: string }>(
    'SELECT id, storage_key, original_name, mime_type, name FROM documents WHERE id = $1 AND employee_id = $2 AND deleted_at IS NULL', [documentId, employeeId]);
  if (!d || !d.storage_key) throw notFound('Document not found');
  const stream = await openStoredFile(d.storage_key);
  if (!stream) throw notFound('File is no longer available');
  await audit(req, { action: 'view', module: 'workforce', description: `Downloaded "${d.name}"`, entityType: 'document', entityId: d.id, metadata: { employeeId } });
  return { stream, name: safeFilename(d.original_name ?? d.name), mimeType: d.mime_type ?? 'application/octet-stream' };
}

export async function leaveBalancesFor(employeeId: string, db?: any) {
  return many(
    `SELECT lt.id AS "leaveTypeId", lt.name AS type, COALESCE(b.entitled, lt.annual_quota)::float AS entitled,
            COALESCE(b.used, 0)::float AS used, (COALESCE(b.entitled, lt.annual_quota) - COALESCE(b.used, 0))::float AS balance
       FROM leave_types lt
       LEFT JOIN leave_balances b ON b.leave_type_id = lt.id AND b.employee_id = $1
        AND b.academic_year_id = (SELECT id FROM academic_years WHERE is_current)
      ORDER BY lt.annual_quota DESC, lt.name`,
    [employeeId], db,
  );
}

// ---------------------------------------------------------------------------
// Create / update / soft delete
// ---------------------------------------------------------------------------
const EMP_COLS: Record<string, string> = {
  fullName: 'full_name', gender: 'gender', dateOfBirth: 'date_of_birth', phone: 'phone', email: 'email', campusId: 'campus_id',
  department: 'department', designation: 'designation', employeeType: 'employee_type', category: 'category', shiftName: 'shift_name',
  joinDate: 'join_date', employmentStatus: 'employment_status', basicSalary: 'basic_salary', bankAccountMasked: 'bank_account_masked',
  workloadPeriods: 'workload_periods', backgroundVerified: 'background_verified',
};

async function assertShift(name: string | null | undefined, db: any) {
  if (!name) return;
  const s = await one('SELECT 1 FROM shifts WHERE name = $1', [name], db);
  if (!s) throw badRequest('Unknown shift', 'VALIDATION_ERROR', [{ field: 'shiftName', message: 'Choose an existing shift' }]);
}

async function upsertTypeDetails(id: string, type: string, input: any, db: any) {
  if (type === 'teaching') {
    await query('DELETE FROM non_teaching_staff WHERE employee_id = $1', [id], db);
    await query(
      `INSERT INTO teachers (employee_id, qualification, specialisation, max_periods_week)
       VALUES ($1, $2, $3, COALESCE($4, 27))
       ON CONFLICT (employee_id) DO UPDATE SET
         qualification = COALESCE($2, teachers.qualification),
         specialisation = COALESCE($3, teachers.specialisation),
         max_periods_week = COALESCE($4, teachers.max_periods_week)`,
      [id, input.qualification ?? null, input.specialisation ?? null, input.maxPeriodsWeek ?? null], db,
    );
  } else {
    await query('DELETE FROM teachers WHERE employee_id = $1', [id], db);
    await query(
      `INSERT INTO non_teaching_staff (employee_id, staff_category, licence_no_masked, licence_expiry)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (employee_id) DO UPDATE SET
         staff_category = COALESCE($2, non_teaching_staff.staff_category),
         licence_no_masked = COALESCE($3, non_teaching_staff.licence_no_masked),
         licence_expiry = COALESCE($4, non_teaching_staff.licence_expiry)`,
      [id, input.category ?? null, input.licenceNoMasked ?? null, input.licenceExpiry ?? null], db,
    );
  }
}

export async function createEmployee(req: Request, input: any) {
  return tx(async (db) => {
    await assertShift(input.shiftName, db);
    const campus = await one('SELECT 1 FROM campuses WHERE id = $1', [input.campusId], db);
    if (!campus) throw badRequest('Campus not found', 'CAMPUS_NOT_FOUND');
    const code = await nextCode('employees', 'employee_code', 'EMP-', db);
    const e = await one<{ id: string }>(
      `INSERT INTO employees (employee_code, full_name, gender, date_of_birth, phone, email, campus_id, department, designation,
                              employee_type, category, shift_name, join_date, employment_status, basic_salary, bank_account_masked,
                              workload_periods, background_verified, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13::date, ${TODAY}),$14,$15,$16,$17,$18,$19,$19) RETURNING id`,
      [code, input.fullName, input.gender ?? null, input.dateOfBirth ?? null, input.phone ?? null, input.email ?? null, input.campusId,
        input.department, input.designation, input.employeeType, input.category, input.shiftName ?? null, input.joinDate ?? null,
        input.employmentStatus ?? 'active', input.basicSalary, input.bankAccountMasked ?? null, input.workloadPeriods ?? 0,
        input.backgroundVerified ?? false, req.user!.id],
      db,
    );
    await upsertTypeDetails(e!.id, input.employeeType, input, db);
    // Leave entitlement for the current year
    await query(
      `INSERT INTO leave_balances (employee_id, leave_type_id, academic_year_id, entitled)
       SELECT $1, lt.id, ay.id, lt.annual_quota FROM leave_types lt CROSS JOIN academic_years ay WHERE ay.is_current
       ON CONFLICT DO NOTHING`,
      [e!.id], db,
    );
    // Onboarding checklist
    await query(
      `INSERT INTO documents (owner_type, owner_id, employee_id, name, category, status, requested_on, uploaded_by)
       SELECT 'employee', $1, $1, d.name, d.category, 'Pending', ${TODAY}, $2
         FROM (VALUES ('Employment contract', 'Contract'), ('Identity proof', 'Identity'), ('Qualification certificates', 'Qualification'),
                      ('Background verification', 'Compliance'), ('Child-protection training', 'Compliance')) AS d(name, category)`,
      [e!.id, req.user!.id], db,
    );
    await audit(req, { action: 'create', module: 'workforce', description: `Created employee ${input.fullName} (${code})`, entityType: 'employee', entityId: e!.id }, db);
    return { id: e!.id, code };
  });
}

export async function updateEmployee(req: Request, id: string, input: Record<string, any>) {
  return tx(async (db) => {
    const before = await one('SELECT * FROM employees WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id], db);
    if (!before) throw notFound('Employee not found', 'EMPLOYEE_NOT_FOUND');
    if (input.shiftName !== undefined) await assertShift(input.shiftName, db);
    const sets: string[] = [];
    const params: unknown[] = [];
    const changed: string[] = [];
    for (const [k, val] of Object.entries(input)) {
      const col = EMP_COLS[k];
      if (!col || val === undefined) continue;
      params.push(val);
      sets.push(`${col} = $${params.length}`);
      if (String(before[col] ?? '') !== String(val ?? '')) changed.push(k);
    }
    const typeKeys = ['qualification', 'specialisation', 'maxPeriodsWeek', 'licenceNoMasked', 'licenceExpiry', 'category', 'employeeType'];
    if (!sets.length && !typeKeys.some((k) => input[k] !== undefined)) throw badRequest('Nothing to update');
    if (sets.length) {
      params.push(req.user!.id, id);
      await query(`UPDATE employees SET ${sets.join(', ')}, updated_by = $${params.length - 1} WHERE id = $${params.length}`, params, db);
    }
    const type = input.employeeType ?? before.employee_type;
    if (typeKeys.some((k) => input[k] !== undefined)) {
      await upsertTypeDetails(id, type, { ...input, category: input.category ?? before.category }, db);
    }
    await audit(req, {
      action: 'update', module: 'workforce', entityType: 'employee', entityId: id, metadata: { changed },
      description: `Updated employee ${before.employee_code}${changed.length ? ` (${changed.join(', ')})` : ''}`,
    }, db);
  });
}

export async function archiveEmployee(req: Request, id: string) {
  if (req.user!.employeeId === id) throw badRequest('You cannot remove your own employee record', 'SELF_DELETE');
  const r = await one<{ employee_code: string; full_name: string }>(
    `UPDATE employees SET deleted_at = now(), employment_status = 'exited', updated_by = $2
      WHERE id = $1 AND deleted_at IS NULL RETURNING employee_code, full_name`,
    [id, req.user!.id],
  );
  if (!r) throw notFound('Employee not found', 'EMPLOYEE_NOT_FOUND');
  await query(`DELETE FROM shift_rosters WHERE employee_id = $1 AND roster_date >= ${TODAY}`, [id]);
  await audit(req, { action: 'delete', module: 'workforce', description: `Archived employee ${r.full_name} (${r.employee_code})`, entityType: 'employee', entityId: id });
}

// ---------------------------------------------------------------------------
// Staff attendance
// ---------------------------------------------------------------------------
export interface AttendanceFilters extends Pagination {
  date?: string; campusId?: string; employeeType?: string; department?: string; status?: string;
}

const ATT_SORTS: Record<string, string> = {
  name: 'e.full_name', shift: 'e.shift_name', department: 'e.department', status: `COALESCE(sa.status, 'Not marked')`, checkIn: 'sa.check_in',
};

export async function attendanceRegister(f: AttendanceFilters) {
  const day = f.date ?? todayKolkata();
  const w = new Where();
  w.add(ACTIVE);
  w.addIf(f.campusId, 'e.campus_id = ?');
  w.addIf(f.employeeType, 'e.employee_type = ?');
  w.addIf(f.department, 'e.department = ?');
  w.addIf(f.status, `COALESCE(sa.status, 'Not marked') = ?`);
  if (f.q) w.add('(e.full_name ILIKE ? OR e.employee_code ILIKE ?)', likeTerm(f.q), likeTerm(f.q));
  const dayP = w.param(day);
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT count(*) OVER() AS total, e.id, e.employee_code AS code, e.full_name AS "fullName", e.designation, e.department,
            e.employee_type AS "employeeType", e.shift_name AS shift, cp.short_name AS "campusName",
            sa.id AS "attendanceId", COALESCE(sa.status, 'Not marked') AS status, to_char(sa.check_in, 'HH24:MI') AS "checkIn",
            to_char(sa.check_out, 'HH24:MI') AS "checkOut", sa.source,
            ro.id AS "rosterId", ro.post, ro.status AS "rosterStatus", cov.full_name AS "coveredBy"
       FROM employees e
       JOIN campuses cp ON cp.id = e.campus_id
       LEFT JOIN staff_attendance sa ON sa.employee_id = e.id AND sa.attendance_date = ${dayP}::date
       LEFT JOIN shift_rosters ro ON ro.employee_id = e.id AND ro.roster_date = ${dayP}::date
       LEFT JOIN employees cov ON cov.id = ro.covered_by
      ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, ATT_SORTS, 'name')}, e.full_name
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export async function attendanceSummary(date: string | undefined, campusId?: string) {
  const day = date ?? todayKolkata();
  const w = new Where().add(ACTIVE);
  w.addIf(campusId, 'e.campus_id = ?');
  const dayP = w.param(day);
  const p = w.params;
  const [counts, byShift, byDepartment, trend, months] = await Promise.all([
    one(`SELECT count(*)::int AS total,
                count(*) FILTER (WHERE sa.status = 'Present')::int AS present,
                count(*) FILTER (WHERE sa.status = 'Absent')::int AS absent,
                count(*) FILTER (WHERE sa.status = 'On Leave')::int AS leave,
                count(*) FILTER (WHERE sa.status = 'Late')::int AS late,
                count(*) FILTER (WHERE sa.status = 'Half Day')::int AS "halfDay",
                count(*) FILTER (WHERE sa.status IS NULL)::int AS "notMarked"
           FROM employees e LEFT JOIN staff_attendance sa ON sa.employee_id = e.id AND sa.attendance_date = ${dayP}::date
          ${w.sql}`, p),
    many(`SELECT COALESCE(e.shift_name, 'Unassigned') AS shift, count(*)::int AS expected,
                 count(*) FILTER (WHERE sa.status IN ('Present', 'Late', 'Half Day'))::int AS present,
                 count(*) FILTER (WHERE sa.status = 'On Leave')::int AS leave,
                 count(*) FILTER (WHERE sa.status = 'Absent')::int AS absent,
                 count(*) FILTER (WHERE ro.status = 'Cover needed')::int AS uncovered
            FROM employees e
            LEFT JOIN staff_attendance sa ON sa.employee_id = e.id AND sa.attendance_date = ${dayP}::date
            LEFT JOIN shift_rosters ro ON ro.employee_id = e.id AND ro.roster_date = ${dayP}::date
           ${w.sql} GROUP BY 1 ORDER BY count(*) DESC`, p),
    many(`SELECT e.department AS label,
                 round(100.0 * count(*) FILTER (WHERE sa.status IN ('Present', 'Late', 'Half Day'))
                       / NULLIF(count(*) FILTER (WHERE sa.status <> 'On Leave'), 0))::int AS value
            FROM employees e JOIN staff_attendance sa ON sa.employee_id = e.id
             AND sa.attendance_date BETWEEN ${dayP}::date - 29 AND ${dayP}::date
           ${w.sql} GROUP BY e.department ORDER BY e.department`, p),
    many(`SELECT sa.attendance_date AS date,
                 round(100.0 * count(*) FILTER (WHERE sa.status IN ('Present', 'Late', 'Half Day')) / NULLIF(count(*), 0))::int AS present,
                 count(*) FILTER (WHERE sa.status = 'Absent')::int AS absent,
                 count(*) FILTER (WHERE sa.status = 'Late')::int AS late,
                 count(*) FILTER (WHERE sa.status = 'On Leave')::int AS leave
            FROM employees e JOIN staff_attendance sa ON sa.employee_id = e.id
             AND sa.attendance_date BETWEEN ${dayP}::date - 29 AND ${dayP}::date
           ${w.sql} GROUP BY sa.attendance_date ORDER BY sa.attendance_date`, p),
    many(`SELECT to_char(date_trunc('month', sa.attendance_date), 'Mon') AS label,
                 round(100.0 * count(*) FILTER (WHERE sa.status IN ('Present', 'Late', 'Half Day')) / NULLIF(count(*), 0))::int AS value
            FROM employees e JOIN staff_attendance sa ON sa.employee_id = e.id
             AND sa.attendance_date BETWEEN (date_trunc('month', ${dayP}::date) - interval '5 months')::date AND ${dayP}::date
           ${w.sql} GROUP BY date_trunc('month', sa.attendance_date) ORDER BY date_trunc('month', sa.attendance_date)`, p),
  ]);
  return { date: day, counts, byShift, byDepartment, trend, months };
}

export async function markAttendance(req: Request, input: { employeeId: string; date: string; status: string; checkIn?: string | null; checkOut?: string | null }) {
  if (input.date > todayKolkata()) throw badRequest('Attendance cannot be marked for a future date', 'FUTURE_DATE');
  const present = ['Present', 'Late', 'Half Day'].includes(input.status);
  return tx(async (db) => {
    const e = await one<{ full_name: string }>(`SELECT full_name FROM employees e WHERE e.id = $1 AND ${ACTIVE}`, [input.employeeId], db);
    if (!e) throw notFound('Employee not found', 'EMPLOYEE_NOT_FOUND');
    const before = await one('SELECT status FROM staff_attendance WHERE employee_id = $1 AND attendance_date = $2', [input.employeeId, input.date], db);
    const row = await one(
      `INSERT INTO staff_attendance (employee_id, attendance_date, status, check_in, check_out, source)
       VALUES ($1, $2, $3, $4, $5, 'manual')
       ON CONFLICT (employee_id, attendance_date) DO UPDATE
         SET status = EXCLUDED.status, check_in = EXCLUDED.check_in, check_out = EXCLUDED.check_out, source = 'manual'
       RETURNING id, attendance_date AS date, status, to_char(check_in, 'HH24:MI') AS "checkIn", to_char(check_out, 'HH24:MI') AS "checkOut"`,
      [input.employeeId, input.date, input.status, present ? input.checkIn ?? null : null, present ? input.checkOut ?? null : null], db,
    );
    await audit(req, {
      action: before ? 'update' : 'create', module: 'workforce', entityType: 'staff_attendance', entityId: row.id,
      description: `${before ? 'Corrected' : 'Marked'} attendance for ${e.full_name} on ${input.date}: ${before ? `${before.status} → ` : ''}${input.status}`,
    }, db);
    return row;
  });
}

export function isUniqueViolation(err: unknown) {
  return (err as { code?: string })?.code === '23505';
}

export async function guardUnique<T>(fn: () => Promise<T>, message: string) {
  try {
    return await fn();
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict(message);
    throw err;
  }
}
