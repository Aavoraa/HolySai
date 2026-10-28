/**
 * Operations — school documents, certificates and the compliance calendar.
 * Upload / download / verify of files reuse the core document routes
 * (POST /documents, GET /documents/:id/download, PATCH /documents/:id/verify).
 */
import type { Request } from 'express';
import { many, one, query, tx, type Queryable } from '../config/db.js';
import { Where } from '../utils/sql.js';
import { likeTerm, limitOffset, orderBy, type Pagination } from '../utils/pagination.js';
import { badRequest, notFound } from '../utils/errors.js';
import { nextCode } from '../utils/codes.js';
import { audit } from './audit.service.js';
import { authorizeStudent, studentScope } from './access.service.js';
import { notifyRoles, notifyUsers } from './notification.service.js';
import { assertCampus, splitTotal, updateById } from './operations-helpers.js';
import { schoolToday } from './intelligence-common.service.js';
import type { AuthUser } from '../types.js';

const MODULE = 'operations';

// =============================================================================
// Documents
// =============================================================================
export async function documentSummary(user: AuthUser, campusId?: string) {
  // Student documents follow the viewer's student scope (and campus); school documents are visible to documents.read.
  const sw = new Where().add('s.deleted_at IS NULL');
  studentScope(user, sw);
  sw.addIf(campusId, 's.campus_id = ?');
  return one(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE d.student_id IS NULL)::int AS school,
            count(*) FILTER (WHERE d.student_id IS NOT NULL)::int AS student,
            count(*) FILTER (WHERE d.status = 'Submitted')::int AS "pendingVerification",
            count(*) FILTER (WHERE d.status = 'Pending')::int AS "awaitingUpload",
            count(*) FILTER (WHERE d.status = 'Rejected')::int AS rejected,
            count(*) FILTER (WHERE d.status = 'Expired')::int AS expired,
            count(DISTINCT d.collection) FILTER (WHERE d.student_id IS NULL)::int AS collections,
            COALESCE(sum(d.size_bytes), 0)::bigint AS "storageBytes"
       FROM documents d LEFT JOIN students s ON s.id = d.student_id
      WHERE d.deleted_at IS NULL AND (d.student_id IS NULL OR (true ${sw.and}))`, sw.params);
}

export async function listCollections(q?: string) {
  const w = new Where().add('d.deleted_at IS NULL AND d.student_id IS NULL');
  if (q) w.add('d.collection ILIKE ?', likeTerm(q));
  return many(
    `SELECT COALESCE(d.collection, 'Unfiled') AS name, count(*)::int AS count,
            count(*) FILTER (WHERE d.status = 'Submitted')::int AS pending,
            count(*) FILTER (WHERE d.storage_key IS NOT NULL)::int AS files,
            max(d.updated_at) AS "updatedAt",
            (array_agg(COALESCE(u.full_name, d.category) ORDER BY d.updated_at DESC))[1] AS owner,
            (array_agg(DISTINCT d.category))[1:3] AS categories
       FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
       ${w.sql}
      GROUP BY COALESCE(d.collection, 'Unfiled')
      ORDER BY max(d.updated_at) DESC`, w.params);
}

const DOC_SORTS: Record<string, string> = { name: 'd.name', updated: 'd.updated_at', status: 'd.status', category: 'd.category', size: 'd.size_bytes' };

export async function listSchoolDocuments(f: Pagination & { collection?: string; status?: string }) {
  const w = new Where().add('d.deleted_at IS NULL AND d.student_id IS NULL');
  if (f.collection === 'Unfiled') w.add('d.collection IS NULL');
  else w.addIf(f.collection, 'd.collection = ?');
  w.addIf(f.status, 'd.status = ?');
  if (f.q) w.add('(d.name ILIKE ? OR d.category ILIKE ?)', likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT d.id, d.name, d.category, d.collection, d.status, (d.storage_key IS NOT NULL) AS "hasFile",
            d.original_name AS "originalName", d.mime_type AS "mimeType", d.size_bytes AS "sizeBytes",
            u.full_name AS "uploadedBy", d.created_at AS "createdAt", d.updated_at AS "updatedAt",
            d.verified_at AS "verifiedAt", vu.full_name AS "verifiedBy", count(*) OVER() AS total
       FROM documents d
       LEFT JOIN users u ON u.id = d.uploaded_by
       LEFT JOIN users vu ON vu.id = d.verified_by
       ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, DOC_SORTS, 'updated')}, d.name
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`, w.params);
  return splitTotal(rows);
}

/** Student documents waiting for upload or verification (scoped to the viewer's students). */
export async function listPendingStudentDocuments(user: AuthUser, f: Pagination & { campusId?: string; status?: string }) {
  const w = new Where().add(`d.deleted_at IS NULL AND d.student_id IS NOT NULL AND s.deleted_at IS NULL`);
  if (f.status) w.add('d.status = ?', f.status);
  else w.add(`d.status IN ('Pending', 'Submitted')`);
  studentScope(user, w);
  w.addIf(f.campusId, 's.campus_id = ?');
  if (f.q) w.add('(d.name ILIKE ? OR s.full_name ILIKE ? OR s.admission_no ILIKE ?)', likeTerm(f.q), likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT d.id, d.name, d.category, d.status, (d.storage_key IS NOT NULL) AS "hasFile", d.mime_type AS "mimeType",
            d.requested_on AS "requestedOn", d.updated_at AS "updatedAt", u.full_name AS "uploadedBy",
            s.id AS "studentId", s.full_name AS "studentName", s.admission_no AS "admissionNo",
            c.name AS grade, sec.name AS section, cp.short_name AS "campusName",
            (current_date - COALESCE(d.requested_on, d.created_at::date)) AS "waitingDays",
            count(*) OVER() AS total
       FROM documents d
       JOIN students s ON s.id = d.student_id
       JOIN campuses cp ON cp.id = s.campus_id
       LEFT JOIN sections sec ON sec.id = s.section_id
       LEFT JOIN classes c ON c.id = sec.class_id
       LEFT JOIN users u ON u.id = d.uploaded_by
       ${w.sql}
      ORDER BY (d.status = 'Submitted') DESC, ${orderBy(f.sort, f.dir, { waiting: 'COALESCE(d.requested_on, d.created_at::date)', name: 's.full_name' }, 'waiting')}
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`, w.params);
  return splitTotal(rows);
}

// =============================================================================
// Certificates
// =============================================================================
const CERT_PREFIX: Record<string, string> = {
  'Transfer certificate': 'TC', 'Bonafide certificate': 'BC', 'Conduct certificate': 'CC', 'Study certificate': 'SC', 'Achievement certificate': 'AC',
};

const CERT_SORTS: Record<string, string> = {
  requested: 'ct.requested_on', type: 'ct.certificate_type', student: 's.full_name',
  status: `array_position(ARRAY['Draft','Submitted','Under Review','Approved','Issued','Rejected'], ct.status)`,
};

export async function listCertificates(user: AuthUser, f: Pagination & { campusId?: string; status?: string; type?: string }) {
  const w = new Where();
  studentScope(user, w);
  w.addIf(f.campusId, 's.campus_id = ?');
  w.addIf(f.status, 'ct.status = ?');
  w.addIf(f.type, 'ct.certificate_type = ?');
  if (f.q) w.add('(s.full_name ILIKE ? OR s.admission_no ILIKE ? OR ct.verification_code ILIKE ?)', likeTerm(f.q), likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT ct.id, ct.certificate_type AS "certificateType", ct.status, ct.purpose, ct.requested_on AS "requestedOn",
            ct.verification_code AS "verificationCode", ct.issued_at AS "issuedAt",
            s.id AS "studentId", s.full_name AS "studentName", s.admission_no AS "admissionNo",
            c.name AS grade, sec.name AS section, cp.short_name AS "campusName",
            rq.full_name AS "requestedBy", ap.full_name AS "approvedBy",
            count(*) OVER() AS total
       FROM certificates ct
       JOIN students s ON s.id = ct.student_id
       JOIN campuses cp ON cp.id = s.campus_id
       LEFT JOIN sections sec ON sec.id = s.section_id
       LEFT JOIN classes c ON c.id = sec.class_id
       LEFT JOIN users rq ON rq.id = ct.requested_by
       LEFT JOIN users ap ON ap.id = ct.approved_by
       ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, CERT_SORTS, 'requested')}, ct.created_at DESC
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`, w.params);
  return splitTotal(rows);
}

export async function certificateSummary(user: AuthUser, campusId?: string) {
  const w = new Where();
  studentScope(user, w);
  w.addIf(campusId, 's.campus_id = ?');
  return one(
    `SELECT count(*) FILTER (WHERE ct.status IN ('Draft', 'Submitted'))::int AS requested,
            count(*) FILTER (WHERE ct.status = 'Under Review')::int AS "underReview",
            count(*) FILTER (WHERE ct.status = 'Approved')::int AS approved,
            count(*) FILTER (WHERE ct.status = 'Issued')::int AS issued,
            count(*) FILTER (WHERE ct.status = 'Rejected')::int AS rejected,
            count(*) FILTER (WHERE ct.status = 'Issued' AND ct.issued_at >= date_trunc('month', now()))::int AS "issuedThisMonth"
       FROM certificates ct JOIN students s ON s.id = ct.student_id ${w.sql}`, w.params);
}

export interface CertCheck { key: string; label: string; passed: boolean; detail: string; blocking: boolean }

/** Automatic clearance checks shown before a certificate can be approved. */
export async function certificateChecks(studentId: string, certificateType: string | null, db?: Queryable): Promise<CertCheck[]> {
  const r = await one<{ outstanding: number; pending_docs: number; rejected_docs: number; concerns: number; open_signals: number }>(
    `SELECT
       COALESCE((SELECT sum(f.amount_due - f.concession_amount - f.amount_paid) FROM student_fees f
                  WHERE f.student_id = $1 AND f.status <> 'Waived' AND f.due_date < current_date), 0)::numeric AS outstanding,
       (SELECT count(*) FROM documents d WHERE d.student_id = $1 AND d.deleted_at IS NULL AND d.status IN ('Pending', 'Submitted'))::int AS pending_docs,
       (SELECT count(*) FROM documents d WHERE d.student_id = $1 AND d.deleted_at IS NULL AND d.status = 'Rejected')::int AS rejected_docs,
       (SELECT count(*) FROM behaviour_records b WHERE b.student_id = $1 AND b.record_type = 'Incident' AND b.recorded_on > current_date - 90)::int AS concerns,
       (SELECT count(*) FROM early_warning_signals e WHERE e.student_id = $1 AND e.closed_at IS NULL AND e.signal_type = 'behaviour')::int AS open_signals`,
    [studentId], db);
  const tc = certificateType === 'Transfer certificate';
  const conduct = certificateType === 'Conduct certificate';
  const money = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
  return [
    { key: 'fees', label: 'Fees cleared', passed: Number(r!.outstanding) <= 0, blocking: tc,
      detail: Number(r!.outstanding) > 0 ? `Outstanding balance ${money(Number(r!.outstanding))}` : 'No overdue balance' },
    { key: 'documents', label: 'Documents complete', passed: r!.pending_docs + r!.rejected_docs === 0, blocking: tc,
      detail: r!.pending_docs + r!.rejected_docs ? `${r!.pending_docs} pending, ${r!.rejected_docs} rejected` : 'All documents verified' },
    { key: 'conduct', label: 'No open disciplinary matter', passed: r!.concerns + r!.open_signals === 0, blocking: tc || conduct,
      detail: r!.concerns + r!.open_signals ? `${r!.concerns} incident(s) in 90 days, ${r!.open_signals} open behaviour signal(s)` : 'Nothing open' },
  ];
}

export async function studentCertificateChecks(req: Request, idOrCode: string, type?: string) {
  const id = await authorizeStudent(req, idOrCode);
  return certificateChecks(id, type ?? null);
}

export async function createCertificate(req: Request, b: { certificateType: string; studentId: string; purpose?: string | null }) {
  const studentId = await authorizeStudent(req, b.studentId);
  return tx(async (db) => {
    const open = await one(
      `SELECT 1 FROM certificates WHERE student_id = $1 AND certificate_type = $2 AND status IN ('Draft', 'Submitted', 'Under Review')`,
      [studentId, b.certificateType], db);
    if (open) throw badRequest(`A ${b.certificateType.toLowerCase()} request is already open for this student`, 'DUPLICATE_REQUEST');
    const r = await one<{ id: string; name: string }>(
      `INSERT INTO certificates (certificate_type, student_id, purpose, status, requested_by)
       VALUES ($1,$2,$3,'Submitted',$4)
       RETURNING id, (SELECT full_name FROM students WHERE id = $2) AS name`,
      [b.certificateType, studentId, b.purpose ?? null, req.user!.id], db);
    await audit(req, { action: 'create', module: 'documents', description: `Requested ${b.certificateType} for ${r!.name}`, entityType: 'certificate', entityId: r!.id }, db);
    await notifyRoles(['principal', 'super_admin'], {
      category: 'Attention', topic: 'documents', icon: 'award', title: `${b.certificateType} requested for ${r!.name}`,
      route: '/certificates', entityType: 'certificate', entityId: r!.id,
    }, db);
    return { id: r!.id };
  });
}

const CERT_FLOW: Record<string, { from: string[]; to: string }> = {
  review: { from: ['Draft', 'Submitted'], to: 'Under Review' },
  approve: { from: ['Submitted', 'Under Review'], to: 'Approved' },
  reject: { from: ['Draft', 'Submitted', 'Under Review', 'Approved'], to: 'Rejected' },
  issue: { from: ['Approved'], to: 'Issued' },
};

export async function decideCertificate(req: Request, id: string, b: { action: keyof typeof CERT_FLOW; note?: string | null }) {
  const scopeWhere = new Where().add('ct.id = ?', id);
  studentScope(req.user!, scopeWhere);
  return tx(async (db) => {
    const c = await one<{ id: string; certificate_type: string; status: string; student_id: string; student_name: string; requested_by: string | null; verification_code: string | null }>(
      `SELECT ct.id, ct.certificate_type, ct.status, ct.student_id, s.full_name AS student_name, ct.requested_by, ct.verification_code
         FROM certificates ct JOIN students s ON s.id = ct.student_id ${scopeWhere.sql} FOR UPDATE OF ct`, scopeWhere.params, db);
    if (!c) throw notFound('Certificate not found');
    const step = CERT_FLOW[b.action];
    if (!step.from.includes(c.status)) throw badRequest(`A ${c.status.toLowerCase()} certificate cannot be ${b.action === 'issue' ? 'issued' : b.action + 'ed'}`, 'INVALID_TRANSITION');
    if (b.action === 'reject' && !b.note) throw badRequest('Give a reason for rejecting', 'REASON_REQUIRED', [{ field: 'note', message: 'Reason required' }]);

    let code = c.verification_code;
    if (b.action === 'approve') {
      const failing = (await certificateChecks(c.student_id, c.certificate_type, db)).filter((x) => x.blocking && !x.passed);
      if (failing.length) {
        throw badRequest(`Cannot approve while a check is failing: ${failing.map((x) => `${x.label} (${x.detail})`).join('; ')}`, 'CHECKS_FAILING');
      }
      if (!code) {
        const prefix = `${CERT_PREFIX[c.certificate_type] ?? 'HS'}-${new Date().getFullYear()}-`;
        code = await nextCode('certificates', 'verification_code', prefix, db);
      }
    }
    await query(
      `UPDATE certificates SET status = $2, verification_code = $3,
              approved_by = CASE WHEN $2 IN ('Approved', 'Rejected') THEN $4::uuid ELSE approved_by END,
              issued_at = CASE WHEN $2 = 'Issued' THEN now() ELSE issued_at END
        WHERE id = $1`, [id, step.to, code, req.user!.id], db);
    await audit(req, {
      action: b.action === 'approve' || b.action === 'reject' ? 'approve' : 'update', module: 'documents',
      description: `${c.certificate_type} for ${c.student_name}: ${c.status} → ${step.to}${code && b.action === 'approve' ? ` (${code})` : ''}`,
      entityType: 'certificate', entityId: id, metadata: { note: b.note ?? null },
    }, db);
    if (c.requested_by && c.requested_by !== req.user!.id) {
      await notifyUsers([c.requested_by], {
        category: step.to === 'Rejected' ? 'Attention' : step.to === 'Issued' ? 'Completed' : 'Information', topic: 'documents', icon: 'award',
        title: `${c.certificate_type} for ${c.student_name} is ${step.to.toLowerCase()}`, body: b.note ?? undefined, route: '/certificates',
      }, db);
    }
    return { status: step.to, verificationCode: code };
  });
}

/** Verification by QR code. Returns only what a verifier needs to see. */
export async function verifyCertificate(req: Request, code: string) {
  const c = await one(
    `SELECT ct.id, ct.certificate_type AS "certificateType", ct.status, ct.issued_at AS "issuedAt", ct.verification_code AS "verificationCode",
            s.full_name AS "studentName", s.admission_no AS "admissionNo", c.name AS grade, cp.name AS campus
       FROM certificates ct JOIN students s ON s.id = ct.student_id JOIN campuses cp ON cp.id = s.campus_id
       LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
      WHERE ct.verification_code = $1`, [code]);
  await audit(req, { action: 'view', module: 'documents', description: `Verified certificate code ${code} (${c ? c.status : 'not found'})`, entityType: 'certificate', entityId: c?.id ?? null });
  if (!c) return { valid: false, verificationCode: code, reason: 'No certificate carries this code.' };
  const valid = c.status === 'Issued';
  const { id: _id, ...rest } = c;
  return { valid, ...rest, reason: valid ? 'Issued by Holy Sai and unchanged.' : `Certificate is ${String(c.status).toLowerCase()}, not issued.` };
}

// =============================================================================
// Compliance calendar
// =============================================================================
/** Status is derived: Completed › Overdue (past due) › Due Soon (≤ 14 days) › stored Scheduled / In Progress. */
export const COMPLIANCE_STATUS_SQL = `CASE
  WHEN ci.completed_on IS NOT NULL OR ci.status = 'Completed' THEN 'Completed'
  WHEN ci.due_on < current_date THEN 'Overdue'
  WHEN ci.due_on <= current_date + 14 THEN 'Due Soon'
  WHEN ci.status IN ('Due Soon', 'Overdue') THEN 'Scheduled'
  ELSE ci.status END`;

const COMP_SORTS: Record<string, string> = {
  due: 'ci.due_on', item: 'ci.item', owner: 'ci.owner_name', days: 'ci.due_on',
  status: `array_position(ARRAY['Overdue','Due Soon','In Progress','Scheduled','Completed'], ${COMPLIANCE_STATUS_SQL})`,
};

export async function listCompliance(f: Pagination & { campusId?: string; status?: string; includeCompleted?: boolean }) {
  const w = new Where();
  w.addIf(f.campusId, 'ci.campus_id = ?');
  if (f.status) w.add(`${COMPLIANCE_STATUS_SQL} = ?`, f.status);
  else if (!f.includeCompleted) w.add(`${COMPLIANCE_STATUS_SQL} <> 'Completed'`);
  if (f.q) w.add('(ci.item ILIKE ? OR ci.authority ILIKE ? OR ci.owner_name ILIKE ?)', likeTerm(f.q), likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT ci.id, ci.item, ci.authority, ci.due_on AS "dueOn", (ci.due_on - current_date) AS days,
            ci.owner_name AS "ownerName", ci.owner_id AS "ownerId", e.designation AS "ownerRole",
            ${COMPLIANCE_STATUS_SQL} AS status, ci.status AS "storedStatus", ci.completed_on AS "completedOn", ci.notes,
            ci.campus_id AS "campusId", cp.short_name AS "campusName", count(*) OVER() AS total
       FROM compliance_items ci
       JOIN campuses cp ON cp.id = ci.campus_id
       LEFT JOIN employees e ON e.id = ci.owner_id
       ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, COMP_SORTS, 'due')}, ci.item
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`, w.params);
  return splitTotal(rows);
}

export async function complianceSummary(campusId?: string) {
  const c = campusId ?? null;
  const [counts, months] = await Promise.all([
    one(
      `WITH x AS (SELECT ci.*, ${COMPLIANCE_STATUS_SQL} AS st FROM compliance_items ci WHERE ($1::uuid IS NULL OR ci.campus_id = $1))
       SELECT count(*) FILTER (WHERE st = 'Overdue')::int AS overdue,
              count(*) FILTER (WHERE st = 'Due Soon')::int AS "dueSoon",
              count(*) FILTER (WHERE st IN ('Scheduled', 'In Progress'))::int AS "onSchedule",
              count(*) FILTER (WHERE st = 'Completed' AND completed_on >= date_trunc('month', current_date))::int AS "completedThisMonth",
              (SELECT json_build_object('item', item, 'days', current_date - due_on) FROM x WHERE st = 'Overdue' ORDER BY due_on LIMIT 1) AS "firstOverdue",
              round(100.0 * count(*) FILTER (WHERE due_on BETWEEN current_date - 365 AND current_date - 1 AND completed_on IS NOT NULL AND completed_on <= due_on)
                    / NULLIF(count(*) FILTER (WHERE due_on BETWEEN current_date - 365 AND current_date - 1), 0))::int AS score,
              round(100.0 * count(*) FILTER (WHERE due_on BETWEEN current_date - 455 AND current_date - 91 AND completed_on IS NOT NULL AND completed_on <= due_on)
                    / NULLIF(count(*) FILTER (WHERE due_on BETWEEN current_date - 455 AND current_date - 91), 0))::int AS "previousScore"
         FROM x`, [c]),
    many(
      `SELECT to_char(m, 'Mon') AS label,
              count(ci.id)::int AS due,
              count(ci.id) FILTER (WHERE ci.completed_on IS NOT NULL AND ci.completed_on <= ci.due_on)::int AS "onTime"
         FROM generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month') m
         LEFT JOIN compliance_items ci ON date_trunc('month', ci.due_on) = m AND ($1::uuid IS NULL OR ci.campus_id = $1)
        GROUP BY m ORDER BY m`, [c]),
  ]);
  return { ...counts, months };
}

async function ownerName(ownerId: string | null | undefined, fallback?: string) {
  if (!ownerId) return fallback;
  const e = await one<{ full_name: string }>('SELECT full_name FROM employees WHERE id = $1 AND deleted_at IS NULL', [ownerId]);
  if (!e) throw badRequest('Owner not found', 'OWNER_NOT_FOUND', [{ field: 'ownerId', message: 'Choose a current employee' }]);
  return e.full_name;
}

export async function createCompliance(req: Request, b: any) {
  await assertCampus(b.campusId);
  const name = await ownerName(b.ownerId, b.ownerName);
  const r = await one<{ id: string }>(
    `INSERT INTO compliance_items (campus_id, item, authority, due_on, owner_name, owner_id, notes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'Scheduled') RETURNING id`,
    [b.campusId, b.item, b.authority, b.dueOn, name, b.ownerId ?? null, b.notes ?? null]);
  await audit(req, { action: 'create', module: MODULE, description: `Added compliance requirement "${b.item}" due ${b.dueOn}`, entityType: 'compliance_item', entityId: r!.id });
  return { id: r!.id };
}

const COMP_COLS: Record<string, string> = { item: 'item', authority: 'authority', dueOn: 'due_on', ownerName: 'owner_name', ownerId: 'owner_id', status: 'status', notes: 'notes' };

export async function updateCompliance(req: Request, id: string, b: any) {
  const input = { ...b };
  if (b.ownerId) input.ownerName = await ownerName(b.ownerId);
  const { row, keys } = await updateById<{ item: string }>('compliance_items', id, input, COMP_COLS, { where: 'AND completed_on IS NULL', returning: 'item' });
  if (!row) throw notFound('Open compliance item not found');
  await audit(req, { action: 'update', module: MODULE, description: `Updated compliance requirement "${row.item}"`, entityType: 'compliance_item', entityId: id, metadata: { changed: keys } });
}

export async function completeCompliance(req: Request, id: string, b: { completedOn: string; notes?: string | null; nextDueOn?: string }) {
  return tx(async (db) => {
    const ci = await one<{ item: string; due_on: string; campus_id: string; authority: string; owner_name: string; owner_id: string | null; notes: string | null }>(
      `SELECT item, due_on, campus_id, authority, owner_name, owner_id, notes FROM compliance_items WHERE id = $1 AND completed_on IS NULL FOR UPDATE`, [id], db);
    if (!ci) throw notFound('Open compliance item not found');
    if (b.completedOn > schoolToday()) throw badRequest('Completion date cannot be in the future', 'FUTURE_DATE', [{ field: 'completedOn', message: 'Cannot be in the future' }]);
    if (b.nextDueOn && b.nextDueOn <= b.completedOn) throw badRequest('Next due date must be after completion', 'BAD_NEXT_DUE', [{ field: 'nextDueOn', message: 'Must be after the completion date' }]);
    await query(`UPDATE compliance_items SET status = 'Completed', completed_on = $2, notes = COALESCE($3, notes) WHERE id = $1`, [id, b.completedOn, b.notes ?? null], db);
    let nextId: string | null = null;
    if (b.nextDueOn) {
      const n = await one<{ id: string }>(
        `INSERT INTO compliance_items (campus_id, item, authority, due_on, owner_name, owner_id, status)
         VALUES ($1,$2,$3,$4,$5,$6,'Scheduled') RETURNING id`, [ci.campus_id, ci.item, ci.authority, b.nextDueOn, ci.owner_name, ci.owner_id], db);
      nextId = n!.id;
    }
    await audit(req, {
      action: 'update', module: MODULE,
      description: `Completed "${ci.item}" on ${b.completedOn} (due ${ci.due_on})${b.nextDueOn ? `; next due ${b.nextDueOn}` : ''}`,
      entityType: 'compliance_item', entityId: id,
    }, db);
    return { nextId };
  });
}

export async function escalateCompliance(req: Request, id: string, note?: string | null) {
  const ci = await one<{ item: string; due_on: string; owner_user: string | null; owner_name: string }>(
    `SELECT ci.item, ci.due_on, e.user_id AS owner_user, ci.owner_name FROM compliance_items ci LEFT JOIN employees e ON e.id = ci.owner_id
      WHERE ci.id = $1 AND ci.completed_on IS NULL`, [id]);
  if (!ci) throw notFound('Open compliance item not found');
  const n = { category: 'Critical' as const, topic: 'operations', icon: 'shield', title: `Compliance escalation: ${ci.item}`,
    body: `Due ${ci.due_on} · owner ${ci.owner_name}${note ? ` — ${note}` : ''}`, route: '/compliance', entityType: 'compliance_item', entityId: id };
  await notifyRoles(['principal', 'school_admin'], n);
  if (ci.owner_user) await notifyUsers([ci.owner_user], n);
  await audit(req, { action: 'update', module: MODULE, description: `Escalated overdue compliance item "${ci.item}"`, entityType: 'compliance_item', entityId: id, metadata: { note: note ?? null } });
}

// =============================================================================
// Audit trail helpers (the list itself is GET /audit-logs in core)
// =============================================================================
export async function auditFacets() {
  const [modules, actions] = await Promise.all([
    many<{ module: string; n: number }>(`SELECT module, count(*)::int AS n FROM audit_logs GROUP BY module ORDER BY module`),
    many<{ action: string }>(`SELECT DISTINCT action FROM audit_logs ORDER BY action`),
  ]);
  return { modules, actions: actions.map((a) => a.action) };
}
