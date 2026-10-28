/**
 * Admissions CRM — leads (enquiries), stage changes, counsellor assignment,
 * follow-ups, communications and the counselling pipeline.
 *
 * Pipeline: New Lead → Contacted → Qualified → Visit Scheduled → Visit Completed
 *           → Application → Assessment → Offer → Enrolled (or Lost).
 * 'Enrolled' is only reachable through the application enrol step, which
 * creates the Student Master record (see admissions-applications.service.ts).
 */
import type { Request } from 'express';
import { many, one, query, tx, type Queryable } from '../config/db.js';
import { Where } from '../utils/sql.js';
import { likeTerm, limitOffset, orderBy, type Pagination } from '../utils/pagination.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { nextCode } from '../utils/codes.js';
import { audit } from './audit.service.js';
import { notifyUsers } from './notification.service.js';
import { STAGES } from '../validators/admissions.validators.js';

export type Stage = (typeof STAGES)[number] | 'Lost';

/** SQL array literal of the nine pipeline stages (trusted constant). */
export const STAGE_SQL = `ARRAY[${STAGES.map((s) => `'${s}'`).join(',')}]::text[]`;

/** Furthest pipeline stage an enquiry ever reached (1 = New Lead … 9 = Enrolled), from its history. */
export const reachSql = (alias = 'e') => `GREATEST(
  COALESCE(array_position(${STAGE_SQL}, ${alias}.stage), 0),
  COALESCE((SELECT max(array_position(${STAGE_SQL}, h.to_stage)) FROM enquiry_stage_history h WHERE h.enquiry_id = ${alias}.id), 0))`;

export const stageIndex = (s: string) => (STAGES as readonly string[]).indexOf(s);

export const STANDARD_DOCUMENTS = ['Birth certificate', 'Previous report card', 'Address proof', 'Photograph'];

const TZ = 'Asia/Kolkata';
export function fmtWhen(d: Date | string) {
  const dt = new Date(d);
  const date = dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: TZ });
  const time = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
  return `${date}, ${time}`;
}

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export async function resolveLead(idOrCode: string, db?: Queryable, lock = false) {
  const row = await one(
    `SELECT * FROM enquiries WHERE ${isUuid(idOrCode) ? 'id = $1' : 'code = upper($1)'} AND deleted_at IS NULL ${lock ? 'FOR UPDATE' : ''}`,
    [idOrCode], db,
  );
  if (!row) throw notFound('Lead not found', 'LEAD_NOT_FOUND');
  return row;
}

/** Writes a stage change + history row. Caller has validated the move. */
export async function writeStage(db: Queryable, req: Request, lead: { id: string; stage: string }, to: Stage, note: string, extra: { lostReason?: string | null } = {}) {
  await query(
    `UPDATE enquiries SET stage = $2, lost_reason = $3, updated_by = $4,
            next_action = CASE WHEN $2 IN ('Enrolled', 'Lost') THEN $5 ELSE next_action END,
            next_action_at = CASE WHEN $2 IN ('Enrolled', 'Lost') THEN NULL ELSE next_action_at END
      WHERE id = $1`,
    [lead.id, to, to === 'Lost' ? extra.lostReason ?? null : null, req.user!.id, to === 'Enrolled' ? 'Onboarding complete' : 'Closed — lost'],
    db,
  );
  await query(
    `INSERT INTO enquiry_stage_history (enquiry_id, from_stage, to_stage, changed_by, note) VALUES ($1,$2,$3,$4,$5)`,
    [lead.id, lead.stage, to, req.user!.id, note], db,
  );
  // Keep a linked parent referral in step with the lead.
  const refStatus = to === 'Enrolled' ? 'Enrolled' : to === 'Lost' ? 'Lost' : 'Contacted';
  await query(
    `UPDATE referrals SET status = $2 WHERE enquiry_id = $1 AND status <> 'Enrolled' AND (status <> $2)
        AND ($2 <> 'Contacted' OR status = 'Submitted')`,
    [lead.id, refStatus], db,
  );
  // Leaving New Lead means first contact has happened.
  if (lead.stage === 'New Lead' && to !== 'Lost') {
    await query(
      `UPDATE follow_ups SET status = 'Completed', completed_at = now(), outcome = COALESCE(outcome, 'Contact made')
        WHERE enquiry_id = $1 AND status = 'Scheduled' AND notes = 'First contact'`, [lead.id], db);
  }
  lead.stage = to;
  await refreshNextAction(db, lead.id);
}

/** Moves a lead forward to `to` only if it has not already passed it. */
export async function advanceTo(db: Queryable, req: Request, lead: { id: string; stage: string }, to: Stage, note: string) {
  if (lead.stage === 'Lost' || lead.stage === 'Enrolled') return false;
  if (stageIndex(lead.stage) >= stageIndex(to)) return false;
  await writeStage(db, req, lead, to, note);
  return true;
}

/** Creates an application (with the standard document checklist) for a lead. */
export async function createApplicationRow(db: Queryable, req: Request, lead: any, input: { dateOfBirth?: string; gender?: string; previousSchool?: string } = {}) {
  const existing = await one(`SELECT id FROM admissions WHERE enquiry_id = $1 AND status NOT IN ('Rejected', 'Withdrawn')`, [lead.id], db);
  if (existing) throw conflict('This lead already has an open application', 'APPLICATION_EXISTS');
  const year = await one<{ id: string; label: string; starts_on: string }>('SELECT id, label, starts_on FROM academic_years WHERE is_current', [], db);
  const yearId = lead.academic_year_id ?? year?.id;
  if (!yearId) throw badRequest('No current academic year is configured', 'NO_CURRENT_YEAR');
  const prefix = `APP-${String(year?.starts_on ?? new Date().toISOString()).slice(0, 4)}-`;
  const appNo = await nextCode('admissions', 'application_no', prefix, db);
  const app = await one<{ id: string }>(
    `INSERT INTO admissions (application_no, enquiry_id, campus_id, academic_year_id, student_name, date_of_birth, gender,
                             grade_applied, previous_school, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Submitted',$10) RETURNING id`,
    [appNo, lead.id, lead.campus_id, yearId, lead.student_name, input.dateOfBirth ?? lead.student_dob ?? null, input.gender ?? null,
      lead.grade_applied, input.previousSchool ?? null, req.user!.id],
    db,
  );
  for (const name of STANDARD_DOCUMENTS) {
    await query(
      `INSERT INTO documents (owner_type, owner_id, name, category, status, requested_on, uploaded_by)
       VALUES ('admission', $1, $2, 'Admission', 'Pending', current_date, $3)`,
      [app!.id, name, req.user!.id], db,
    );
  }
  await audit(req, { action: 'create', module: 'admissions', description: `Application ${appNo} opened for lead ${lead.code}`, entityType: 'admission', entityId: app!.id }, db);
  return { id: app!.id, applicationNo: appNo };
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------
export const LEAD_ROW_SQL = `
  SELECT e.id, e.code, e.parent_name AS "parentName", e.phone, e.email, e.student_name AS "studentName",
         e.student_dob AS "studentDob", e.grade_applied AS grade, e.curriculum, e.source, e.campaign, e.stage,
         e.lead_score AS score, e.counsellor_id AS "counsellorId", co.full_name AS counsellor,
         e.transport_required AS "transportRequired", e.next_action AS "nextAction", e.next_action_at AS "nextActionAt",
         (e.next_action_at < now() AND e.stage NOT IN ('Enrolled', 'Lost')) AS overdue,
         e.lost_reason AS "lostReason", e.acquisition_cost AS "acquisitionCost",
         e.campus_id AS "campusId", cp.short_name AS "campusName", e.created_at AS "createdAt", e.updated_at AS "updatedAt",
         app.id AS "applicationId", app.application_no AS "applicationNo", app.status AS "applicationStatus", app.student_id AS "studentId"
    FROM enquiries e
    JOIN campuses cp ON cp.id = e.campus_id
    LEFT JOIN employees co ON co.id = e.counsellor_id
    LEFT JOIN LATERAL (
      SELECT a.id, a.application_no, a.status, a.student_id FROM admissions a
       WHERE a.enquiry_id = e.id ORDER BY (a.status IN ('Rejected', 'Withdrawn')), a.created_at DESC LIMIT 1) app ON true`;

const LEAD_SORTS: Record<string, string> = {
  created: 'e.created_at',
  createdAt: 'e.created_at',
  code: 'e.code',
  student: 'e.student_name',
  studentName: 'e.student_name',
  parent: 'e.parent_name',
  grade: `NULLIF(regexp_replace(e.grade_applied, '\\D', '', 'g'), '')::int`,
  curriculum: 'e.curriculum',
  source: 'e.source',
  stage: `COALESCE(array_position(${STAGE_SQL}, e.stage), 99)`,
  score: 'e.lead_score',
  counsellor: 'co.full_name',
  next: 'e.next_action_at',
  nextAction: 'e.next_action_at',
};

export interface LeadFilters extends Pagination {
  campusId?: string; stage?: string; stages?: string[]; source?: string; counsellorId?: string; grade?: string;
  open?: boolean; overdue?: boolean; from?: string; to?: string;
}

export async function listLeads(f: LeadFilters) {
  const w = new Where().add('e.deleted_at IS NULL');
  w.addIf(f.campusId, 'e.campus_id = ?');
  w.addIf(f.stage, 'e.stage = ?');
  if (f.stages?.length) w.add('e.stage = ANY(?)', f.stages);
  w.addIf(f.source, 'e.source = ?');
  if (f.counsellorId === 'unassigned') w.add('e.counsellor_id IS NULL');
  else w.addIf(f.counsellorId, 'e.counsellor_id = ?');
  w.addIf(f.grade, 'e.grade_applied = ?');
  if (f.open) w.add(`e.stage NOT IN ('Enrolled', 'Lost')`);
  if (f.overdue) w.add(`e.next_action_at < now() AND e.stage NOT IN ('Enrolled', 'Lost')`);
  w.addIf(f.from, `e.created_at >= ((?::date)::timestamp AT TIME ZONE 'Asia/Kolkata')`);
  w.addIf(f.to, `e.created_at < ((?::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`);
  if (f.q) w.add('(e.student_name ILIKE ? OR e.parent_name ILIKE ? OR e.code ILIKE ? OR e.phone ILIKE ?)', likeTerm(f.q), likeTerm(f.q), likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `${LEAD_ROW_SQL.replace('SELECT e.id,', 'SELECT count(*) OVER() AS total, e.id,')} ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, LEAD_SORTS, 'created')}, e.code DESC
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

/** Open leads grouped by the nine pipeline stages (Lost excluded). */
export async function pipeline(campusId?: string) {
  const w = new Where().add('e.deleted_at IS NULL').add(`e.stage <> 'Lost'`);
  w.addIf(campusId, 'e.campus_id = ?');
  // Enrolled column shows the last 60 days only, so the board stays about live work.
  w.add(`(e.stage <> 'Enrolled' OR e.updated_at > now() - interval '60 days')`);
  const rows = await many(`${LEAD_ROW_SQL} ${w.sql} ORDER BY e.lead_score DESC, e.created_at DESC`, w.params);
  return STAGES.map((stage) => {
    const items = rows.filter((r) => r.stage === stage);
    return { stage, count: items.length, leads: items };
  });
}

export async function counsellors(campusId?: string) {
  return many(
    `SELECT emp.id, emp.full_name AS "fullName", emp.designation, cp.short_name AS "campusName",
            (emp.user_id IS NOT NULL) AS "hasAccount",
            count(e.id) FILTER (WHERE e.stage NOT IN ('Enrolled', 'Lost') AND ($1::uuid IS NULL OR e.campus_id = $1))::int AS "openLeads"
       FROM employees emp
       JOIN campuses cp ON cp.id = emp.campus_id
       LEFT JOIN enquiries e ON e.counsellor_id = emp.id AND e.deleted_at IS NULL
      WHERE emp.deleted_at IS NULL AND emp.employment_status = 'active'
        AND (emp.designation ILIKE '%admission%' OR emp.department = 'Front Office')
      GROUP BY emp.id, cp.short_name ORDER BY emp.full_name`,
    [campusId ?? null],
  );
}

// ---------------------------------------------------------------------------
// Lead profile
// ---------------------------------------------------------------------------
export async function getLead(idOrCode: string) {
  const base = await resolveLead(idOrCode);
  const id = base.id;
  const lead = await one(`${LEAD_ROW_SQL} WHERE e.id = $1`, [id]);
  const [history, followUps, communications, application, referral] = await Promise.all([
    many(`SELECT h.id, h.from_stage AS "fromStage", h.to_stage AS "toStage", h.note, h.changed_at AS "changedAt", u.full_name AS "changedBy"
            FROM enquiry_stage_history h LEFT JOIN users u ON u.id = h.changed_by
           WHERE h.enquiry_id = $1 ORDER BY h.changed_at DESC, h.id DESC`, [id]),
    many(`SELECT f.id, f.follow_up_type AS type, f.scheduled_at AS "scheduledAt", f.completed_at AS "completedAt", f.outcome, f.notes,
                 f.status, f.assigned_to AS "assignedTo", emp.full_name AS "assignedName",
                 (f.status = 'Scheduled' AND f.scheduled_at < now()) AS overdue
            FROM follow_ups f LEFT JOIN employees emp ON emp.id = f.assigned_to
           WHERE f.enquiry_id = $1
           ORDER BY (f.status = 'Scheduled') DESC, CASE WHEN f.status = 'Scheduled' THEN f.scheduled_at END ASC, f.scheduled_at DESC`, [id]),
    many(`SELECT c.id, c.channel, c.direction, c.counterpart, c.subject, c.body, c.status, c.occurred_at AS "occurredAt",
                 COALESCE(u.full_name, CASE WHEN c.channel = 'WhatsApp' AND c.direction = 'outbound' THEN 'WhatsApp AI' END) AS "sentBy",
                 (c.sent_by IS NULL AND c.direction = 'outbound') AS automated
            FROM communications c LEFT JOIN users u ON u.id = c.sent_by
           WHERE c.enquiry_id = $1 ORDER BY c.occurred_at DESC LIMIT 50`, [id]),
    one(`SELECT a.id, a.application_no AS "applicationNo", a.status, a.student_name AS "studentName", a.date_of_birth AS "dateOfBirth",
                a.gender, a.grade_applied AS grade, a.previous_school AS "previousSchool", a.documents_complete AS "documentsComplete",
                a.assessment_at AS "assessmentAt", a.assessment_score AS "assessmentScore", a.offer_expires_on AS "offerExpiresOn",
                a.fee_paid AS "feePaid", a.student_id AS "studentId", s.admission_no AS "admissionNo", a.decided_at AS "decidedAt",
                d.full_name AS "decidedBy", a.created_at AS "createdAt", a.campus_id AS "campusId",
                COALESCE((SELECT json_agg(json_build_object('id', doc.id, 'name', doc.name, 'status', doc.status, 'verifiedAt', doc.verified_at,
                                                            'hasFile', doc.storage_key IS NOT NULL, 'fileName', doc.original_name, 'mimeType', doc.mime_type) ORDER BY doc.created_at, doc.name)
                            FROM documents doc WHERE doc.owner_type = 'admission' AND doc.owner_id = a.id AND doc.category <> 'Admission form' AND doc.deleted_at IS NULL), '[]') AS documents,
                CASE WHEN a.form_entered_at IS NOT NULL AND a.form_document_id IS NOT NULL THEN 'Both'
                     WHEN a.form_document_id IS NOT NULL THEN 'Uploaded'
                     WHEN a.form_entered_at IS NOT NULL THEN 'Entered manually' ELSE 'Not received' END AS "formStatus",
                a.form_source AS "formSource", a.form_received_on AS "formReceivedOn", (a.form_completed_at IS NOT NULL) AS "formComplete",
                a.form_document_id AS "formDocumentId", a.address, a.city, a.pincode, a.father_name AS "fatherName", a.mother_name AS "motherName",
                a.form_data AS "formData"
           FROM admissions a
           LEFT JOIN students s ON s.id = a.student_id
           LEFT JOIN users d ON d.id = a.decided_by
          WHERE a.enquiry_id = $1
          ORDER BY (a.status IN ('Rejected', 'Withdrawn')), a.created_at DESC LIMIT 1`, [id]),
    one(`SELECT r.id, r.status, r.reward_status AS "rewardStatus", p.id AS "parentId", p.full_name AS "parentName"
           FROM referrals r JOIN parents p ON p.id = r.referrer_parent_id WHERE r.enquiry_id = $1 LIMIT 1`, [id]),
  ]);
  return {
    ...lead,
    notes: base.notes,
    stageIndex: stageIndex(base.stage),
    referredBy: referral ? { parentId: referral.parentId, parentName: referral.parentName, rewardStatus: referral.rewardStatus } : null,
    history, followUps, communications, application,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
async function assertCounsellor(id: string, db?: Queryable) {
  const emp = await one<{ id: string; user_id: string | null; full_name: string }>(
    `SELECT id, user_id, full_name FROM employees WHERE id = $1 AND deleted_at IS NULL AND employment_status = 'active'`, [id], db);
  if (!emp) throw badRequest('Choose an active staff member', 'COUNSELLOR_NOT_FOUND', [{ field: 'counsellorId', message: 'Choose an active staff member' }]);
  return emp;
}

async function notifyAssignment(db: Queryable, lead: any, emp: { user_id: string | null }) {
  if (!emp.user_id) return;
  await notifyUsers([emp.user_id], {
    category: 'Attention', icon: 'userCheck', topic: 'admissions',
    title: `New lead assigned — ${lead.code}`,
    body: `${lead.student_name} (${lead.grade_applied}) · ${lead.parent_name} · ${lead.source}`,
    route: `/leads?lead=${lead.code}`, entityType: 'enquiry', entityId: lead.id,
  }, db);
}

export async function createLead(req: Request, input: any) {
  return tx(async (db) => {
    const campus = await one('SELECT id FROM campuses WHERE id = $1', [input.campusId], db);
    if (!campus) throw badRequest('Campus not found', 'CAMPUS_NOT_FOUND', [{ field: 'campusId', message: 'Choose a campus' }]);
    const dup = await one<{ code: string }>(
      `SELECT code FROM enquiries WHERE deleted_at IS NULL AND regexp_replace(phone, '\\D', '', 'g') = regexp_replace($1, '\\D', '', 'g')
          AND lower(student_name) = lower($2) AND stage NOT IN ('Enrolled', 'Lost')`, [input.phone, input.studentName], db);
    if (dup) throw conflict(`An open lead already exists for this child (${dup.code})`, 'DUPLICATE_LEAD');
    const emp = input.counsellorId ? await assertCounsellor(input.counsellorId, db) : null;
    const year = await one<{ id: string }>('SELECT id FROM academic_years WHERE is_current', [], db);
    const cost = await one<{ avg: number | null }>(
      `SELECT round(avg(acquisition_cost))::numeric AS avg FROM enquiries WHERE source = $1 AND created_at > now() - interval '180 days'`, [input.source], db);
    const code = await nextCode('enquiries', 'code', 'LD-', db);
    const lead = await one(
      `INSERT INTO enquiries (code, campus_id, academic_year_id, parent_name, phone, email, student_name, student_dob, grade_applied,
                              curriculum, source, campaign, lead_score, counsellor_id, transport_required, next_action, next_action_at,
                              referred_by_parent_id, acquisition_cost, notes, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now() + interval '1 day',$17,$18,$19,$20,$20)
       RETURNING *`,
      [code, input.campusId, year?.id ?? null, input.parentName, input.phone, input.email ?? null, input.studentName, input.studentDob ?? null,
        input.gradeApplied, input.curriculum ?? null, input.source, input.campaign ?? null, input.leadScore, emp?.id ?? null,
        input.transportRequired, 'First contact due', input.referredByParentId ?? null, cost?.avg ?? 0, input.notes ?? null, req.user!.id],
      db,
    );
    await query(`INSERT INTO enquiry_stage_history (enquiry_id, from_stage, to_stage, changed_by, note) VALUES ($1, NULL, 'New Lead', $2, 'Lead created')`, [lead.id, req.user!.id], db);
    await query(
      `INSERT INTO follow_ups (enquiry_id, follow_up_type, scheduled_at, notes, status, assigned_to, created_by)
       VALUES ($1, 'Call', now() + interval '1 day', 'First contact', 'Scheduled', $2, $3)`,
      [lead.id, emp?.id ?? null, req.user!.id], db,
    );
    await query(
      `INSERT INTO communications (channel, direction, enquiry_id, counterpart, subject, status, sent_by)
       VALUES ('Note', 'internal', $1, $2, $3, 'Internal', $4)`,
      [lead.id, input.parentName, `${input.source} enquiry recorded${input.campaign ? ` — ${input.campaign}` : ''}`, req.user!.id], db,
    );
    if (emp) await notifyAssignment(db, lead, emp);
    await audit(req, { action: 'create', module: 'admissions', description: `Created lead ${code} (${input.studentName}, ${input.gradeApplied})`, entityType: 'enquiry', entityId: lead.id }, db);
    return { id: lead.id as string, code };
  });
}

const LEAD_COLS: Record<string, string> = {
  campusId: 'campus_id', parentName: 'parent_name', phone: 'phone', email: 'email', studentName: 'student_name',
  studentDob: 'student_dob', gradeApplied: 'grade_applied', curriculum: 'curriculum', source: 'source', campaign: 'campaign',
  leadScore: 'lead_score', transportRequired: 'transport_required', notes: 'notes', nextAction: 'next_action',
  nextActionAt: 'next_action_at', acquisitionCost: 'acquisition_cost',
};

export async function updateLead(req: Request, idOrCode: string, input: Record<string, unknown>) {
  return tx(async (db) => {
    const lead = await resolveLead(idOrCode, db, true);
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(input)) {
      const col = LEAD_COLS[k];
      if (!col || v === undefined) continue;
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    }
    if (!sets.length) throw badRequest('Nothing to update');
    params.push(req.user!.id, lead.id);
    await query(`UPDATE enquiries SET ${sets.join(', ')}, updated_by = $${params.length - 1} WHERE id = $${params.length}`, params, db);
    await audit(req, { action: 'update', module: 'admissions', description: `Updated lead ${lead.code} (${Object.keys(input).join(', ')})`, entityType: 'enquiry', entityId: lead.id }, db);
  });
}

export async function deleteLead(req: Request, idOrCode: string) {
  return tx(async (db) => {
    const lead = await resolveLead(idOrCode, db, true);
    const app = await one(`SELECT 1 FROM admissions WHERE enquiry_id = $1`, [lead.id], db);
    if (app) throw conflict('Leads with an application cannot be deleted — close the lead as Lost instead', 'HAS_APPLICATION');
    await query('UPDATE enquiries SET deleted_at = now(), updated_by = $2 WHERE id = $1', [lead.id, req.user!.id], db);
    await query(`UPDATE follow_ups SET status = 'Cancelled' WHERE enquiry_id = $1 AND status = 'Scheduled'`, [lead.id], db);
    await audit(req, { action: 'delete', module: 'admissions', description: `Deleted lead ${lead.code}`, entityType: 'enquiry', entityId: lead.id }, db);
  });
}

export async function changeStage(req: Request, idOrCode: string, input: { stage: Stage; note: string; lostReason?: string }) {
  return tx(async (db) => {
    const lead = await resolveLead(idOrCode, db, true);
    const to = input.stage;
    if (lead.stage === to) throw badRequest(`The lead is already at ${to}`, 'SAME_STAGE');
    if (lead.stage === 'Enrolled') throw badRequest('Enrolled leads cannot change stage', 'LEAD_ENROLLED');
    if (to === 'Enrolled') throw badRequest('Enrol from the application — this creates the Student Master record', 'USE_ENROL');
    const app = await one(`SELECT * FROM admissions WHERE enquiry_id = $1 AND status NOT IN ('Rejected', 'Withdrawn') ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [lead.id], db);

    if (to === 'Lost') {
      if (app && app.status !== 'Enrolled') {
        await query(`UPDATE admissions SET status = 'Withdrawn', decided_by = $2, decided_at = now() WHERE id = $1`, [app.id, req.user!.id], db);
      }
      await query(`UPDATE follow_ups SET status = 'Cancelled' WHERE enquiry_id = $1 AND status = 'Scheduled'`, [lead.id], db);
    } else if (stageIndex(to) >= stageIndex('Application')) {
      let appRow = app;
      if (!appRow) {
        const created = await createApplicationRow(db, req, lead);
        appRow = await one('SELECT * FROM admissions WHERE id = $1', [created.id], db);
      }
      if (to === 'Assessment' && ['Submitted', 'Under Review'].includes(appRow.status)) {
        await query(`UPDATE admissions SET status = 'Assessment Scheduled', assessment_at = COALESCE(assessment_at, now() + interval '3 days') WHERE id = $1`, [appRow.id], db);
      }
      if (to === 'Offer' && ['Submitted', 'Under Review', 'Assessment Scheduled'].includes(appRow.status)) {
        // Same gate as the application's own Offer Made step.
        const docs = await one<{ outstanding: number }>(
          `SELECT count(*) FILTER (WHERE status <> 'Verified')::int AS outstanding
             FROM documents WHERE owner_type = 'admission' AND owner_id = $1 AND deleted_at IS NULL`, [appRow.id], db);
        if (docs && docs.outstanding > 0) {
          throw badRequest(`Verify all documents before making an offer (${docs.outstanding} outstanding)`, 'DOCUMENTS_INCOMPLETE');
        }
        await query(
          `UPDATE admissions SET status = 'Offer Made', offer_expires_on = COALESCE(offer_expires_on, current_date + 14),
                  decided_by = $2, decided_at = now() WHERE id = $1`, [appRow.id, req.user!.id], db);
      }
    }
    const from = lead.stage;
    await writeStage(db, req, lead as any, to, input.note, { lostReason: input.lostReason });
    await audit(req, { action: 'update', module: 'admissions', description: `Lead ${lead.code} moved ${from} → ${to}`, entityType: 'enquiry', entityId: lead.id, metadata: { from, to } }, db);
    return { stage: to };
  });
}

export async function assignCounsellor(req: Request, idOrCode: string, counsellorId: string | null) {
  return tx(async (db) => {
    const lead = await resolveLead(idOrCode, db, true);
    if (lead.counsellor_id === counsellorId) throw badRequest('This counsellor is already assigned', 'NO_CHANGE');
    const emp = counsellorId ? await assertCounsellor(counsellorId, db) : null;
    await query('UPDATE enquiries SET counsellor_id = $2, updated_by = $3 WHERE id = $1', [lead.id, counsellorId, req.user!.id], db);
    // Open follow-ups move with the lead.
    await query(`UPDATE follow_ups SET assigned_to = $2 WHERE enquiry_id = $1 AND status = 'Scheduled' AND follow_up_type <> 'Campus Visit'`, [lead.id, counsellorId], db);
    await query(
      `INSERT INTO communications (channel, direction, enquiry_id, counterpart, subject, status, sent_by)
       VALUES ('Note', 'internal', $1, $2, $3, 'Internal', $4)`,
      [lead.id, lead.parent_name, emp ? `Counsellor assigned — ${emp.full_name}` : 'Counsellor unassigned', req.user!.id], db,
    );
    if (emp) await notifyAssignment(db, lead, emp);
    await audit(req, { action: 'update', module: 'admissions', description: `Lead ${lead.code} ${emp ? `assigned to ${emp.full_name}` : 'unassigned'}`, entityType: 'enquiry', entityId: lead.id }, db);
    return { counsellorId, counsellor: emp?.full_name ?? null, notified: !!emp?.user_id };
  });
}

/** Assigns every open, unassigned lead to the counsellor with the fewest open leads. */
export async function autoAssign(req: Request, campusId?: string) {
  const pool = await counsellors();
  const eligible = pool.filter((c) => /admission/i.test(c.designation));
  if (!eligible.length) throw badRequest('No admissions counsellors are set up', 'NO_COUNSELLORS');
  const w = new Where().add('deleted_at IS NULL').add('counsellor_id IS NULL').add(`stage NOT IN ('Enrolled', 'Lost')`);
  w.addIf(campusId, 'campus_id = ?');
  const leads = await many<{ code: string }>(`SELECT code FROM enquiries ${w.sql} ORDER BY created_at`, w.params);
  const load = new Map(eligible.map((c) => [c.id as string, c.openLeads as number]));
  const out: { code: string; counsellor: string }[] = [];
  for (const l of leads) {
    const [id] = [...load.entries()].sort((a, b) => a[1] - b[1])[0];
    const r = await assignCounsellor(req, l.code, id);
    load.set(id, (load.get(id) ?? 0) + 1);
    out.push({ code: l.code, counsellor: r.counsellor! });
  }
  return { assigned: out.length, leads: out };
}

// ---------------------------------------------------------------------------
// Follow-ups & communications
// ---------------------------------------------------------------------------
/** Keeps enquiries.next_action(_at) pointing at the earliest open follow-up. */
export async function refreshNextAction(db: Queryable, enquiryId: string) {
  const next = await one<{ follow_up_type: string; scheduled_at: Date; notes: string | null }>(
    `SELECT follow_up_type, scheduled_at, notes FROM follow_ups WHERE enquiry_id = $1 AND status = 'Scheduled' ORDER BY scheduled_at LIMIT 1`,
    [enquiryId], db);
  if (!next) {
    await query(`UPDATE enquiries SET next_action_at = NULL WHERE id = $1 AND stage NOT IN ('Enrolled', 'Lost')`, [enquiryId], db);
    return;
  }
  const text = next.follow_up_type === 'Campus Visit'
    ? `Campus visit ${fmtWhen(next.scheduled_at)}`
    : `${next.notes ?? next.follow_up_type} (${next.follow_up_type.toLowerCase()})`;
  await query(`UPDATE enquiries SET next_action = $2, next_action_at = $3 WHERE id = $1 AND stage NOT IN ('Enrolled', 'Lost')`,
    [enquiryId, text.slice(0, 160), next.scheduled_at], db);
}

export async function addFollowUp(req: Request, idOrCode: string, input: { type: string; scheduledAt: string; notes: string; assignedTo?: string | null }) {
  return tx(async (db) => {
    const lead = await resolveLead(idOrCode, db, true);
    if (['Enrolled', 'Lost'].includes(lead.stage)) throw badRequest('This lead is closed', 'LEAD_CLOSED');
    if (new Date(input.scheduledAt).getTime() < Date.now() - 5 * 60_000) {
      throw badRequest('Schedule the follow-up in the future', 'PAST_DATE', [{ field: 'scheduledAt', message: 'Choose a future date and time' }]);
    }
    const assigned = input.assignedTo === undefined ? lead.counsellor_id : input.assignedTo;
    if (assigned) await assertCounsellor(assigned, db);
    const f = await one<{ id: string }>(
      `INSERT INTO follow_ups (enquiry_id, follow_up_type, scheduled_at, notes, status, assigned_to, created_by)
       VALUES ($1,$2,$3,$4,'Scheduled',$5,$6) RETURNING id`,
      [lead.id, input.type, input.scheduledAt, input.notes, assigned ?? null, req.user!.id], db);
    if (input.type === 'Campus Visit') await advanceTo(db, req, lead as any, 'Visit Scheduled', `Campus visit booked for ${fmtWhen(input.scheduledAt)}`);
    await refreshNextAction(db, lead.id);
    await audit(req, { action: 'create', module: 'admissions', description: `${input.type} scheduled for lead ${lead.code}`, entityType: 'follow_up', entityId: f!.id }, db);
    return { id: f!.id };
  });
}

const CHANNEL_FOR: Record<string, string> = { Call: 'Call', WhatsApp: 'WhatsApp', Email: 'Email', SMS: 'SMS', 'Campus Visit': 'Note', Meeting: 'Note', Note: 'Note' };

export async function updateFollowUp(req: Request, id: string, input: { status?: string; outcome?: string; notes?: string; scheduledAt?: string; assignedTo?: string | null }) {
  return tx(async (db) => {
    const f = await one(`SELECT f.*, e.code, e.stage, e.parent_name FROM follow_ups f JOIN enquiries e ON e.id = f.enquiry_id WHERE f.id = $1 AND e.deleted_at IS NULL FOR UPDATE OF f`, [id], db);
    if (!f) throw notFound('Follow-up not found', 'FOLLOW_UP_NOT_FOUND');
    // A closed follow-up cannot be closed again (a repeat "Completed" would log the outcome twice).
    if (f.status !== 'Scheduled' && input.status) {
      throw badRequest(`This follow-up is already ${f.status.toLowerCase()}`, 'FOLLOW_UP_CLOSED');
    }
    if (input.assignedTo) await assertCounsellor(input.assignedTo, db);
    if (input.status === 'Completed' && !input.outcome) {
      throw badRequest('Record the outcome', 'OUTCOME_REQUIRED', [{ field: 'outcome', message: 'Record what happened' }]);
    }
    await query(
      `UPDATE follow_ups SET status = COALESCE($2, status), outcome = COALESCE($3, outcome), notes = COALESCE($4, notes),
              scheduled_at = COALESCE($5, scheduled_at),
              assigned_to = CASE WHEN $7 THEN $6::uuid ELSE assigned_to END,
              completed_at = CASE WHEN $2 = 'Completed' THEN now() ELSE completed_at END
        WHERE id = $1`,
      [id, input.status ?? null, input.outcome ?? null, input.notes ?? null, input.scheduledAt ?? null, input.assignedTo ?? null, input.assignedTo !== undefined],
      db,
    );
    const lead = { id: f.enquiry_id, stage: f.stage };
    if (input.status === 'Completed') {
      if (f.follow_up_type === 'Campus Visit') {
        await advanceTo(db, req, lead, 'Visit Completed', input.outcome ?? 'Campus visit completed');
      } else if (lead.stage === 'New Lead') {
        await advanceTo(db, req, lead, 'Contacted', input.outcome ?? 'First contact made');
      }
      await query(
        `INSERT INTO communications (channel, direction, enquiry_id, counterpart, subject, body, status, sent_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [CHANNEL_FOR[f.follow_up_type], CHANNEL_FOR[f.follow_up_type] === 'Note' ? 'internal' : 'outbound', f.enquiry_id, f.parent_name,
          `${f.follow_up_type} — ${input.outcome}`, input.notes ?? f.notes, CHANNEL_FOR[f.follow_up_type] === 'Note' ? 'Internal' : 'Completed', req.user!.id],
        db,
      );
    }
    await refreshNextAction(db, f.enquiry_id);
    await audit(req, {
      action: 'update', module: 'admissions',
      description: `${f.follow_up_type} for lead ${f.code} ${input.status ? `marked ${input.status}` : 'updated'}`,
      entityType: 'follow_up', entityId: id,
    }, db);
  });
}

export async function listFollowUps(f: Pagination & { campusId?: string; type?: string; status?: string; due?: string; assignedTo?: string }) {
  const w = new Where().add('e.deleted_at IS NULL');
  w.addIf(f.campusId, 'e.campus_id = ?');
  w.addIf(f.type, 'f.follow_up_type = ?');
  w.addIf(f.status, 'f.status = ?');
  w.addIf(f.assignedTo, 'f.assigned_to = ?');
  if (f.due === 'overdue') w.add(`f.status = 'Scheduled' AND f.scheduled_at < now()`);
  if (f.due === 'today') w.add(`f.status = 'Scheduled' AND (f.scheduled_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date`);
  if (f.due === 'upcoming') w.add(`f.status = 'Scheduled' AND f.scheduled_at >= now()`);
  if (f.q) w.add('(e.student_name ILIKE ? OR e.parent_name ILIKE ? OR e.code ILIKE ?)', likeTerm(f.q), likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT f.id, f.follow_up_type AS type, f.scheduled_at AS "scheduledAt", f.completed_at AS "completedAt", f.status, f.outcome, f.notes,
            (f.status = 'Scheduled' AND f.scheduled_at < now()) AS overdue,
            emp.id AS "assignedTo", emp.full_name AS "assignedName",
            e.id AS "enquiryId", e.code, e.student_name AS "studentName", e.parent_name AS "parentName", e.grade_applied AS grade,
            e.stage, cp.short_name AS "campusName", count(*) OVER() AS total
       FROM follow_ups f
       JOIN enquiries e ON e.id = f.enquiry_id
       JOIN campuses cp ON cp.id = e.campus_id
       LEFT JOIN employees emp ON emp.id = f.assigned_to
      ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, { scheduledAt: 'f.scheduled_at', type: 'f.follow_up_type', status: 'f.status', student: 'e.student_name' }, 'scheduledAt')}
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export async function addCommunication(req: Request, idOrCode: string, input: { channel: string; subject: string; body?: string; direction?: string; status?: string }) {
  const lead = await resolveLead(idOrCode);
  const direction = input.direction ?? (input.channel === 'Note' ? 'internal' : 'outbound');
  const status = input.status ?? (input.channel === 'Note' ? 'Internal' : input.channel === 'Call' ? 'Completed' : 'Logged');
  const r = await one<{ id: string }>(
    `INSERT INTO communications (channel, direction, enquiry_id, counterpart, subject, body, status, sent_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [input.channel, direction, lead.id, input.channel === 'Note' ? req.user!.fullName : lead.parent_name, input.subject, input.body ?? null, status, req.user!.id],
  );
  if (lead.stage === 'New Lead' && input.channel !== 'Note' && direction === 'outbound') {
    await tx(async (db) => {
      const locked = await resolveLead(lead.id, db, true);
      await advanceTo(db, req, locked as any, 'Contacted', `${input.channel} — ${input.subject}`);
    });
  }
  await audit(req, { action: 'create', module: 'admissions', description: `${input.channel} logged against lead ${lead.code}`, entityType: 'enquiry', entityId: lead.id });
  return { id: r!.id };
}
