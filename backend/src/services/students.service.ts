import type { Request } from 'express';
import { many, one, query, tx } from '../config/db.js';
import { Where } from '../utils/sql.js';
import { likeTerm, limitOffset, orderBy, type Pagination } from '../utils/pagination.js';
import { badRequest, notFound } from '../utils/errors.js';
import { nextCode } from '../utils/codes.js';
import { audit } from './audit.service.js';
import { isGuardianOf, studentScope } from './access.service.js';
import { safeFilename, verifyUploadedFile } from './documents.service.js';
import type { AuthUser } from '../types.js';

/**
 * Row shape shared by every student list in the product (Students, Early
 * Warning, attendance rosters …). Derived figures are computed from
 * transactional tables, never stored:
 *   attendance — % of marked days present or late in the current year
 *   average    — mean subject score in the latest term
 *   trend      — latest term mean minus previous term mean
 *   feeStatus  — Overdue > Partial > Pending > Paid across the student's charges
 *   today      — today's attendance mark (or 'unmarked')
 */
export const STUDENT_ROW_SQL = `
  SELECT s.id, s.admission_no AS "admissionNo", s.full_name AS "fullName",
         s.first_name AS "firstName", s.last_name AS "lastName",
         s.gender, s.house, s.photo_url AS "photoUrl", s.status,
         s.risk_level AS risk, s.date_of_birth AS "dateOfBirth",
         c.id AS "classId", c.name AS grade, c.grade_level AS "gradeLevel",
         sec.id AS "sectionId", sec.name AS section,
         cp.id AS "campusId", cp.code AS "campusCode", cp.short_name AS "campusName",
         att.pct::int AS attendance,
         perf.avg::int AS average,
         COALESCE(perf.trend, 0)::int AS trend,
         ews.code AS "signalCode", ews.stage AS "interventionStage", ews_owner.full_name AS owner,
         g.full_name AS "parentName", g.phone AS "parentPhone",
         tr.name AS "busRoute",
         CASE WHEN fee.overdue > 0 THEN 'Overdue' WHEN fee.partial > 0 THEN 'Partial'
              WHEN fee.pending > 0 THEN 'Pending' ELSE 'Paid' END AS "feeStatus",
         COALESCE(td.status, 'unmarked') AS today,
         tp.tracking_status AS "trackingStatus"
    FROM students s
    JOIN campuses cp ON cp.id = s.campus_id
    LEFT JOIN sections sec ON sec.id = s.section_id
    LEFT JOIN classes c ON c.id = sec.class_id
    LEFT JOIN LATERAL (
      SELECT round(100.0 * count(*) FILTER (WHERE a.status IN ('present', 'late')) / NULLIF(count(*), 0)) AS pct
        FROM attendance_records a
        JOIN academic_years ay ON ay.is_current AND a.attendance_date BETWEEN ay.starts_on AND ay.ends_on
       WHERE a.student_id = s.id) att ON true
    LEFT JOIN LATERAL (
      SELECT round(avg(x.score) FILTER (WHERE x.term_order = x.mx)) AS avg,
             round(avg(x.score) FILTER (WHERE x.term_order = x.mx) - avg(x.score) FILTER (WHERE x.term_order = x.mx - 1)) AS trend
        FROM (SELECT r.score, r.term_order, max(r.term_order) OVER () AS mx
                FROM student_academic_records r
                JOIN academic_years ay ON ay.id = r.academic_year_id AND ay.is_current
               WHERE r.student_id = s.id) x) perf ON true
    LEFT JOIN LATERAL (
      SELECT e.code, e.stage, e.owner_id FROM early_warning_signals e
       WHERE e.student_id = s.id AND e.closed_at IS NULL AND COALESCE(e.review_decision, '') <> 'dismissed'
       ORDER BY e.raised_on DESC LIMIT 1) ews ON true
    LEFT JOIN employees ews_owner ON ews_owner.id = ews.owner_id
    LEFT JOIN LATERAL (
      SELECT p.full_name, p.phone FROM student_guardians sg JOIN parents p ON p.id = sg.parent_id
       WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC LIMIT 1) g ON true
    LEFT JOIN student_transport st ON st.student_id = s.id
    LEFT JOIN transport_routes tr ON tr.id = st.route_id
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE f.status = 'Overdue' OR (f.status IN ('Pending', 'Partial') AND f.due_date < current_date)) AS overdue,
             count(*) FILTER (WHERE f.status = 'Partial') AS partial,
             count(*) FILTER (WHERE f.status = 'Pending') AS pending
        FROM student_fees f WHERE f.student_id = s.id) fee ON true
    LEFT JOIN attendance_records td ON td.student_id = s.id AND td.attendance_date = current_date
    LEFT JOIN student_tracking_profiles tp ON tp.student_id = s.id`;

// Listed first in the default students list (GPS tracking demo student, Aditya Raman);
// a sort the user picks is honoured as asked.
const PINNED_ADMISSION_NO = 'HS-2026-1077';

const SORTS: Record<string, string> = {
  name: 'q."fullName"',
  admissionNo: 'q."admissionNo"',
  grade: 'q."gradeLevel", q.section',
  attendance: 'q.attendance',
  average: 'q.average',
  trend: 'q.trend',
  risk: `array_position(ARRAY['At Risk','Developing Risk','Watch','On Track'], q.risk)`,
  feeStatus: 'q."feeStatus"',
};

export interface StudentFilters extends Pagination {
  campusId?: string; classId?: string; sectionId?: string; grade?: string; risk?: string;
  status?: string; feeStatus?: string; today?: string; house?: string;
}

export async function listStudents(user: AuthUser, f: StudentFilters) {
  const w = new Where();
  w.add('s.deleted_at IS NULL');
  studentScope(user, w);
  w.addIf(f.campusId, 's.campus_id = ?');
  w.addIf(f.sectionId, 's.section_id = ?');
  w.addIf(f.classId, 'sec.class_id = ?');
  w.addIf(f.grade, 'c.name = ?');
  w.addIf(f.risk, 's.risk_level = ?');
  w.add('s.status = ?', f.status ?? 'active');
  w.addIf(f.house, 's.house = ?');
  if (f.q) w.add('(s.full_name ILIKE ? OR s.admission_no ILIKE ?)', likeTerm(f.q), likeTerm(f.q));

  // Outer filters work on computed columns; params continue numbering after the inner clause.
  const outerParams: unknown[] = [];
  const outerParts: string[] = [];
  if (f.feeStatus) { outerParams.push(f.feeStatus); outerParts.push(`q."feeStatus" = $${w.params.length + outerParams.length}`); }
  if (f.today) { outerParams.push(f.today); outerParts.push(`q.today = $${w.params.length + outerParams.length}`); }

  const { limit, offset } = limitOffset(f);
  const params = [...w.params, ...outerParams, limit, offset];
  const n = params.length;
  const rows = await many(
    `SELECT q.*, count(*) OVER() AS total
       FROM (${STUDENT_ROW_SQL} ${w.sql}) q
      ${outerParts.length ? 'WHERE ' + outerParts.join(' AND ') : ''}
      ORDER BY ${f.sort ? '' : `(q."admissionNo" = '${PINNED_ADMISSION_NO}') DESC, `}${orderBy(f.sort, f.dir, SORTS, 'name')}, q."fullName"
      LIMIT $${n - 1} OFFSET $${n}`,
    params,
  );
  const total = rows[0]?.total ?? 0;
  return { rows: rows.map(({ total: _t, ...r }) => r), total };
}

/** Summary counts that sit above the student table. */
export async function studentSummary(user: AuthUser, campusId?: string) {
  const w = new Where();
  w.add("s.deleted_at IS NULL AND s.status = 'active'");
  studentScope(user, w);
  w.addIf(campusId, 's.campus_id = ?');
  return one(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE s.risk_level = 'At Risk')::int AS "atRisk",
            count(*) FILTER (WHERE s.risk_level = 'Developing Risk')::int AS developing,
            count(*) FILTER (WHERE s.risk_level IN ('On Track', 'Watch'))::int AS "onTrack",
            count(*) FILTER (WHERE s.gender = 'F')::int AS girls,
            count(*) FILTER (WHERE s.gender = 'M')::int AS boys
       FROM students s LEFT JOIN sections sec ON sec.id = s.section_id ${w.sql}`,
    w.params,
  );
}

export async function getStudentRow(id: string) {
  return one(`${STUDENT_ROW_SQL} WHERE s.id = $1 AND s.deleted_at IS NULL`, [id]);
}

async function currentYearId(db?: any) {
  const y = await one<{ id: string }>('SELECT id FROM academic_years WHERE is_current', [], db);
  if (!y) throw badRequest('No current academic year is configured', 'NO_CURRENT_YEAR');
  return y.id;
}

export async function createStudent(req: Request, input: any) {
  const user = req.user!;
  return tx(async (db) => {
    const section = await one<{ id: string; campus_id: string; academic_year_id: string }>(
      `SELECT sec.id, c.campus_id, sec.academic_year_id FROM sections sec JOIN classes c ON c.id = sec.class_id WHERE sec.id = $1`,
      [input.sectionId], db,
    );
    if (!section) throw badRequest('Section not found', 'SECTION_NOT_FOUND');
    if (section.campus_id !== input.campusId) throw badRequest('Section does not belong to the selected campus', 'SECTION_CAMPUS_MISMATCH');

    const year = new Date().getFullYear();
    const admissionNo = input.admissionNo ?? (await nextCode('students', 'admission_no', `HS-${year}-`, db));
    const s = await one<{ id: string }>(
      `INSERT INTO students (admission_no, first_name, last_name, date_of_birth, gender, blood_group, campus_id, section_id,
                             academic_year_id, house, address, city, pincode, email, phone, admitted_on, medical_notes, photo_url,
                             created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,COALESCE($16::date, current_date),$17,$18,$19,$19)
       RETURNING id`,
      [admissionNo, input.firstName, input.lastName, input.dateOfBirth, input.gender, input.bloodGroup ?? null, input.campusId,
        input.sectionId, section.academic_year_id, input.house ?? null, input.address ?? null, input.city ?? null, input.pincode ?? null,
        input.email ?? null, input.phone ?? null, input.admittedOn ?? null, input.medicalNotes ?? null, input.photoUrl ?? null, user.id],
      db,
    );
    const roll = await one<{ n: number }>('SELECT count(*)::int + 1 AS n FROM enrollments WHERE section_id = $1', [input.sectionId], db);
    await query(
      `INSERT INTO enrollments (student_id, section_id, academic_year_id, roll_no) VALUES ($1, $2, $3, $4)`,
      [s!.id, input.sectionId, section.academic_year_id, roll!.n], db,
    );

    for (const g of input.guardians ?? []) {
      let parentId = g.parentId;
      if (!parentId) {
        const code = await nextCode('parents', 'parent_code', 'PAR-', db);
        const p = await one<{ id: string }>(
          `INSERT INTO parents (parent_code, full_name, phone, email, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [code, g.fullName, g.phone, g.email ?? null, user.id], db,
        );
        parentId = p!.id;
      }
      await query(
        `INSERT INTO student_guardians (student_id, parent_id, relationship, is_primary) VALUES ($1,$2,$3,$4)`,
        [s!.id, parentId, g.relationship, g.isPrimary], db,
      );
    }
    if (input.transport) {
      await query('INSERT INTO student_transport (student_id, route_id, stop_id) VALUES ($1,$2,$3)', [s!.id, input.transport.routeId, input.transport.stopId ?? null], db);
    }
    await query(
      `INSERT INTO student_tracking_profiles (student_id, tracking_enabled, tracking_status)
       VALUES ($1, $2, $3)`,
      [s!.id, input.enableTracking, input.enableTracking ? 'active' : 'disabled'], db,
    );
    await query(
      `INSERT INTO student_timeline_events (student_id, occurred_on, title, body, category, tone, created_by)
       VALUES ($1, COALESCE($2::date, current_date), 'Admitted', 'Student record created', 'admission', 'teal', $3)`,
      [s!.id, input.admittedOn ?? null, user.id], db,
    );
    await audit(req, { action: 'create', module: 'students', description: `Created student ${input.firstName} ${input.lastName} (${admissionNo})`, entityType: 'student', entityId: s!.id }, db);
    return s!.id;
  });
}

const UPDATABLE: Record<string, string> = {
  firstName: 'first_name', lastName: 'last_name', dateOfBirth: 'date_of_birth', gender: 'gender', bloodGroup: 'blood_group',
  campusId: 'campus_id', sectionId: 'section_id', house: 'house', address: 'address', city: 'city', pincode: 'pincode',
  email: 'email', phone: 'phone', admittedOn: 'admitted_on', medicalNotes: 'medical_notes', photoUrl: 'photo_url',
  status: 'status', riskLevel: 'risk_level', counsellorId: 'counsellor_id',
};

export async function updateStudent(req: Request, id: string, input: Record<string, unknown>) {
  return tx(async (db) => {
    const before = await one('SELECT * FROM students WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id], db);
    if (!before) throw notFound('Student not found', 'STUDENT_NOT_FOUND');
    // As on create: the section must belong to the student's (new) campus.
    const sectionId = input.sectionId ?? before.section_id;
    if ((input.sectionId !== undefined || input.campusId !== undefined) && sectionId) {
      const section = await one<{ campus_id: string }>(
        'SELECT c.campus_id FROM sections sec JOIN classes c ON c.id = sec.class_id WHERE sec.id = $1',
        [sectionId], db,
      );
      if (!section) throw badRequest('Section not found', 'SECTION_NOT_FOUND');
      if (section.campus_id !== (input.campusId ?? before.campus_id)) {
        throw badRequest('Section does not belong to the selected campus', 'SECTION_CAMPUS_MISMATCH');
      }
    }
    const sets: string[] = [];
    const params: unknown[] = [];
    const changed: string[] = [];
    for (const [k, v] of Object.entries(input)) {
      const col = UPDATABLE[k];
      if (!col || v === undefined) continue;
      params.push(v);
      sets.push(`${col} = $${params.length}`);
      if (String(before[col] ?? '') !== String(v ?? '')) changed.push(k);
    }
    if (!sets.length && input.transport === undefined) throw badRequest('Nothing to update');
    if (sets.length) {
      params.push(req.user!.id, id);
      await query(`UPDATE students SET ${sets.join(', ')}, updated_by = $${params.length - 1} WHERE id = $${params.length}`, params, db);
    }

    // Transport: a route and pickup stop on the student's campus, or null for own transport.
    if (input.transport !== undefined) {
      const t = input.transport as { routeId: string; stopId?: string } | null;
      const cur = await one<{ route_id: string; stop_id: string | null }>('SELECT route_id, stop_id FROM student_transport WHERE student_id = $1', [id], db);
      if (t === null) {
        if (cur) {
          await query('DELETE FROM student_transport WHERE student_id = $1', [id], db);
          changed.push('transport');
        }
      } else {
        const route = await one<{ campus_id: string }>('SELECT campus_id FROM transport_routes WHERE id = $1', [t.routeId], db);
        if (!route) throw badRequest('Bus route not found', 'ROUTE_NOT_FOUND');
        if (route.campus_id !== (input.campusId ?? before.campus_id)) throw badRequest('That bus route belongs to another campus', 'ROUTE_CAMPUS_MISMATCH');
        if (t.stopId && !(await one('SELECT 1 FROM route_stops WHERE id = $1 AND route_id = $2', [t.stopId, t.routeId], db))) {
          throw badRequest('That pickup stop is not on the chosen route', 'STOP_NOT_ON_ROUTE');
        }
        if (!cur || cur.route_id !== t.routeId || cur.stop_id !== (t.stopId ?? null)) {
          await query(
            `INSERT INTO student_transport (student_id, route_id, stop_id) VALUES ($1, $2, $3)
             ON CONFLICT (student_id) DO UPDATE SET route_id = EXCLUDED.route_id, stop_id = EXCLUDED.stop_id`,
            [id, t.routeId, t.stopId ?? null], db);
          changed.push('transport');
        }
      }
    }

    if (input.sectionId && input.sectionId !== before.section_id) {
      const yearId = await currentYearId(db);
      await query(
        `INSERT INTO enrollments (student_id, section_id, academic_year_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (student_id, academic_year_id) DO UPDATE SET section_id = EXCLUDED.section_id`,
        [id, input.sectionId, yearId], db,
      );
    }
    await audit(req, {
      action: 'update', module: 'students',
      description: `Updated student profile ${before.admission_no}${changed.length ? ` (${changed.join(', ')})` : ''}`,
      entityType: 'student', entityId: id, metadata: { changed },
    }, db);
  });
}

export async function archiveStudent(req: Request, id: string) {
  const r = await one<{ admission_no: string }>(
    `UPDATE students SET deleted_at = now(), status = 'withdrawn', updated_by = $2
      WHERE id = $1 AND deleted_at IS NULL RETURNING admission_no`,
    [id, req.user!.id],
  );
  if (!r) throw notFound('Student not found', 'STUDENT_NOT_FOUND');
  await query(`UPDATE student_tracking_profiles SET tracking_enabled = false, tracking_status = 'disabled' WHERE student_id = $1`, [id]);
  // The student's tracker goes back to the pool instead of staying "assigned" to an archived record.
  await query(
    `WITH ended AS (
       UPDATE device_assignments SET status = 'inactive', unassigned_at = now(), unassigned_by = $2, unassign_reason = 'Student archived'
        WHERE student_id = $1 AND status = 'active' RETURNING device_id)
     UPDATE gps_devices SET status = 'available' WHERE id IN (SELECT device_id FROM ended) AND status = 'assigned'`,
    [id, req.user!.id],
  );
  await audit(req, { action: 'delete', module: 'students', description: `Archived student ${r.admission_no}`, entityType: 'student', entityId: id });
}

// ---------------------------------------------------------------------------
// Student 360
// ---------------------------------------------------------------------------

/**
 * The complete development record for one student. Sections the viewer may
 * not see (wellbeing notes, fees, tracking) are omitted rather than blanked.
 */
export async function getStudentProfile(user: AuthUser, id: string) {
  const perms = user.permissions;
  const base = await one(
    `SELECT s.*, cp.name AS campus_name, cp.short_name AS campus_short, cp.code AS campus_code,
            c.name AS grade, c.grade_level, c.stage, sec.name AS section, sec.room,
            ct.full_name AS class_teacher, co.full_name AS counsellor, ay.label AS academic_year,
            e.roll_no
       FROM students s
       JOIN campuses cp ON cp.id = s.campus_id
       LEFT JOIN sections sec ON sec.id = s.section_id
       LEFT JOIN classes c ON c.id = sec.class_id
       LEFT JOIN employees ct ON ct.id = sec.class_teacher_id
       LEFT JOIN employees co ON co.id = s.counsellor_id
       LEFT JOIN academic_years ay ON ay.id = s.academic_year_id
       LEFT JOIN enrollments e ON e.student_id = s.id AND e.academic_year_id = s.academic_year_id
      WHERE s.id = $1 AND s.deleted_at IS NULL`,
    [id],
  );
  if (!base) throw notFound('Student not found', 'STUDENT_NOT_FOUND');
  const row = await getStudentRow(id);

  const [
    guardians, attendanceMonths, attendanceTotals, recentAttendance, subjects, termTrend, assessments,
    skills, interests, activities, achievements, behaviour, observations, interventions, documents,
    projects, transport, timeline,
  ] = await Promise.all([
    many(`SELECT p.id, p.parent_code AS "parentCode", p.full_name AS "fullName", sg.relationship, sg.is_primary AS "isPrimary",
                 sg.can_pickup AS "canPickup", ${perms.has('parents.read') || user.parentId ? 'p.phone, p.email, p.occupation' : 'NULL AS phone, NULL AS email, NULL AS occupation'}
            FROM student_guardians sg JOIN parents p ON p.id = sg.parent_id
           WHERE sg.student_id = $1 ORDER BY sg.is_primary DESC, p.full_name`, [id]),
    many(`SELECT to_char(date_trunc('month', a.attendance_date), 'Mon') AS label,
                 round(100.0 * count(*) FILTER (WHERE a.status IN ('present', 'late')) / NULLIF(count(*), 0))::int AS value
            FROM attendance_records a JOIN academic_years ay ON ay.is_current AND a.attendance_date BETWEEN ay.starts_on AND ay.ends_on
           WHERE a.student_id = $1
           GROUP BY date_trunc('month', a.attendance_date) ORDER BY date_trunc('month', a.attendance_date)`, [id]),
    one(`SELECT count(*)::int AS marked,
                count(*) FILTER (WHERE status = 'present')::int AS present,
                count(*) FILTER (WHERE status = 'late')::int AS late,
                count(*) FILTER (WHERE status = 'absent')::int AS absent,
                count(*) FILTER (WHERE status = 'leave')::int AS leave
           FROM attendance_records a JOIN academic_years ay ON ay.is_current AND a.attendance_date BETWEEN ay.starts_on AND ay.ends_on
          WHERE a.student_id = $1`, [id]),
    many(`SELECT attendance_date AS date, status, arrival_time AS "arrivalTime", remarks
            FROM attendance_records WHERE student_id = $1 ORDER BY attendance_date DESC LIMIT 20`, [id]),
    many(`WITH r AS (
            SELECT r.*, sub.name AS subject, max(r.term_order) OVER () AS mx
              FROM student_academic_records r JOIN subjects sub ON sub.id = r.subject_id
              JOIN academic_years ay ON ay.id = r.academic_year_id AND ay.is_current
             WHERE r.student_id = $1)
          SELECT cur.subject AS name, cur.score::int AS score, cur.grade, cur.target_score::int AS target,
                 (cur.score - prev.score)::int AS trend, t.full_name AS teacher
            FROM r cur
            LEFT JOIN r prev ON prev.subject_id = cur.subject_id AND prev.term_order = cur.mx - 1
            LEFT JOIN employees t ON t.id = cur.teacher_id
           WHERE cur.term_order = cur.mx
           ORDER BY cur.subject`, [id]),
    many(`SELECT r.term AS label, round(avg(r.score))::int AS value
            FROM student_academic_records r JOIN academic_years ay ON ay.id = r.academic_year_id AND ay.is_current
           WHERE r.student_id = $1 GROUP BY r.term, r.term_order ORDER BY r.term_order`, [id]),
    many(`SELECT a.code, a.name, sub.name AS subject, a.held_on AS "heldOn", a.max_marks AS "maxMarks",
                 m.marks, m.grade, m.is_absent AS "isAbsent",
                 round(100.0 * m.marks / a.max_marks)::int AS pct
            FROM assessment_marks m JOIN assessments a ON a.id = m.assessment_id JOIN subjects sub ON sub.id = a.subject_id
           WHERE m.student_id = $1 ORDER BY a.held_on DESC LIMIT 12`, [id]),
    many(`SELECT skill AS name, score AS value, confidence, evidence, assessed_on AS "assessedOn"
            FROM student_skills WHERE student_id = $1 ORDER BY score DESC`, [id]),
    many(`SELECT interest FROM student_interests WHERE student_id = $1 ORDER BY interest`, [id]),
    many(`SELECT act.name, act.category, sa.role, sa.since, sa.hours, sa.status
            FROM student_activities sa JOIN activities act ON act.id = sa.activity_id
           WHERE sa.student_id = $1 ORDER BY sa.since DESC`, [id]),
    many(`SELECT a.id, a.title, a.achievement_type AS type, a.level, a.achieved_on AS date, a.is_verified AS verified,
                 d.id AS "documentId", d.original_name AS "fileName", d.mime_type AS "fileType"
            FROM achievements a LEFT JOIN documents d ON d.id = a.document_id AND d.deleted_at IS NULL
           WHERE a.student_id = $1 ORDER BY a.achieved_on DESC`, [id]),
    many(`SELECT b.id, b.recorded_on AS date, b.record_type AS type, b.note, e.full_name AS "by"
            FROM behaviour_records b LEFT JOIN employees e ON e.id = b.recorded_by
           WHERE b.student_id = $1 ORDER BY b.recorded_on DESC LIMIT 20`, [id]),
    many(`SELECT o.id, o.observed_on AS date, o.observation AS text, e.full_name AS "by", e.designation AS role
            FROM teacher_observations o JOIN employees e ON e.id = o.employee_id
           WHERE o.student_id = $1 ORDER BY o.observed_on DESC`, [id]),
    many(`SELECT w.id, w.code, w.signal, w.signal_type AS "signalType", w.stage, w.raised_on AS opened,
                 w.action_plan AS action, w.next_review_on AS next, w.review_decision AS decision,
                 w.closed_at AS "closedAt", e.full_name AS owner
            FROM early_warning_signals w LEFT JOIN employees e ON e.id = w.owner_id
           WHERE w.student_id = $1 ORDER BY w.raised_on DESC`, [id]),
    many(`SELECT id, name, category, status, requested_on AS "requestedOn", verified_at AS "verifiedAt",
                 created_at AS "createdAt", (storage_key IS NOT NULL) AS "hasFile", mime_type AS "mimeType"
            FROM documents WHERE student_id = $1 AND deleted_at IS NULL ORDER BY created_at`, [id]),
    many(`SELECT p.id, p.code, p.title, p.stage, p.status, m.full_name AS mentor,
                 (SELECT count(*) FROM innovation_milestones x WHERE x.project_id = p.id)::int AS milestones,
                 (SELECT count(*) FROM innovation_milestones x WHERE x.project_id = p.id AND x.completed_on IS NOT NULL)::int AS done
            FROM innovation_projects p LEFT JOIN employees m ON m.id = p.mentor_id
           WHERE p.lead_student_id = $1
              OR p.id IN (SELECT project_id FROM innovation_project_members WHERE student_id = $1)
           ORDER BY p.updated_at DESC`, [id]),
    one(`SELECT tr.id AS "routeId", tr.code AS "routeCode", tr.name AS "routeName", tr.area, tr.run_status AS "runStatus",
                tr.delay_minutes AS "delayMinutes", tr.eta_text AS eta, v.bus_no AS "busNo", v.registration_no AS "registrationNo",
                d.full_name AS driver, a.full_name AS attendant,
                rs.name AS "stopName", rs.pickup_time AS "pickupTime", rs.drop_time AS "dropTime",
                rs.latitude AS "stopLatitude", rs.longitude AS "stopLongitude", st.mode, st.stop_id AS "stopId"
           FROM student_transport st
           JOIN transport_routes tr ON tr.id = st.route_id
           LEFT JOIN vehicles v ON v.id = tr.vehicle_id
           LEFT JOIN employees d ON d.id = tr.driver_id
           LEFT JOIN employees a ON a.id = tr.attendant_id
           LEFT JOIN route_stops rs ON rs.id = st.stop_id
          WHERE st.student_id = $1`, [id]),
    many(`SELECT * FROM (
            SELECT occurred_on AS date, title, body, category, tone FROM student_timeline_events WHERE student_id = $1
            UNION ALL
            SELECT achieved_on, title, COALESCE(level || ' level · ', '') || achievement_type, 'achievement', 'teal'
              FROM achievements WHERE student_id = $1 AND is_verified
            UNION ALL
            SELECT raised_on, 'Support plan opened', signal, 'support', 'critical'
              FROM early_warning_signals WHERE student_id = $1 AND review_decision = 'accepted'
            UNION ALL
            SELECT sa.since, 'Joined ' || act.name, sa.role, 'activity', 'amber'
              FROM student_activities sa JOIN activities act ON act.id = sa.activity_id WHERE sa.student_id = $1
          ) t ORDER BY date DESC LIMIT 40`, [id]),
  ]);

  const profile: Record<string, unknown> = {
    student: {
      id: base.id,
      admissionNo: base.admission_no,
      fullName: base.full_name,
      firstName: base.first_name,
      lastName: base.last_name,
      photoUrl: base.photo_url,
      dateOfBirth: base.date_of_birth,
      gender: base.gender,
      bloodGroup: base.blood_group,
      campusId: base.campus_id,
      campusName: base.campus_name,
      campusShort: base.campus_short,
      campusCode: base.campus_code,
      sectionId: base.section_id,
      grade: base.grade,
      gradeLevel: base.grade_level,
      stage: base.stage,
      section: base.section,
      room: base.room,
      rollNo: base.roll_no,
      academicYear: base.academic_year,
      house: base.house,
      address: base.address,
      city: base.city,
      pincode: base.pincode,
      email: base.email,
      phone: base.phone,
      admittedOn: base.admitted_on,
      status: base.status,
      risk: base.risk_level,
      classTeacher: base.class_teacher,
      counsellor: base.counsellor,
      attendance: row?.attendance ?? null,
      average: row?.average ?? null,
      trend: row?.trend ?? 0,
      feeStatus: row?.feeStatus ?? null,
      today: row?.today ?? 'unmarked',
    },
    guardians,
    attendance: { months: attendanceMonths, totals: attendanceTotals, recent: recentAttendance },
    academics: { subjects, termTrend, assessments },
    skills,
    interests: interests.map((i) => i.interest),
    activities,
    achievements,
    behaviour,
    observations,
    interventions,
    documents,
    innovationProjects: projects,
    transport,
    timeline,
    talent: {
      strengths: skills.map((s) => ({ name: s.name, score: s.value, confidence: s.confidence, evidence: s.evidence })),
    },
  };

  if (perms.has('students.sensitive')) {
    profile.wellbeing = {
      checkins: await many(
        `SELECT w.checked_on AS date, w.mood, w.notes, e.full_name AS "by"
           FROM wellbeing_checkins w LEFT JOIN employees e ON e.id = w.recorded_by
          WHERE w.student_id = $1 ORDER BY w.checked_on DESC LIMIT 10`, [id]),
      infirmaryVisits: (await one<{ n: number }>('SELECT count(*)::int AS n FROM infirmary_visits WHERE student_id = $1', [id]))!.n,
      counsellingSessions: (await one<{ n: number }>('SELECT count(*)::int AS n FROM counselling_sessions WHERE student_id = $1', [id]))!.n,
      medicalNotes: base.medical_notes,
    };
  } else {
    // Non-sensitive summary only
    const last = await one(`SELECT checked_on AS date, mood FROM wellbeing_checkins WHERE student_id = $1 AND NOT is_confidential ORDER BY checked_on DESC LIMIT 1`, [id]);
    profile.wellbeing = { lastCheckin: last };
  }

  if (perms.has('finance.read') || perms.has('fees.pay_own')) {
    profile.fees = await one(
      `SELECT COALESCE(sum(amount_due - concession_amount), 0)::numeric AS billed,
              COALESCE(sum(amount_paid), 0)::numeric AS paid,
              COALESCE(sum(amount_due - concession_amount - amount_paid), 0)::numeric AS outstanding,
              min(due_date) FILTER (WHERE status IN ('Pending', 'Partial', 'Overdue')) AS "nextDue"
         FROM student_fees WHERE student_id = $1`, [id]);
  }

  // Internal staff records are not part of the family-facing view.
  const isStaff = perms.has('students.read') || perms.has('students.read_assigned');
  if (!isStaff) {
    delete profile.interventions;
    delete profile.observations;
  }

  // Same rule as authorizeStudentTracking: a guardian also needs can_view_tracking for this child.
  const canTrack = perms.has('tracking.read_all') || perms.has('tracking.read_assigned')
    || (perms.has('tracking.read_own_children') && !!user.parentId && (await isGuardianOf(user.parentId, id, true)));
  if (canTrack) {
    profile.tracking = await one(
      `SELECT tp.tracking_enabled AS enabled, tp.tracking_status AS status, tp.device_type AS "deviceType",
              tp.is_sample_data AS "isSampleData",
              l.latitude, l.longitude, l.accuracy, l.location_status AS "locationStatus",
              l.place_label AS "placeLabel", l.recorded_at AS "recordedAt", l.battery_pct AS "batteryPct"
         FROM students s
         LEFT JOIN student_tracking_profiles tp ON tp.student_id = s.id
         LEFT JOIN student_current_locations l ON l.student_id = s.id
        WHERE s.id = $1`, [id]);
  }
  return profile;
}

export async function addBehaviour(req: Request, studentId: string, input: { recordType: string; note: string; recordedOn?: string }) {
  const row = await one(
    `INSERT INTO behaviour_records (student_id, recorded_on, record_type, note, recorded_by)
     VALUES ($1, COALESCE($2::date, current_date), $3, $4, $5) RETURNING id`,
    [studentId, input.recordedOn ?? null, input.recordType, input.note, req.user!.employeeId],
  );
  await audit(req, { action: 'create', module: 'students', description: `Added ${input.recordType.toLowerCase()} behaviour note`, entityType: 'student', entityId: studentId });
  return row;
}

/**
 * Records an achievement, optionally with a certificate or photo. The file becomes one of the
 * student's documents (verified like any upload, by the Super Admin) and is linked to the achievement.
 */
export async function addAchievement(req: Request, studentId: string, input: { title: string; achievementType: string; level?: string; achievedOn: string },
  file?: Express.Multer.File) {
  return tx(async (db) => {
    let documentId: string | null = null;
    if (file) {
      const stored = await verifyUploadedFile(file);
      const doc = await one<{ id: string }>(
        `INSERT INTO documents (owner_type, owner_id, student_id, name, category, status, storage_key, original_name,
                                mime_type, size_bytes, checksum_sha256, uploaded_by)
         VALUES ('student', $1, $1, $2, 'Achievement certificate', 'Submitted', $3, $4, $5, $6, $7, $8) RETURNING id`,
        [studentId, input.title, stored.storageKey, safeFilename(file.originalname), file.mimetype, stored.size, stored.checksum, req.user!.id], db);
      documentId = doc!.id;
    }
    // Staff-recorded achievements are verified by the recorder.
    const row = await one(
      `INSERT INTO achievements (student_id, title, achievement_type, level, achieved_on, is_verified, verified_by, verified_at, created_by, document_id)
       VALUES ($1, $2, $3, $4, $5, true, $6, now(), $6, $7) RETURNING id, document_id AS "documentId"`,
      [studentId, input.title, input.achievementType, input.level ?? null, input.achievedOn, req.user!.id, documentId], db);
    await audit(req, {
      action: 'create', module: 'students', description: `Recorded achievement "${input.title}"${file ? ' with a certificate' : ''}`,
      entityType: 'student', entityId: studentId, metadata: documentId ? { documentId } : undefined,
    }, db);
    return row;
  });
}

export async function addObservation(req: Request, studentId: string, text: string) {
  if (!req.user!.employeeId) throw badRequest('Only staff members can record observations', 'NOT_STAFF');
  const row = await one(
    `INSERT INTO teacher_observations (student_id, employee_id, observed_on, observation) VALUES ($1, $2, current_date, $3) RETURNING id`,
    [studentId, req.user!.employeeId, text],
  );
  await audit(req, { action: 'create', module: 'students', description: 'Added teacher observation', entityType: 'student', entityId: studentId });
  return row;
}
