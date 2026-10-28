/**
 * Applications workflow:
 *   Submitted → Under Review → Assessment Scheduled → Offer Made → Accepted → Enrolled
 *   (Rejected / Withdrawn from any open state)
 * Enrolling creates the Student Master record — student, enrollment, guardian,
 * tracking profile (disabled) — in one transaction, and closes the lead as Enrolled.
 */
import type { Request } from 'express';
import { many, one, query, tx, type Queryable } from '../config/db.js';
import { Where } from '../utils/sql.js';
import { likeTerm, limitOffset, orderBy, type Pagination } from '../utils/pagination.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { nextCode } from '../utils/codes.js';
import { audit } from './audit.service.js';
import { notifyRoles } from './notification.service.js';
import { advanceTo, fmtWhen, resolveLead, writeStage } from './admissions.service.js';
import { FORM_FILTER, formStatusSql } from './admissions-forms.service.js';

const LIVE = `a.status NOT IN ('Enrolled', 'Rejected', 'Withdrawn')`;

/** Today's date (YYYY-MM-DD) in the school timezone, independent of the server clock's zone. */
const kolkataDate = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const NEXT: Record<string, string[]> = {
  Draft: ['Submitted', 'Withdrawn'],
  Submitted: ['Under Review', 'Rejected', 'Withdrawn'],
  'Under Review': ['Assessment Scheduled', 'Offer Made', 'Rejected', 'Withdrawn'],
  'Assessment Scheduled': ['Assessment Scheduled', 'Offer Made', 'Rejected', 'Withdrawn'],
  'Offer Made': ['Accepted', 'Rejected', 'Withdrawn'],
  Accepted: ['Withdrawn'],
  Enrolled: [],
  Rejected: [],
  Withdrawn: [],
};

const DOC_COUNTS = `
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS total, count(*) FILTER (WHERE d.status = 'Verified')::int AS verified
      FROM documents d WHERE d.owner_type = 'admission' AND d.owner_id = a.id AND d.category <> 'Admission form' AND d.deleted_at IS NULL) dc ON true`;

const APP_ROW_SQL = `
  SELECT a.id, a.application_no AS "applicationNo", a.status, a.student_name AS "studentName", a.grade_applied AS grade,
         a.date_of_birth AS "dateOfBirth", a.gender, a.previous_school AS "previousSchool",
         a.documents_complete AS "documentsComplete", dc.total AS "documentsTotal", dc.verified AS "documentsVerified",
         a.assessment_at AS "assessmentAt", a.assessment_score AS "assessmentScore", a.offer_expires_on AS "offerExpiresOn",
         a.fee_paid AS "feePaid", a.student_id AS "studentId", s.admission_no AS "admissionNo",
         a.campus_id AS "campusId", cp.short_name AS "campusName", a.created_at AS "createdAt", a.updated_at AS "updatedAt",
         e.id AS "enquiryId", e.code AS "leadCode", e.parent_name AS "parentName", e.phone, e.curriculum, e.stage,
         co.full_name AS counsellor,
         CASE
           WHEN a.status = 'Enrolled' THEN 'Enrolled — ' || COALESCE(s.admission_no, '')
           WHEN a.status IN ('Rejected', 'Withdrawn') THEN COALESCE(e.lost_reason, a.status)
           WHEN dc.total > dc.verified THEN (dc.total - dc.verified) || ' document' || CASE WHEN dc.total - dc.verified = 1 THEN '' ELSE 's' END || ' to verify'
           WHEN a.status = 'Assessment Scheduled' THEN 'Assessment ' || to_char(a.assessment_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon, HH24:MI')
           WHEN a.status = 'Offer Made' THEN 'Offer expires ' || to_char(a.offer_expires_on, 'DD Mon')
           WHEN a.status = 'Accepted' THEN 'Ready to enrol'
           WHEN a.status = 'Submitted' THEN 'Awaiting review'
           ELSE COALESCE(e.next_action, 'Review application')
         END AS "blockingItem",
         (a.status = 'Offer Made' AND a.offer_expires_on <= current_date + 7) AS "offerExpiring",
         ${formStatusSql()} AS "formStatus", a.form_source AS "formSource", a.form_received_on AS "formReceivedOn",
         (a.form_completed_at IS NOT NULL) AS "formComplete", a.form_document_id AS "formDocumentId",
         a.father_name AS "fatherName", a.mother_name AS "motherName", a.guardian_phone AS "guardianPhone"
    FROM admissions a
    JOIN campuses cp ON cp.id = a.campus_id
    LEFT JOIN enquiries e ON e.id = a.enquiry_id
    LEFT JOIN employees co ON co.id = e.counsellor_id
    LEFT JOIN students s ON s.id = a.student_id
    ${DOC_COUNTS}`;

const SORTS: Record<string, string> = {
  created: 'a.created_at', createdAt: 'a.created_at', student: 'a.student_name', studentName: 'a.student_name',
  applicationNo: 'a.application_no', grade: `NULLIF(regexp_replace(a.grade_applied, '\\D', '', 'g'), '')::int`,
  status: `array_position(ARRAY['Draft','Submitted','Under Review','Assessment Scheduled','Offer Made','Accepted','Enrolled','Rejected','Withdrawn'], a.status)`,
  curriculum: 'e.curriculum', offerExpiresOn: 'a.offer_expires_on', assessmentAt: 'a.assessment_at',
};

export async function listApplications(f: Pagination & { campusId?: string; status?: string; grade?: string; documents?: string; form?: string }) {
  const w = new Where();
  w.addIf(f.campusId, 'a.campus_id = ?');
  if (f.status === 'live') w.add(LIVE);
  else w.addIf(f.status, 'a.status = ?');
  w.addIf(f.grade, 'a.grade_applied = ?');
  if (f.documents === 'complete') w.add('dc.total = dc.verified');
  if (f.documents === 'incomplete') w.add('dc.total > dc.verified');
  if (f.form && FORM_FILTER[f.form]) w.add(FORM_FILTER[f.form]);
  if (f.q) {
    w.add(`(a.student_name ILIKE ? OR a.application_no ILIKE ? OR e.code ILIKE ? OR e.parent_name ILIKE ?
            OR a.father_name ILIKE ? OR a.mother_name ILIKE ? OR a.guardian_phone ILIKE ?)`,
    ...Array(7).fill(likeTerm(f.q)));
  }
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `${APP_ROW_SQL.replace('SELECT a.id,', 'SELECT count(*) OVER() AS total, a.id,')} ${w.sql}
      ORDER BY (a.status IN ('Enrolled', 'Rejected', 'Withdrawn')), ${orderBy(f.sort, f.dir, SORTS, 'created')}
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export async function applicationSummary(campusId?: string) {
  const w = new Where().add('a.academic_year_id = (SELECT id FROM academic_years WHERE is_current)');
  w.addIf(campusId, 'a.campus_id = ?');
  return one(
    `SELECT count(*) FILTER (WHERE ${LIVE})::int AS live,
            count(*) FILTER (WHERE ${LIVE} AND dc.total > dc.verified)::int AS "documentsIncomplete",
            count(*) FILTER (WHERE a.status = 'Under Review')::int AS "underReview",
            count(*) FILTER (WHERE a.status = 'Assessment Scheduled')::int AS "assessmentScheduled",
            count(*) FILTER (WHERE a.offer_expires_on IS NOT NULL)::int AS "offersIssued",
            count(*) FILTER (WHERE a.status = 'Offer Made')::int AS "offersOpen",
            count(*) FILTER (WHERE a.status = 'Accepted')::int AS accepted,
            count(*) FILTER (WHERE a.status = 'Enrolled')::int AS enrolled,
            count(*) FILTER (WHERE a.status = 'Rejected')::int AS rejected,
            count(*) FILTER (WHERE a.status = 'Withdrawn')::int AS withdrawn,
            count(*)::int AS total
       FROM admissions a ${DOC_COUNTS} ${w.sql}`,
    w.params,
  );
}

export async function getApplication(id: string) {
  const app = await one(`${APP_ROW_SQL} WHERE a.id = $1`, [id]);
  if (!app) throw notFound('Application not found', 'APPLICATION_NOT_FOUND');
  const documents = await many(
    `SELECT d.id, d.name, d.status, d.verified_at AS "verifiedAt", u.full_name AS "verifiedBy",
            (d.storage_key IS NOT NULL) AS "hasFile", d.original_name AS "fileName", d.mime_type AS "mimeType", d.size_bytes AS "sizeBytes"
       FROM documents d LEFT JOIN users u ON u.id = d.verified_by
      WHERE d.owner_type = 'admission' AND d.owner_id = $1 AND d.category <> 'Admission form' AND d.deleted_at IS NULL ORDER BY d.created_at, d.name`, [id]);
  return { ...app, documents };
}
// Opening an application (existing lead or walk-in, with the admission form) lives in admissions-forms.service.ts.

async function lockApp(id: string, db: Queryable) {
  const app = await one('SELECT * FROM admissions WHERE id = $1 FOR UPDATE', [id], db);
  if (!app) throw notFound('Application not found', 'APPLICATION_NOT_FOUND');
  return app;
}

const APP_COLS: Record<string, string> = {
  studentName: 'student_name', dateOfBirth: 'date_of_birth', gender: 'gender', previousSchool: 'previous_school',
  assessmentAt: 'assessment_at', assessmentScore: 'assessment_score', offerExpiresOn: 'offer_expires_on', feePaid: 'fee_paid',
};

export async function updateApplication(req: Request, id: string, input: Record<string, unknown>) {
  return tx(async (db) => {
    const app = await lockApp(id, db);
    if (['Enrolled', 'Rejected', 'Withdrawn'].includes(app.status)) throw badRequest(`This application is ${app.status.toLowerCase()}`, 'APPLICATION_CLOSED');
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, val] of Object.entries(input)) {
      if (!APP_COLS[k] || val === undefined) continue;
      params.push(val);
      sets.push(`${APP_COLS[k]} = $${params.length}`);
    }
    if (!sets.length) throw badRequest('Nothing to update');
    params.push(id);
    await query(`UPDATE admissions SET ${sets.join(', ')} WHERE id = $${params.length}`, params, db);
    await audit(req, { action: 'update', module: 'admissions', description: `Updated application ${app.application_no} (${Object.keys(input).join(', ')})`, entityType: 'admission', entityId: id }, db);
  });
}

export async function setStatus(req: Request, id: string, input: { status: string; note: string; assessmentAt?: string; assessmentScore?: number; offerExpiresOn?: string }) {
  return tx(async (db) => {
    const app = await lockApp(id, db);
    const to = input.status;
    if (!NEXT[app.status]?.includes(to)) {
      throw badRequest(`An application that is ${app.status} cannot move to ${to}`, 'INVALID_TRANSITION');
    }
    const docs = await one<{ total: number; verified: number }>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'Verified')::int AS verified
         FROM documents WHERE owner_type = 'admission' AND owner_id = $1 AND category <> 'Admission form' AND deleted_at IS NULL`, [id], db);
    if (to === 'Offer Made' && docs && docs.total > docs.verified) {
      throw badRequest(`Verify all documents before making an offer (${docs.total - docs.verified} outstanding)`, 'DOCUMENTS_INCOMPLETE');
    }
    if (to === 'Accepted' && app.offer_expires_on && app.offer_expires_on < kolkataDate()) {
      throw badRequest('The offer has expired — extend the offer date first', 'OFFER_EXPIRED');
    }
    const decided = ['Offer Made', 'Accepted', 'Rejected', 'Withdrawn'].includes(to);
    await query(
      `UPDATE admissions SET status = $2,
              assessment_at = COALESCE($3, assessment_at),
              assessment_score = COALESCE($4, assessment_score),
              offer_expires_on = CASE WHEN $2 = 'Offer Made' THEN COALESCE($5::date, offer_expires_on, current_date + 14) ELSE COALESCE($5::date, offer_expires_on) END,
              decided_by = CASE WHEN $6 THEN $7::uuid ELSE decided_by END,
              decided_at = CASE WHEN $6 THEN now() ELSE decided_at END
        WHERE id = $1`,
      [id, to, input.assessmentAt ?? null, input.assessmentScore ?? null, input.offerExpiresOn ?? null, decided, req.user!.id], db);

    if (app.enquiry_id) {
      const lead = await resolveLead(app.enquiry_id, db, true);
      const note = `${app.application_no}: ${input.note}`;
      if (to === 'Assessment Scheduled') {
        await advanceTo(db, req, lead as any, 'Assessment', note);
        // A reschedule replaces the open assessment follow-up rather than adding a second one.
        await query(
          `UPDATE follow_ups SET status = 'Cancelled' WHERE enquiry_id = $1 AND status = 'Scheduled' AND notes = 'Entrance assessment'`,
          [lead.id], db);
        await query(
          `INSERT INTO follow_ups (enquiry_id, follow_up_type, scheduled_at, notes, status, assigned_to, created_by)
           VALUES ($1, 'Meeting', $2, 'Entrance assessment', 'Scheduled', $3, $4)`,
          [lead.id, input.assessmentAt, lead.counsellor_id, req.user!.id], db);
        await query(`UPDATE enquiries SET next_action = $2, next_action_at = $3 WHERE id = $1`, [lead.id, `Assessment ${fmtWhen(input.assessmentAt!)}`, input.assessmentAt], db);
      } else if (to === 'Offer Made' || to === 'Accepted') {
        await advanceTo(db, req, lead as any, 'Offer', note);
        const exp = (await one<{ d: string }>('SELECT to_char(offer_expires_on, \'DD Mon\') AS d FROM admissions WHERE id = $1', [id], db))?.d;
        await query(`UPDATE enquiries SET next_action = $2 WHERE id = $1`, [lead.id, to === 'Accepted' ? 'Offer accepted — ready to enrol' : `Offer expires ${exp}`], db);
        if (to === 'Offer Made') {
          await query(
            `INSERT INTO communications (channel, direction, enquiry_id, counterpart, subject, status, sent_by)
             VALUES ('Email', 'outbound', $1, $2, 'Offer letter issued', 'Logged', $3)`, [lead.id, lead.parent_name, req.user!.id], db);
        }
      } else if ((to === 'Rejected' || to === 'Withdrawn') && lead.stage !== 'Lost') {
        await writeStage(db, req, lead as any, 'Lost', note, { lostReason: to === 'Rejected' ? `Application not successful — ${input.note}` : `Withdrawn — ${input.note}` });
        await query(`UPDATE follow_ups SET status = 'Cancelled' WHERE enquiry_id = $1 AND status = 'Scheduled'`, [lead.id], db);
      }
    }
    await audit(req, {
      action: decided ? 'approve' : 'update', module: 'admissions',
      description: `Application ${app.application_no}: ${app.status} → ${to}`, entityType: 'admission', entityId: id,
      metadata: { from: app.status, to, note: input.note },
    }, db);
    return { status: to };
  });
}

export async function setDocumentStatus(req: Request, id: string, docId: string, status: string) {
  return tx(async (db) => {
    const app = await lockApp(id, db);
    if (['Enrolled', 'Rejected', 'Withdrawn'].includes(app.status)) throw badRequest(`This application is ${app.status.toLowerCase()}`, 'APPLICATION_CLOSED');
    const doc = await one(
      `UPDATE documents SET status = $3,
              verified_by = CASE WHEN $3 = 'Verified' THEN $4::uuid ELSE NULL END,
              verified_at = CASE WHEN $3 = 'Verified' THEN now() ELSE NULL END
        WHERE id = $2 AND owner_type = 'admission' AND owner_id = $1 AND category <> 'Admission form' AND deleted_at IS NULL RETURNING name`,
      [id, docId, status, req.user!.id], db);
    if (!doc) throw notFound('Document not found', 'DOCUMENT_NOT_FOUND');
    const c = await one<{ complete: boolean }>(
      `SELECT bool_and(status = 'Verified') AS complete FROM documents
        WHERE owner_type = 'admission' AND owner_id = $1 AND category <> 'Admission form' AND deleted_at IS NULL`, [id], db);
    await query('UPDATE admissions SET documents_complete = $2 WHERE id = $1', [id, !!c?.complete], db);
    await audit(req, { action: status === 'Verified' ? 'approve' : 'update', module: 'admissions', description: `${doc.name} marked ${status} on ${app.application_no}`, entityType: 'admission', entityId: id }, db);
    return { documentsComplete: !!c?.complete };
  });
}

// ---------------------------------------------------------------------------
// Enrol → Student Master
// ---------------------------------------------------------------------------
/**
 * Anything left out is taken from the admission form saved on the application
 * (student name, DOB, gender, address, primary contact), so the office does not
 * retype what the family already wrote on the form.
 */
export interface EnrolInput {
  sectionId: string; firstName?: string; lastName?: string; dateOfBirth?: string; gender?: 'M' | 'F' | 'O'; admittedOn?: string;
  house?: string; address?: string; city?: string; pincode?: string;
  guardian?: { parentId?: string; fullName?: string; phone?: string; email?: string; relationship?: string };
  transport?: { routeId: string; stopId?: string };
}

type FormData = Record<string, string | boolean | undefined>;
const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : undefined);

/** Fills enrolment fields from the admission form; explicit input always wins. */
function fromForm(app: any, input: EnrolInput) {
  const f = (app.form_data ?? {}) as FormData;
  const pc = str(f.primaryContact) ?? (str(f.fatherName) && str(f.fatherPhone) ? 'Father' : str(f.motherName) && str(f.motherPhone) ? 'Mother' : str(f.guardianName) ? 'Guardian' : undefined);
  const key = pc === 'Mother' ? 'mother' : pc === 'Guardian' ? 'guardian' : 'father';
  const [first, ...rest] = String(app.student_name ?? '').split(' ');
  const field = (k: string, m: string) => [{ field: k, message: m }];
  const out = {
    firstName: input.firstName ?? str(f.studentFirstName) ?? first,
    lastName: input.lastName ?? str(f.studentLastName) ?? (rest.join(' ') || undefined),
    dateOfBirth: input.dateOfBirth ?? str(f.dateOfBirth) ?? app.date_of_birth ?? undefined,
    gender: input.gender ?? (str(f.gender) as EnrolInput['gender']) ?? app.gender ?? undefined,
    address: input.address ?? app.address ?? undefined,
    city: input.city ?? app.city ?? undefined,
    pincode: input.pincode ?? app.pincode ?? undefined,
    guardian: {
      parentId: input.guardian?.parentId,
      fullName: input.guardian?.fullName ?? (pc ? str(f[`${key}Name`]) : undefined),
      phone: input.guardian?.phone ?? (pc ? str(f[`${key}Phone`]) : undefined),
      email: input.guardian?.email ?? (pc ? str(f[`${key}Email`]) : undefined),
      relationship: input.guardian?.relationship ?? (pc === 'Guardian' ? 'Guardian' : pc ?? 'Guardian'),
    },
  };
  if (!out.firstName) throw badRequest('Enter the student’s first name', 'VALIDATION_ERROR', field('firstName', 'First name is required'));
  if (!out.lastName) throw badRequest('Enter the student’s last name', 'VALIDATION_ERROR', field('lastName', 'Last name is required'));
  if (!out.dateOfBirth) throw badRequest('Enter the date of birth', 'VALIDATION_ERROR', field('dateOfBirth', 'Date of birth is required'));
  if (!out.gender) throw badRequest('Select a gender', 'VALIDATION_ERROR', field('gender', 'Select a gender'));
  // The other parent on the form is linked as a second guardian.
  const other = pc === 'Father' || pc === undefined ? 'mother' : pc === 'Mother' ? 'father' : null;
  const second = other && str(f[`${other}Name`]) && str(f[`${other}Phone`])
    ? { fullName: str(f[`${other}Name`])!, phone: str(f[`${other}Phone`])!, email: str(f[`${other}Email`]) ?? null, occupation: str(f[`${other}Occupation`]) ?? null, relationship: other === 'mother' ? 'Mother' : 'Father' }
    : null;
  return {
    ...out, second,
    primaryOccupation: pc ? str(f[`${key}Occupation`]) ?? null : null,
    bloodGroup: (app.blood_group as string | null) ?? null,
    medicalNotes: (app.medical_notes as string | null) ?? null,
  };
}

export async function enrol(req: Request, id: string, raw: EnrolInput) {
  const user = req.user!;
  return tx(async (db) => {
    const app = await lockApp(id, db);
    if (app.student_id || app.status === 'Enrolled') throw conflict('This applicant is already enrolled', 'ALREADY_ENROLLED');
    if (app.status !== 'Accepted') throw badRequest('Only accepted offers can be enrolled', 'NOT_ACCEPTED');
    const lead = app.enquiry_id ? await resolveLead(app.enquiry_id, db, true) : null;
    const input = { ...raw, ...fromForm(app, raw) } as ReturnType<typeof fromForm> & EnrolInput & { firstName: string; lastName: string; dateOfBirth: string; gender: 'M' | 'F' | 'O' };

    const section = await one<{ id: string; campus_id: string; academic_year_id: string; name: string; grade: string; capacity: number; enrolled: number }>(
      `SELECT sec.id, c.campus_id, sec.academic_year_id, sec.name, c.name AS grade, sec.capacity,
              (SELECT count(*)::int FROM enrollments en WHERE en.section_id = sec.id AND en.status = 'active') AS enrolled
         FROM sections sec JOIN classes c ON c.id = sec.class_id WHERE sec.id = $1`, [input.sectionId], db);
    const field = (f: string, m: string) => [{ field: f, message: m }];
    if (!section) throw badRequest('Section not found', 'SECTION_NOT_FOUND', field('sectionId', 'Choose a section'));
    if (section.campus_id !== app.campus_id) throw badRequest('The section is not on the applicant’s campus', 'SECTION_CAMPUS_MISMATCH', field('sectionId', 'Choose a section on the applicant’s campus'));
    if (section.enrolled >= section.capacity) throw conflict(`${section.grade}${section.name} is full (${section.capacity} students)`, 'SECTION_FULL');

    // Guardian: explicit parent → same phone as an existing parent → new parent record.
    const g = input.guardian;
    let parentId = g.parentId ?? null;
    if (parentId) {
      const p = await one('SELECT id FROM parents WHERE id = $1 AND deleted_at IS NULL', [parentId], db);
      if (!p) throw badRequest('Parent not found', 'PARENT_NOT_FOUND', field('guardian.parentId', 'Parent not found'));
    }
    const gName = g.fullName ?? lead?.parent_name;
    const gPhone = g.phone ?? lead?.phone;
    const gEmail = g.email ?? lead?.email ?? null;
    if (!parentId) {
      if (!gName || !gPhone) throw badRequest('Guardian name and phone are required', 'GUARDIAN_REQUIRED', field('guardian.fullName', 'Enter the guardian’s name'));
      const same = await one<{ id: string }>(
        `SELECT id FROM parents WHERE deleted_at IS NULL AND regexp_replace(phone, '\\D', '', 'g') = regexp_replace($1, '\\D', '', 'g') ORDER BY created_at LIMIT 1`,
        [gPhone], db);
      parentId = same?.id ?? null;
    }
    let parentCreated = false;
    if (!parentId) {
      const code = await nextCode('parents', 'parent_code', 'PAR-', db);
      const p = await one<{ id: string }>(
        `INSERT INTO parents (parent_code, full_name, phone, email, occupation, address, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [code, gName, gPhone, gEmail, input.primaryOccupation, input.address ?? null, user.id], db);
      parentId = p!.id;
      parentCreated = true;
    }

    const year = kolkataDate().slice(0, 4);
    const admissionNo = await nextCode('students', 'admission_no', `HS-${year}-`, db);
    const s = await one<{ id: string }>(
      `INSERT INTO students (admission_no, first_name, last_name, date_of_birth, gender, campus_id, section_id, academic_year_id,
                             house, address, city, pincode, phone, admitted_on, created_by, updated_by, blood_group, medical_notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14::date, current_date),$15,$15,$16,$17) RETURNING id`,
      [admissionNo, input.firstName, input.lastName, input.dateOfBirth, input.gender, section.campus_id, section.id, section.academic_year_id,
        input.house ?? null, input.address ?? null, input.city ?? null, input.pincode ?? null, gPhone ?? null, input.admittedOn ?? null, user.id,
        input.bloodGroup, input.medicalNotes],
      db);
    const studentId = s!.id;
    const roll = await one<{ n: number }>('SELECT count(*)::int + 1 AS n FROM enrollments WHERE section_id = $1', [section.id], db);
    await query(
      `INSERT INTO enrollments (student_id, section_id, academic_year_id, roll_no, enrolled_on) VALUES ($1,$2,$3,$4, COALESCE($5::date, current_date))`,
      [studentId, section.id, section.academic_year_id, roll!.n, input.admittedOn ?? null], db);
    await query(
      `INSERT INTO student_guardians (student_id, parent_id, relationship, is_primary) VALUES ($1,$2,$3,true)`,
      [studentId, parentId, g.relationship], db);
    // Second parent from the admission form (matched by phone, else created).
    let secondParentId: string | null = null;
    const sec = input.second;
    if (sec && sec.phone.replace(/\D/g, '') !== String(gPhone ?? '').replace(/\D/g, '')) {
      const same = await one<{ id: string }>(
        `SELECT id FROM parents WHERE deleted_at IS NULL AND regexp_replace(phone, '\\D', '', 'g') = regexp_replace($1, '\\D', '', 'g') ORDER BY created_at LIMIT 1`,
        [sec.phone], db);
      secondParentId = same?.id ?? null;
      if (!secondParentId) {
        const code = await nextCode('parents', 'parent_code', 'PAR-', db);
        const p = await one<{ id: string }>(
          `INSERT INTO parents (parent_code, full_name, phone, email, occupation, address, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [code, sec.fullName, sec.phone, sec.email, sec.occupation, input.address ?? null, user.id], db);
        secondParentId = p!.id;
      }
      if (secondParentId !== parentId) {
        await query(
          `INSERT INTO student_guardians (student_id, parent_id, relationship, is_primary) VALUES ($1,$2,$3,false) ON CONFLICT DO NOTHING`,
          [studentId, secondParentId, sec.relationship], db);
      }
    }
    if (input.transport) {
      const route = await one('SELECT id FROM transport_routes WHERE id = $1', [input.transport.routeId], db);
      if (!route) throw badRequest('Route not found', 'ROUTE_NOT_FOUND', field('transport.routeId', 'Choose a route'));
      await query('INSERT INTO student_transport (student_id, route_id, stop_id) VALUES ($1,$2,$3)', [studentId, input.transport.routeId, input.transport.stopId ?? null], db);
    }
    await query(
      `INSERT INTO student_tracking_profiles (student_id, tracking_enabled, tracking_status) VALUES ($1, false, 'disabled')`,
      [studentId], db);
    await query(
      `INSERT INTO student_timeline_events (student_id, occurred_on, title, body, category, tone, created_by)
       VALUES ($1, COALESCE($2::date, current_date), 'Admitted', $3, 'admission', 'teal', $4)`,
      [studentId, input.admittedOn ?? null, `Enrolled from application ${app.application_no}${lead ? ` (lead ${lead.code})` : ''}`, user.id], db);

    await query(
      `UPDATE admissions SET status = 'Enrolled', student_id = $2, student_name = $3, date_of_birth = $4, gender = $5,
              decided_by = $6, decided_at = now() WHERE id = $1`,
      [id, studentId, `${input.firstName} ${input.lastName}`, input.dateOfBirth, input.gender, user.id], db);

    if (lead) {
      await writeStage(db, req, lead as any, 'Enrolled', `${app.application_no} enrolled as ${admissionNo} (${section.grade}${section.name})`);
      await query(`UPDATE follow_ups SET status = 'Cancelled' WHERE enquiry_id = $1 AND status = 'Scheduled'`, [lead.id], db);
      const reward = await one<{ value: unknown }>(`SELECT value FROM system_settings WHERE key = 'admissions.referral_reward'`, [], db);
      await query(
        `UPDATE referrals SET status = 'Enrolled', reward_status = CASE WHEN reward_status = 'Credited' THEN reward_status ELSE 'Pending' END,
                reward_amount = CASE WHEN reward_amount > 0 THEN reward_amount ELSE $2 END
          WHERE enquiry_id = $1`,
        [lead.id, Number(reward?.value ?? 0) || 0], db);
      await query(
        `INSERT INTO communications (channel, direction, enquiry_id, student_id, parent_id, counterpart, subject, status, sent_by)
         VALUES ('Note', 'internal', $1, $2, $3, $4, $5, 'Internal', $6)`,
        [lead.id, studentId, parentId, lead.parent_name, `Enrolled — Student Master ${admissionNo} created`, user.id], db);
    }

    await audit(req, {
      action: 'create', module: 'students',
      description: `Created student ${input.firstName} ${input.lastName} (${admissionNo}) from application ${app.application_no}`,
      entityType: 'student', entityId: studentId, metadata: { applicationId: id, parentCreated },
    }, db);
    await audit(req, { action: 'approve', module: 'admissions', description: `Application ${app.application_no} enrolled as ${admissionNo}`, entityType: 'admission', entityId: id }, db);
    await notifyRoles(['principal'], {
      category: 'Completed', icon: 'userCheck', topic: 'admissions',
      title: `New admission — ${input.firstName} ${input.lastName}`,
      body: `${section.grade}${section.name} · ${admissionNo}`,
      route: `/student-360/${studentId}`, entityType: 'student', entityId: studentId,
    }, db);
    return { studentId, admissionNo, parentId, parentCreated, secondParentId, section: `${section.grade}${section.name}` };
  });
}
