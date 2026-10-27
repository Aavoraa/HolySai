/**
 * Admission forms — the filled admission form behind each application.
 *
 * Flow: a lead (enquiry) comes in → the family fills the school's admission
 * form (paper or PDF) → the office either types it in (Manual), uploads the
 * filled / scanned form (Upload), or both.
 *
 *  - Applications can be opened for an existing lead or for a walk-in family
 *    (the lead is created at the Application stage automatically).
 *  - The typed form lives in admissions.form_data; key fields are copied onto
 *    the application and the lead so lists, search and enrolment use them.
 *  - The uploaded scan is a documents row (owner_type 'admission', category
 *    'Admission form') linked from admissions.form_document_id. Checklist
 *    documents (category 'Admission') can carry an uploaded file too.
 *  - Bulk import: a CSV of many filled forms, one lead + application per row.
 */
import type { Request } from 'express';
import type { Readable } from 'node:stream';
import { one, query, tx, type Queryable } from '../config/db.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { nextCode } from '../utils/codes.js';
import { audit } from './audit.service.js';
import { openStoredFile, safeFilename, verifyUploadedFile } from './documents.service.js';
import { advanceTo, createApplicationRow, resolveLead } from './admissions.service.js';
import {
  REQUIRED_FORM_FIELDS, admissionFormFields, importRowSchema, type AdmissionForm,
} from '../validators/admissions.validators.js';

export const FORM_DOC_CATEGORY = 'Admission form';
const CLOSED = ['Enrolled', 'Rejected', 'Withdrawn'];

/** 'Not received' | 'Entered manually' | 'Uploaded' | 'Both' for an admissions row aliased `a`. */
export const formStatusSql = (a = 'a') => `CASE
  WHEN ${a}.form_entered_at IS NOT NULL AND ${a}.form_document_id IS NOT NULL THEN 'Both'
  WHEN ${a}.form_document_id IS NOT NULL THEN 'Uploaded'
  WHEN ${a}.form_entered_at IS NOT NULL THEN 'Entered manually'
  ELSE 'Not received' END`;

/** WHERE fragment for the applications list `form` filter (trusted constants). */
export const FORM_FILTER: Record<string, string> = {
  none: 'a.form_entered_at IS NULL AND a.form_document_id IS NULL',
  manual: 'a.form_entered_at IS NOT NULL AND a.form_document_id IS NULL',
  upload: 'a.form_document_id IS NOT NULL AND a.form_entered_at IS NULL',
  both: 'a.form_entered_at IS NOT NULL AND a.form_document_id IS NOT NULL',
  received: '(a.form_entered_at IS NOT NULL OR a.form_document_id IS NOT NULL)',
};

type FormInput = { form?: AdmissionForm; receivedOn?: string; submit?: boolean };

// ---------------------------------------------------------------------------
// Completeness
// ---------------------------------------------------------------------------
const CONTACT_FIELDS = { Father: ['fatherName', 'fatherPhone'], Mother: ['motherName', 'motherPhone'], Guardian: ['guardianName', 'guardianPhone'] } as const;

export function formCompleteness(form: AdmissionForm) {
  const missing: { field: string; message: string }[] = [];
  for (const [k, message] of REQUIRED_FORM_FIELDS) {
    const val = form[k];
    if (val === undefined || val === null || val === '') missing.push({ field: `form.${k}`, message });
  }
  const pc = form.primaryContact;
  if (pc) {
    const [nameKey, phoneKey] = CONTACT_FIELDS[pc];
    if (!form[nameKey]) missing.push({ field: `form.${nameKey}`, message: `Enter the ${pc.toLowerCase()}’s name (primary contact)` });
    if (!form[phoneKey]) missing.push({ field: `form.${phoneKey}`, message: `Enter the ${pc.toLowerCase()}’s phone (primary contact)` });
  }
  const total = REQUIRED_FORM_FIELDS.length + 2;
  const filled = Math.max(0, total - missing.length - (pc ? 0 : 2));
  return { filled, total, percent: Math.round((filled / total) * 100), missing };
}

function primaryContact(form: AdmissionForm) {
  const pc = form.primaryContact
    ?? (form.fatherName && form.fatherPhone ? 'Father' : form.motherName && form.motherPhone ? 'Mother' : form.guardianName && form.guardianPhone ? 'Guardian' : undefined);
  if (!pc) return null;
  const pick = {
    Father: { name: form.fatherName, phone: form.fatherPhone, email: form.fatherEmail, relationship: 'Father' },
    Mother: { name: form.motherName, phone: form.motherPhone, email: form.motherEmail, relationship: 'Mother' },
    Guardian: { name: form.guardianName, phone: form.guardianPhone, email: form.guardianEmail, relationship: 'Guardian' },
  }[pc];
  return pick.name ? pick : null;
}

/** Drops undefined keys so a merge never erases saved values with "not sent". */
const defined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined));

// ---------------------------------------------------------------------------
// Save the typed form onto an application (inside a transaction)
// ---------------------------------------------------------------------------
async function lockApp(id: string, db: Queryable) {
  const app = await one('SELECT * FROM admissions WHERE id = $1 FOR UPDATE', [id], db);
  if (!app) throw notFound('Application not found', 'APPLICATION_NOT_FOUND');
  return app;
}

async function applyForm(db: Queryable, req: Request, app: any, input: FormInput, opts: { auditIt?: boolean } = {}) {
  if (CLOSED.includes(app.status)) throw badRequest(`This application is ${app.status.toLowerCase()}`, 'APPLICATION_CLOSED');
  // The whole form is sent on every save (the UI keeps the full state), so it replaces what was stored.
  const sent = (input.form ?? {}) as Record<string, unknown>;
  const form = defined(sent) as AdmissionForm;
  const completeAlready = !!app.form_completed_at;
  const c = formCompleteness(form);
  if ((input.submit || completeAlready) && c.missing.length) {
    throw badRequest(
      completeAlready ? 'This form was submitted — required fields cannot be left empty' : `Complete the form before submitting (${c.missing.length} required field${c.missing.length === 1 ? '' : 's'} missing)`,
      'FORM_INCOMPLETE', c.missing);
  }
  const contact = primaryContact(form);
  const studentName = form.studentFirstName && form.studentLastName ? `${form.studentFirstName} ${form.studentLastName}` : null;
  const completedNow = input.submit && !completeAlready;
  await query(
    `UPDATE admissions SET form_data = $2, form_entered_by = $3, form_entered_at = now(),
            form_source = COALESCE(form_source, 'Manual'),
            form_received_on = COALESCE($4::date, form_received_on, current_date),
            form_completed_at = CASE WHEN $5 THEN now() ELSE form_completed_at END,
            student_name = COALESCE($6, student_name), date_of_birth = COALESCE($7::date, date_of_birth), gender = COALESCE($8, gender),
            grade_applied = COALESCE($9, grade_applied), previous_school = COALESCE($10, previous_school),
            father_name = $11, mother_name = $12, guardian_phone = $13, guardian_email = $14, address = $15, city = $16, pincode = $17,
            nationality = $18, blood_group = $19, mother_tongue = $20, previous_grade = $21, siblings_in_school = $22,
            medical_notes = $23, transport_required = $24,
            status = CASE WHEN $5 AND status = 'Draft' THEN 'Submitted' ELSE status END
      WHERE id = $1`,
    [app.id, JSON.stringify(form), req.user!.id, input.receivedOn ?? null, !!completedNow,
      studentName, form.dateOfBirth ?? null, form.gender ?? null, form.gradeApplied ?? null, form.previousSchool ?? null,
      form.fatherName ?? null, form.motherName ?? null, contact?.phone ?? null, contact?.email ?? null, form.address ?? null,
      form.city ?? null, form.pincode ?? null, form.nationality ?? null, form.bloodGroup ?? null, form.motherTongue ?? null,
      form.previousGrade ?? null, form.siblingsInSchool ?? null,
      [form.medicalNotes, form.allergies && `Allergies: ${form.allergies}`, form.specialNeeds && `Special needs: ${form.specialNeeds}`].filter(Boolean).join(' · ') || null,
      form.transportRequired ?? null],
    db);
  if (app.enquiry_id) {
    await query(
      `UPDATE enquiries SET student_name = COALESCE($2, student_name), student_dob = COALESCE($3::date, student_dob),
              grade_applied = COALESCE($4, grade_applied), transport_required = COALESCE($5, transport_required),
              email = COALESCE(email, $6), updated_by = $7
        WHERE id = $1`,
      [app.enquiry_id, studentName, form.dateOfBirth ?? null, form.gradeApplied ?? null, form.transportRequired ?? null, contact?.email ?? null, req.user!.id], db);
  }
  if (opts.auditIt !== false) {
    await audit(req, {
      action: 'update', module: 'admissions',
      description: `${completedNow ? 'Submitted' : 'Saved'} admission form for ${app.application_no}${completedNow && app.status === 'Draft' ? ' (application submitted)' : ''}`,
      entityType: 'admission', entityId: app.id, metadata: { fields: Object.keys(defined(sent)), complete: c.missing.length === 0 },
    }, db);
  }
  return { completeness: c, status: completedNow && app.status === 'Draft' ? 'Submitted' : app.status };
}

export async function saveForm(req: Request, id: string, input: FormInput) {
  return tx(async (db) => {
    const app = await lockApp(id, db);
    const out = await applyForm(db, req, app, input);
    return { id, ...out };
  });
}

export async function getForm(id: string) {
  const row = await one(
    `SELECT a.id, a.application_no AS "applicationNo", a.status, a.form_source AS "formSource", a.form_received_on AS "receivedOn",
            a.form_data AS form, a.form_entered_at AS "enteredAt", eu.full_name AS "enteredBy", a.form_completed_at AS "completedAt",
            ${formStatusSql()} AS "formStatus",
            d.id AS "fileId", d.original_name AS "fileName", d.mime_type AS "fileType", d.size_bytes AS "fileSize",
            d.created_at AS "uploadedAt", du.full_name AS "uploadedBy"
       FROM admissions a
       LEFT JOIN users eu ON eu.id = a.form_entered_by
       LEFT JOIN documents d ON d.id = a.form_document_id AND d.deleted_at IS NULL
       LEFT JOIN users du ON du.id = d.uploaded_by
      WHERE a.id = $1`, [id]);
  if (!row) throw notFound('Application not found', 'APPLICATION_NOT_FOUND');
  const { fileId, fileName, fileType, fileSize, uploadedAt, uploadedBy, ...rest } = row;
  return {
    ...rest,
    completeness: formCompleteness(admissionFormFields.parse(row.form ?? {})),
    file: fileId ? { id: fileId, name: fileName, mimeType: fileType, sizeBytes: Number(fileSize ?? 0), uploadedAt, uploadedBy } : null,
  };
}

// ---------------------------------------------------------------------------
// Open an application — existing lead or walk-in family
// ---------------------------------------------------------------------------
export interface WalkIn {
  campusId: string; parentName: string; phone: string; email?: string; studentName: string; gradeApplied: string;
  curriculum?: string; source: string; counsellorId?: string | null;
}
export interface CreateInput extends FormInput {
  enquiryId?: string; walkIn?: WalkIn; dateOfBirth?: string; gender?: string; previousSchool?: string; formSource?: 'Manual' | 'Upload' | 'Online';
}

async function createWalkInLead(db: Queryable, req: Request, w: WalkIn, form?: AdmissionForm) {
  const campus = await one('SELECT id FROM campuses WHERE id = $1', [w.campusId], db);
  if (!campus) throw badRequest('Campus not found', 'CAMPUS_NOT_FOUND', [{ field: 'walkIn.campusId', message: 'Choose a campus' }]);
  const dup = await one<{ code: string }>(
    `SELECT code FROM enquiries WHERE deleted_at IS NULL AND regexp_replace(phone, '\\D', '', 'g') = regexp_replace($1, '\\D', '', 'g')
        AND lower(student_name) = lower($2) AND stage NOT IN ('Enrolled', 'Lost')`, [w.phone, w.studentName], db);
  if (dup) throw conflict(`An open lead already exists for this child (${dup.code}) — open the application from that lead`, 'DUPLICATE_LEAD');
  if (w.counsellorId) {
    const emp = await one(`SELECT id FROM employees WHERE id = $1 AND deleted_at IS NULL AND employment_status = 'active'`, [w.counsellorId], db);
    if (!emp) throw badRequest('Choose an active staff member', 'COUNSELLOR_NOT_FOUND', [{ field: 'walkIn.counsellorId', message: 'Choose an active staff member' }]);
  }
  const year = await one<{ id: string }>('SELECT id FROM academic_years WHERE is_current', [], db);
  const cost = await one<{ avg: number | null }>(
    `SELECT round(avg(acquisition_cost))::numeric AS avg FROM enquiries WHERE source = $1 AND created_at > now() - interval '180 days'`, [w.source], db);
  const code = await nextCode('enquiries', 'code', 'LD-', db);
  const lead = await one(
    `INSERT INTO enquiries (code, campus_id, academic_year_id, parent_name, phone, email, student_name, student_dob, grade_applied,
                            curriculum, source, campaign, lead_score, counsellor_id, transport_required, next_action, acquisition_cost,
                            notes, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,70,$13,$14,'Collect and verify documents',$15,$16,$17,$17) RETURNING *`,
    [code, w.campusId, year?.id ?? null, w.parentName, w.phone, w.email ?? null, w.studentName, form?.dateOfBirth ?? null, w.gradeApplied,
      w.curriculum ?? null, w.source, w.source === 'Walk-in' ? 'Walk-in' : null, w.counsellorId ?? null, form?.transportRequired ?? false,
      cost?.avg ?? 0, 'Admission form received at the front office', req.user!.id],
    db);
  await query(`INSERT INTO enquiry_stage_history (enquiry_id, from_stage, to_stage, changed_by, note) VALUES ($1, NULL, 'New Lead', $2, 'Lead created from a filled admission form')`, [lead.id, req.user!.id], db);
  await query(
    `INSERT INTO communications (channel, direction, enquiry_id, counterpart, subject, status, sent_by)
     VALUES ('Note', 'internal', $1, $2, $3, 'Internal', $4)`,
    [lead.id, w.parentName, `${w.source} — admission form received`, req.user!.id], db);
  await audit(req, { action: 'create', module: 'admissions', description: `Created lead ${code} (${w.studentName}, ${w.gradeApplied}) from an admission form`, entityType: 'enquiry', entityId: lead.id }, db);
  return lead;
}

/** Inside a transaction: lead (existing or new) → application → optional form. */
async function createInTx(db: Queryable, req: Request, input: CreateInput) {
  const lead = input.walkIn ? await createWalkInLead(db, req, input.walkIn, input.form) : await resolveLead(input.enquiryId!, db, true);
  if (['Enrolled', 'Lost'].includes(lead.stage)) throw badRequest('This lead is closed', 'LEAD_CLOSED');
  const app = await createApplicationRow(db, req, lead, {
    dateOfBirth: input.dateOfBirth ?? input.form?.dateOfBirth, gender: input.gender ?? input.form?.gender, previousSchool: input.previousSchool ?? input.form?.previousSchool,
  });
  await advanceTo(db, req, lead as any, 'Application', `Application ${app.applicationNo} opened${input.form || input.formSource ? ' — admission form received' : ''}`);
  await query(`UPDATE enquiries SET next_action = 'Collect and verify documents' WHERE id = $1`, [lead.id], db);
  await query(
    `INSERT INTO communications (channel, direction, enquiry_id, counterpart, subject, status, sent_by)
     VALUES ('Email', 'outbound', $1, $2, 'Application received — document checklist', 'Logged', $3)`,
    [lead.id, lead.parent_name, req.user!.id], db);
  let status = 'Submitted';
  if (input.formSource) {
    await query(`UPDATE admissions SET form_source = $2, form_received_on = COALESCE($3::date, current_date) WHERE id = $1`, [app.id, input.formSource, input.receivedOn ?? null], db);
  }
  if (input.form && Object.keys(defined(input.form)).length) {
    // A manually entered form that is not yet complete keeps the application as a Draft.
    if (!input.submit) {
      await query(`UPDATE admissions SET status = 'Draft' WHERE id = $1`, [app.id], db);
      status = 'Draft';
    }
    const row = await one('SELECT * FROM admissions WHERE id = $1', [app.id], db);
    const out = await applyForm(db, req, row, { form: input.form, receivedOn: input.receivedOn, submit: input.submit }, { auditIt: false });
    status = out.status;
  }
  return { ...app, enquiryId: lead.id as string, leadCode: lead.code as string, leadCreated: !!input.walkIn, status };
}

export async function createApplication(req: Request, input: CreateInput) {
  return tx((db) => createInTx(db, req, input));
}

// ---------------------------------------------------------------------------
// Files — the uploaded admission form and checklist documents
// ---------------------------------------------------------------------------
export async function uploadForm(req: Request, id: string, file: Express.Multer.File | undefined, receivedOn?: string) {
  if (!file) throw badRequest('Attach the filled admission form in the "file" field', 'FILE_REQUIRED', [{ field: 'file', message: 'Choose a PDF or image' }]);
  return tx(async (db) => {
    const app = await lockApp(id, db);
    if (CLOSED.includes(app.status)) throw badRequest(`This application is ${app.status.toLowerCase()}`, 'APPLICATION_CLOSED');
    const stored = await verifyUploadedFile(file);
    const replaced = app.form_document_id as string | null;
    if (replaced) await query('UPDATE documents SET deleted_at = now() WHERE id = $1', [replaced], db);
    const doc = await one<{ id: string }>(
      `INSERT INTO documents (owner_type, owner_id, name, category, status, storage_key, original_name, mime_type, size_bytes, checksum_sha256,
                              requested_on, uploaded_by)
       VALUES ('admission', $1, 'Admission form', $2, 'Submitted', $3, $4, $5, $6, $7, COALESCE($8::date, current_date), $9) RETURNING id`,
      [id, FORM_DOC_CATEGORY, stored.storageKey, safeFilename(file.originalname), file.mimetype, stored.size, stored.checksum, receivedOn ?? null, req.user!.id], db);
    await query(
      `UPDATE admissions SET form_document_id = $2,
              form_source = CASE WHEN form_entered_at IS NULL THEN 'Upload' ELSE COALESCE(form_source, 'Upload') END,
              form_received_on = COALESCE($3::date, form_received_on, current_date)
        WHERE id = $1`, [id, doc!.id, receivedOn ?? null], db);
    await audit(req, {
      action: replaced ? 'update' : 'create', module: 'admissions',
      description: `${replaced ? 'Replaced' : 'Uploaded'} the filled admission form for ${app.application_no} (${safeFilename(file.originalname)})`,
      entityType: 'admission', entityId: id, metadata: { documentId: doc!.id, replaced, size: stored.size },
    }, db);
    return { documentId: doc!.id, replaced: !!replaced };
  });
}

export async function uploadChecklistDocument(req: Request, id: string, docId: string, file: Express.Multer.File | undefined) {
  if (!file) throw badRequest('Attach the document in the "file" field', 'FILE_REQUIRED', [{ field: 'file', message: 'Choose a PDF or image' }]);
  return tx(async (db) => {
    const app = await lockApp(id, db);
    if (CLOSED.includes(app.status)) throw badRequest(`This application is ${app.status.toLowerCase()}`, 'APPLICATION_CLOSED');
    const existing = await one<{ id: string; name: string }>(
      `SELECT id, name FROM documents WHERE id = $1 AND owner_type = 'admission' AND owner_id = $2 AND category <> $3 AND deleted_at IS NULL FOR UPDATE`,
      [docId, id, FORM_DOC_CATEGORY], db);
    if (!existing) throw notFound('Document not found', 'DOCUMENT_NOT_FOUND');
    const stored = await verifyUploadedFile(file);
    await query(
      `UPDATE documents SET storage_key = $2, original_name = $3, mime_type = $4, size_bytes = $5, checksum_sha256 = $6,
              status = 'Submitted', verified_by = NULL, verified_at = NULL, uploaded_by = $7
        WHERE id = $1`,
      [docId, stored.storageKey, safeFilename(file.originalname), file.mimetype, stored.size, stored.checksum, req.user!.id], db);
    await query('UPDATE admissions SET documents_complete = false WHERE id = $1', [id], db);
    await audit(req, {
      action: 'update', module: 'admissions', description: `Uploaded ${existing.name} for ${app.application_no} — awaiting verification`,
      entityType: 'admission', entityId: id, metadata: { documentId: docId, size: stored.size },
    }, db);
    return { documentId: docId, status: 'Submitted' };
  });
}

export async function openDocument(req: Request, id: string, docId: string): Promise<{ stream: Readable; name: string; mimeType: string }> {
  const d = await one<{ id: string; name: string; storage_key: string | null; original_name: string | null; mime_type: string | null; application_no: string }>(
    `SELECT d.id, d.name, d.storage_key, d.original_name, d.mime_type, a.application_no
       FROM documents d JOIN admissions a ON a.id = d.owner_id
      WHERE d.id = $1 AND d.owner_type = 'admission' AND d.owner_id = $2 AND d.deleted_at IS NULL`, [docId, id]);
  if (!d || !d.storage_key) throw notFound('No file has been uploaded for this document', 'FILE_NOT_FOUND');
  const stream = await openStoredFile(d.storage_key);
  if (!stream) throw notFound('File is no longer available', 'FILE_MISSING');
  await audit(req, { action: 'view', module: 'admissions', description: `Downloaded ${d.name} for ${d.application_no}`, entityType: 'document', entityId: d.id });
  return { stream, name: safeFilename(d.original_name ?? d.name), mimeType: d.mime_type ?? 'application/octet-stream' };
}

// ---------------------------------------------------------------------------
// Bulk import — CSV of filled admission forms
// ---------------------------------------------------------------------------
export const IMPORT_COLUMNS = [
  'studentName', 'gradeApplied', 'parentName', 'phone', 'email', 'source', 'receivedOn',
  'studentFirstName', 'studentLastName', 'dateOfBirth', 'gender', 'placeOfBirth', 'nationality', 'religion', 'motherTongue', 'bloodGroup',
  'fatherName', 'fatherOccupation', 'fatherPhone', 'fatherEmail', 'motherName', 'motherOccupation', 'motherPhone', 'motherEmail',
  'guardianName', 'guardianRelationship', 'guardianPhone', 'guardianEmail', 'primaryContact',
  'address', 'city', 'state', 'pincode', 'emergencyContactName', 'emergencyContactPhone',
  'previousSchool', 'previousBoard', 'previousGrade', 'reasonForLeaving',
  'siblingsInSchool', 'siblingDetails', 'medicalNotes', 'allergies', 'specialNeeds', 'transportRequired',
  'declarationSignedBy', 'declarationDate',
] as const;

const EXAMPLE: Record<string, string> = {
  studentName: 'Aarav Kumar', gradeApplied: 'Grade 4', parentName: 'Senthil Kumar', phone: '+91 98400 12345', email: 'senthil.kumar@example.com',
  source: 'Walk-in', receivedOn: '', studentFirstName: 'Aarav', studentLastName: 'Kumar', dateOfBirth: '2017-06-14', gender: 'M',
  nationality: 'Indian', motherTongue: 'Tamil', bloodGroup: 'B+', fatherName: 'Senthil Kumar', fatherOccupation: 'Engineer',
  fatherPhone: '+91 98400 12345', motherName: 'Priya Senthil', motherPhone: '+91 98400 54321', primaryContact: 'Father',
  address: '12 Lake View Road', city: 'Chennai', state: 'Tamil Nadu', pincode: '603202', previousSchool: 'Sunshine Montessori',
  previousBoard: 'State Board', previousGrade: 'Grade 3', siblingsInSchool: 'no', transportRequired: 'yes', declarationSignedBy: 'Senthil Kumar',
};

const csvCell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
export function importTemplate() {
  return `${IMPORT_COLUMNS.join(',')}\r\n${IMPORT_COLUMNS.map((c) => csvCell(EXAMPLE[c] ?? '')).join(',')}\r\n`;
}

/** RFC 4180 CSV → rows of strings (quoted fields, escaped quotes, CRLF/LF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const BOOL_COLS = new Set(['siblingsInSchool', 'transportRequired']);
const toBool = (s: string) => (/^(y|yes|true|1)$/i.test(s) ? true : /^(n|no|false|0)$/i.test(s) ? false : s);

export const MAX_IMPORT_ROWS = 300;

export async function importApplications(req: Request, file: Express.Multer.File | undefined, opts: { campusId: string; dryRun: boolean }) {
  if (!file) throw badRequest('Attach the CSV in the "file" field', 'FILE_REQUIRED', [{ field: 'file', message: 'Choose a CSV file' }]);
  const campus = await one('SELECT id FROM campuses WHERE id = $1', [opts.campusId]);
  if (!campus) throw badRequest('Campus not found', 'CAMPUS_NOT_FOUND', [{ field: 'campusId', message: 'Choose a campus' }]);
  const rows = parseCsv(file.buffer.toString('utf8'));
  if (rows.length < 2) throw badRequest('The file has no data rows — download the template and add one row per application', 'EMPTY_IMPORT');
  const header = rows[0].map((h) => h.trim());
  const unknown = header.filter((h) => h && !(IMPORT_COLUMNS as readonly string[]).includes(h));
  if (unknown.length) throw badRequest(`Unknown column${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`, 'IMPORT_COLUMNS');
  for (const col of ['studentName', 'gradeApplied', 'parentName', 'phone']) {
    if (!header.includes(col)) throw badRequest(`Missing required column "${col}"`, 'IMPORT_COLUMNS');
  }
  const data = rows.slice(1);
  if (data.length > MAX_IMPORT_ROWS) throw badRequest(`Import up to ${MAX_IMPORT_ROWS} applications at a time`, 'IMPORT_TOO_LARGE');

  const results: { row: number; studentName: string; ok: boolean; applicationNo?: string; leadCode?: string; errors?: { field: string; message: string }[] }[] = [];
  for (const [i, cells] of data.entries()) {
    const rowNo = i + 2; // spreadsheet row number (header is row 1)
    const obj: Record<string, unknown> = {};
    header.forEach((h, k) => {
      const val = (cells[k] ?? '').trim();
      if (!h || val === '') return;
      obj[h] = BOOL_COLS.has(h) ? toBool(val) : val;
    });
    const parsed = importRowSchema.safeParse(obj);
    if (!parsed.success) {
      results.push({ row: rowNo, studentName: String(obj.studentName ?? ''), ok: false, errors: parsed.error.issues.map((x) => ({ field: x.path.join('.'), message: x.message })) });
      continue;
    }
    const r = parsed.data;
    const { parentName, phone, email, studentName, source, receivedOn, ...formRest } = r;
    const [first, ...rest] = studentName.split(' ');
    const form: AdmissionForm = { studentFirstName: first, studentLastName: rest.join(' ') || undefined, ...defined(formRest) } as AdmissionForm;
    if (opts.dryRun) {
      const dup = await one<{ code: string }>(
        `SELECT code FROM enquiries WHERE deleted_at IS NULL AND regexp_replace(phone, '\\D', '', 'g') = regexp_replace($1, '\\D', '', 'g')
            AND lower(student_name) = lower($2) AND stage NOT IN ('Enrolled', 'Lost')`, [phone, studentName]);
      results.push(dup
        ? { row: rowNo, studentName, ok: false, errors: [{ field: 'studentName', message: `An open lead already exists for this child (${dup.code})` }] }
        : { row: rowNo, studentName, ok: true });
      continue;
    }
    try {
      const out = await tx((db) => createInTx(db, req, {
        walkIn: { campusId: opts.campusId, parentName, phone, email, studentName, gradeApplied: r.gradeApplied, source },
        form, formSource: 'Manual', receivedOn, submit: formCompleteness(form).missing.length === 0,
      }));
      results.push({ row: rowNo, studentName, ok: true, applicationNo: out.applicationNo, leadCode: out.leadCode });
    } catch (e: any) {
      results.push({ row: rowNo, studentName, ok: false, errors: Array.isArray(e?.details) && e.details.length ? e.details : [{ field: '', message: e?.message ?? 'Could not import this row' }] });
    }
  }
  const imported = results.filter((x) => x.ok).length;
  if (!opts.dryRun && imported) {
    await audit(req, { action: 'create', module: 'admissions', description: `Imported ${imported} admission form${imported === 1 ? '' : 's'} from ${safeFilename(file.originalname)}`, metadata: { rows: data.length, imported } });
  }
  return { dryRun: opts.dryRun, rows: data.length, imported: opts.dryRun ? 0 : imported, valid: imported, failed: results.length - imported, results };
}

/** For the list badge/filter counts. */
export async function formSummary(campusId?: string) {
  return one(
    `SELECT count(*) FILTER (WHERE ${FORM_FILTER.none})::int AS "notReceived",
            count(*) FILTER (WHERE ${FORM_FILTER.manual})::int AS manual,
            count(*) FILTER (WHERE ${FORM_FILTER.upload})::int AS uploaded,
            count(*) FILTER (WHERE ${FORM_FILTER.both})::int AS both
       FROM admissions a WHERE a.status NOT IN ('Enrolled', 'Rejected', 'Withdrawn') AND ($1::uuid IS NULL OR a.campus_id = $1)`,
    [campusId ?? null]);
}

