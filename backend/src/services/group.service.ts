/**
 * Group management: live campus metrics, campus details, inter-campus
 * transfers and versioned group policies.
 */
import type { Request } from 'express';
import { many, one, query, tx } from '../config/db.js';
import { Where } from '../utils/sql.js';
import { likeTerm, limitOffset, orderBy, type Pagination } from '../utils/pagination.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { audit } from './audit.service.js';
import { authorizeStudent, studentScope } from './access.service.js';
import { notifyGuardians, notifyRoles, notifyUsers } from './notification.service.js';
import { certificateChecks } from './operations-records.service.js';
import { splitTotal, updateById } from './operations-helpers.js';
import type { AuthUser } from '../types.js';

const MODULE = 'group';
const STAFFING_KEY = 'staffing.target';
const ADMISSIONS_TARGET_KEY = 'admissions.group_target';

async function setting<T>(key: string): Promise<T | null> {
  const r = await one<{ value: T }>('SELECT value FROM system_settings WHERE key = $1', [key]);
  return r?.value ?? null;
}

const pct = (a: number | null | undefined, b: number | null | undefined, d = 1) =>
  a == null || !b ? null : Math.round((Number(a) / Number(b)) * 100 * 10 ** d) / 10 ** d;

export interface CampusMetrics {
  id: string; code: string; name: string; shortName: string; place: string; curriculum: string | null; address: string | null; established: number | null;
  students: number; atRisk: number; staff: number; staffTarget: number | null; staffingPct: number | null;
  admissionsYtd: number; enquiriesYtd: number; attendancePct: number | null; attendanceRecent: number | null; attendancePrevious: number | null;
  billed: number; collected: number; outstanding: number; collectionPct: number | null;
  engagement: number | null; nps: number | null; npsPrevious: number | null; npsMeasuredOn: string | null;
  academicIndex: number | null; academicPrevious: number | null; participationPct: number | null;
}

/**
 * The eight comparison measures per campus, computed live:
 * students · admissions YTD (enquiries Enrolled this calendar year) · attendance % (current year) ·
 * fee collection % (current year) · staff filled (active employees ÷ staffing.target) ·
 * parent engagement (avg parents.engagement_score) · parent NPS (latest survey) · academic index (latest-term mean).
 */
export async function campusMetrics(campusId?: string): Promise<CampusMetrics[]> {
  const targets = (await setting<Record<string, number>>(STAFFING_KEY)) ?? {};
  const rows = await many(
    `SELECT cp.id, cp.code, cp.name, cp.short_name AS "shortName", cp.place, cp.curriculum, cp.address, cp.established,
            st.n AS students, st.at_risk AS "atRisk",
            emp.n AS staff,
            adm.enrolled AS "admissionsYtd", adm.enquiries AS "enquiriesYtd",
            att.pct AS "attendancePct", att.recent AS "attendanceRecent", att.previous AS "attendancePrevious",
            fee.billed, fee.collected,
            eng.score AS engagement,
            nps.value AS nps, nps.prev AS "npsPrevious", nps.measured_on AS "npsMeasuredOn",
            acad.idx AS "academicIndex", acad.prev AS "academicPrevious",
            part.pct AS "participationPct"
       FROM campuses cp
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS n, count(*) FILTER (WHERE s.risk_level IN ('At Risk', 'Developing Risk'))::int AS at_risk
           FROM students s WHERE s.campus_id = cp.id AND s.deleted_at IS NULL AND s.status = 'active') st ON true
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS n FROM employees e WHERE e.campus_id = cp.id AND e.deleted_at IS NULL AND e.employment_status = 'active') emp ON true
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE q.stage = 'Enrolled')::int AS enrolled, count(*)::int AS enquiries
           FROM enquiries q WHERE q.campus_id = cp.id AND q.deleted_at IS NULL AND q.created_at >= date_trunc('year', now())) adm ON true
       LEFT JOIN LATERAL (
         SELECT round(100.0 * count(*) FILTER (WHERE a.status IN ('present', 'late')) / NULLIF(count(*), 0), 1)::float AS pct,
                round(100.0 * count(*) FILTER (WHERE a.status IN ('present', 'late') AND a.attendance_date > current_date - 30)
                      / NULLIF(count(*) FILTER (WHERE a.attendance_date > current_date - 30), 0), 1)::float AS recent,
                round(100.0 * count(*) FILTER (WHERE a.status IN ('present', 'late') AND a.attendance_date BETWEEN current_date - 60 AND current_date - 30)
                      / NULLIF(count(*) FILTER (WHERE a.attendance_date BETWEEN current_date - 60 AND current_date - 30), 0), 1)::float AS previous
           FROM attendance_records a JOIN students s ON s.id = a.student_id
           JOIN academic_years ay ON ay.is_current AND a.attendance_date BETWEEN ay.starts_on AND ay.ends_on
          WHERE s.campus_id = cp.id) att ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(sum(f.amount_due - f.concession_amount), 0)::numeric AS billed, COALESCE(sum(f.amount_paid), 0)::numeric AS collected
           FROM student_fees f JOIN students s ON s.id = f.student_id
           JOIN academic_years ay ON ay.id = f.academic_year_id AND ay.is_current
          WHERE s.campus_id = cp.id) fee ON true
       LEFT JOIN LATERAL (
         SELECT round(avg(p.engagement_score))::int AS score FROM parents p
          WHERE p.deleted_at IS NULL AND EXISTS (
            SELECT 1 FROM student_guardians sg JOIN students s ON s.id = sg.student_id
             WHERE sg.parent_id = p.id AND s.campus_id = cp.id AND s.deleted_at IS NULL)) eng ON true
       LEFT JOIN LATERAL (
         SELECT (array_agg(m.value ORDER BY m.measured_on DESC))[1]::float AS value,
                (array_agg(m.value ORDER BY m.measured_on DESC))[2]::float AS prev,
                max(m.measured_on) AS measured_on
           FROM campus_survey_metrics m WHERE m.campus_id = cp.id AND m.metric = 'parent_nps') nps ON true
       LEFT JOIN LATERAL (
         SELECT round(avg(x.score) FILTER (WHERE x.term_order = x.mx))::int AS idx,
                round(avg(x.score) FILTER (WHERE x.term_order = x.mx - 1))::int AS prev
           FROM (SELECT r.score, r.term_order, max(r.term_order) OVER () AS mx
                   FROM student_academic_records r JOIN students s ON s.id = r.student_id
                   JOIN academic_years ay ON ay.id = r.academic_year_id AND ay.is_current
                  WHERE s.campus_id = cp.id AND s.deleted_at IS NULL) x) acad ON true
       LEFT JOIN LATERAL (
         SELECT round(100.0 * count(DISTINCT sa.student_id) / NULLIF((SELECT count(*) FROM students s2
                  WHERE s2.campus_id = cp.id AND s2.deleted_at IS NULL AND s2.status = 'active'), 0))::int AS pct
           FROM student_activities sa JOIN students s ON s.id = sa.student_id
          WHERE s.campus_id = cp.id AND sa.status = 'active' AND s.deleted_at IS NULL) part ON true
      WHERE cp.is_active AND ($1::uuid IS NULL OR cp.id = $1)
      ORDER BY cp.established, cp.name`, [campusId ?? null]);
  return rows.map((r) => {
    const staffTarget = targets[r.code] ?? null;
    return {
      ...r,
      staffTarget,
      staffingPct: staffTarget ? Math.min(100, Math.round((r.staff / staffTarget) * 1000) / 10) : null,
      billed: Number(r.billed),
      collected: Number(r.collected),
      outstanding: Number(r.billed) - Number(r.collected),
      collectionPct: pct(r.collected, r.billed),
    } as CampusMetrics;
  });
}

/** The comparison table rows (label + value per campus + group figure). */
function comparisonRows(c: CampusMetrics[]) {
  const sum = (k: keyof CampusMetrics) => c.reduce((a, x) => a + Number(x[k] ?? 0), 0);
  const weighted = (k: keyof CampusMetrics, w: keyof CampusMetrics) => {
    const rows = c.filter((x) => x[k] != null);
    const tw = rows.reduce((a, x) => a + Number(x[w] ?? 0), 0);
    return tw ? Math.round((rows.reduce((a, x) => a + Number(x[k]) * Number(x[w] ?? 0), 0) / tw) * 10) / 10 : null;
  };
  const staffTarget = c.reduce((a, x) => a + (x.staffTarget ?? 0), 0);
  const row = (key: string, label: string, format: 'n' | 'pct', get: (x: CampusMetrics) => number | null, group: number | null, hint: string) =>
    ({ key, label, format, hint, values: Object.fromEntries(c.map((x) => [x.id, get(x)])), group });
  return [
    row('students', 'Students', 'n', (x) => x.students, sum('students'), 'Active students on roll'),
    row('admissions', 'Admissions YTD', 'n', (x) => x.admissionsYtd, sum('admissionsYtd'), 'Enquiries enrolled since 1 January'),
    row('attendance', 'Attendance', 'pct', (x) => x.attendancePct, weighted('attendancePct', 'students'), 'Present or late, current academic year'),
    row('collection', 'Fee collection', 'pct', (x) => x.collectionPct, pct(sum('collected'), sum('billed')), 'Collected ÷ billed, current academic year'),
    row('staffing', 'Staff filled', 'pct', (x) => x.staffingPct, staffTarget ? Math.min(100, pct(sum('staff'), staffTarget) ?? 0) : null, 'Active employees ÷ staffing target'),
    row('engagement', 'Parent engagement', 'pct', (x) => x.engagement, weighted('engagement', 'students'), 'Average parent engagement score'),
    row('nps', 'Parent NPS', 'n', (x) => x.nps, weighted('nps', 'students'), 'Latest parent survey'),
    row('academic', 'Academic index', 'n', (x) => x.academicIndex, weighted('academicIndex', 'students'), 'Mean score, latest term'),
  ];
}

export async function comparison() {
  const campuses = await campusMetrics();
  const clamp = (v: number | null) => (v == null ? null : Math.max(0, Math.min(100, Math.round(v))));
  return {
    campuses,
    rows: comparisonRows(campuses),
    radar: {
      axes: ['Attainment', 'Progress', 'Attendance', 'Participation', 'Engagement'],
      series: campuses.map((c) => ({
        campusId: c.id,
        name: c.shortName,
        values: [
          clamp(c.academicIndex),
          clamp(c.academicIndex != null && c.academicPrevious != null ? 50 + (c.academicIndex - c.academicPrevious) * 5 : null),
          clamp(c.attendancePct),
          clamp(c.participationPct),
          clamp(c.engagement),
        ],
      })),
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function groupDashboard(user: AuthUser) {
  const campuses = await campusMetrics();
  const target = await setting<number>(ADMISSIONS_TARGET_KEY);
  const sum = (k: keyof CampusMetrics) => campuses.reduce((a, x) => a + Number(x[k] ?? 0), 0);
  const [att, transfers] = await Promise.all([
    one(`SELECT round(100.0 * count(*) FILTER (WHERE a.status IN ('present', 'late') AND a.attendance_date > current_date - 30)
                  / NULLIF(count(*) FILTER (WHERE a.attendance_date > current_date - 30), 0), 1)::float AS recent,
                round(100.0 * count(*) FILTER (WHERE a.status IN ('present', 'late') AND a.attendance_date BETWEEN current_date - 60 AND current_date - 30)
                  / NULLIF(count(*) FILTER (WHERE a.attendance_date BETWEEN current_date - 60 AND current_date - 30), 0), 1)::float AS previous
           FROM attendance_records a WHERE a.attendance_date > current_date - 60`),
    listTransfers(user, { page: 1, pageSize: 6, dir: 'desc', sort: 'requested' }),
  ]);
  const rows = comparisonRows(campuses);
  const g = (k: string) => rows.find((r) => r.key === k)?.group ?? null;
  const npsPrev = (() => {
    const w = campuses.filter((c) => c.npsPrevious != null);
    const tw = w.reduce((a, c) => a + c.students, 0);
    return tw ? Math.round((w.reduce((a, c) => a + (c.npsPrevious ?? 0) * c.students, 0) / tw) * 10) / 10 : null;
  })();
  const nps = g('nps');
  const staffTarget = campuses.reduce((a, c) => a + (c.staffTarget ?? 0), 0);
  return {
    kpis: {
      campuses: campuses.length,
      students: sum('students'),
      staff: sum('staff'),
      staffTarget: staffTarget || null,
      staffingPct: g('staffing'),
      admissionsYtd: sum('admissionsYtd'),
      admissionsTarget: target,
      attendancePct: g('attendance'),
      attendanceDelta: att?.recent != null && att?.previous != null ? Math.round((att.recent - att.previous) * 10) / 10 : null,
      feesCollected: sum('collected'),
      feesOutstanding: sum('outstanding'),
      collectionPct: g('collection'),
      nps,
      npsDelta: nps != null && npsPrev != null ? Math.round((nps - npsPrev) * 10) / 10 : null,
      atRisk: sum('atRisk'),
    },
    campuses,
    rows,
    transfers: transfers.rows,
    generatedAt: new Date().toISOString(),
  };
}

// =============================================================================
// Campuses
// =============================================================================
const CAMPUS_COLS: Record<string, string> = {
  name: 'name', shortName: 'short_name', place: 'place', curriculum: 'curriculum', address: 'address', established: 'established',
};

export async function updateCampus(req: Request, id: string, b: Record<string, any>) {
  return tx(async (db) => {
    const c = await one<{ code: string; name: string }>('SELECT code, name FROM campuses WHERE id = $1 FOR UPDATE', [id], db);
    if (!c) throw notFound('Campus not found');
    const { staffingTarget, ...fields } = b;
    const hasFields = Object.values(fields).some((x) => x !== undefined);
    let keys: string[] = [];
    if (hasFields) keys = (await updateById('campuses', id, fields, CAMPUS_COLS, { db })).keys;
    if (staffingTarget !== undefined) {
      await query(
        `INSERT INTO system_settings (key, value, description, updated_by)
         VALUES ($1, jsonb_build_object($2::text, $3::int), 'Approved staff positions per campus (by campus code)', $4)
         ON CONFLICT (key) DO UPDATE SET value = system_settings.value || EXCLUDED.value, updated_by = EXCLUDED.updated_by`,
        [STAFFING_KEY, c.code, staffingTarget, req.user!.id], db);
      keys.push('staffingTarget');
    }
    if (!keys.length) throw badRequest('Nothing to update');
    await audit(req, { action: 'update', module: MODULE, description: `Updated campus ${c.name}`, entityType: 'campus', entityId: id, metadata: { changed: keys } }, db);
  });
}

// =============================================================================
// Transfers
// =============================================================================
const TRANSFER_SORTS: Record<string, string> = {
  requested: 't.requested_on', student: 's.full_name', status: `array_position(ARRAY['Submitted','Under Review','Approved','Completed','Rejected'], t.status)`,
  from: 'fc.short_name', to: 'tc.short_name',
};

const TRANSFER_SELECT = `
  SELECT t.id, t.status, t.reason, t.requested_on AS "requestedOn", t.decided_at AS "decidedAt", t.decision_note AS "decisionNote",
         t.completed_at AS "completedAt",
         t.from_campus_id AS "fromCampusId", fc.short_name AS "fromCampus", t.to_campus_id AS "toCampusId", tc.short_name AS "toCampus",
         s.id AS "studentId", s.full_name AS "studentName", s.admission_no AS "admissionNo", s.status AS "studentStatus",
         c.name AS grade, c.grade_level AS "gradeLevel", sec.name AS section, scp.short_name AS "currentCampus",
         rq.full_name AS "requestedBy", dc.full_name AS "decidedBy", cb.full_name AS "completedBy",
         tsec.name AS "toSection", tcls.name AS "toGrade"
    FROM student_transfers t
    JOIN students s ON s.id = t.student_id
    JOIN campuses scp ON scp.id = s.campus_id
    JOIN campuses fc ON fc.id = t.from_campus_id
    JOIN campuses tc ON tc.id = t.to_campus_id
    LEFT JOIN sections sec ON sec.id = s.section_id
    LEFT JOIN classes c ON c.id = sec.class_id
    LEFT JOIN users rq ON rq.id = t.requested_by
    LEFT JOIN users dc ON dc.id = t.decided_by
    LEFT JOIN users cb ON cb.id = t.completed_by
    LEFT JOIN sections tsec ON tsec.id = t.to_section_id
    LEFT JOIN classes tcls ON tcls.id = tsec.class_id`;

export async function listTransfers(user: AuthUser, f: Pagination & { campusId?: string; status?: string }) {
  const w = new Where();
  studentScope(user, w);
  if (f.campusId) w.add('(t.from_campus_id = ? OR t.to_campus_id = ?)', f.campusId, f.campusId);
  if (f.status === 'open') w.add(`t.status IN ('Submitted', 'Under Review', 'Approved')`);
  else w.addIf(f.status, 't.status = ?');
  if (f.q) w.add('(s.full_name ILIKE ? OR s.admission_no ILIKE ? OR t.reason ILIKE ?)', likeTerm(f.q), likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT q.*, count(*) OVER() AS total FROM (${TRANSFER_SELECT} ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, TRANSFER_SORTS, 'requested')}, t.created_at DESC) q
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`, w.params);
  return splitTotal(rows);
}

export async function transferSummary(user: AuthUser, campusId?: string) {
  const w = new Where();
  studentScope(user, w);
  if (campusId) w.add('(t.from_campus_id = ? OR t.to_campus_id = ?)', campusId, campusId);
  return one(
    `SELECT count(*) FILTER (WHERE t.status = 'Submitted')::int AS submitted,
            count(*) FILTER (WHERE t.status = 'Under Review')::int AS "underReview",
            count(*) FILTER (WHERE t.status = 'Approved')::int AS approved,
            count(*) FILTER (WHERE t.status = 'Completed')::int AS completed,
            count(*) FILTER (WHERE t.status = 'Rejected')::int AS rejected,
            count(*) FILTER (WHERE t.requested_on >= current_date - 120)::int AS "thisTerm"
       FROM student_transfers t JOIN students s ON s.id = t.student_id ${w.sql}`, w.params);
}

async function loadTransfer(user: AuthUser, id: string) {
  const w = new Where().add('t.id = ?', id);
  studentScope(user, w);
  const t = await one(`${TRANSFER_SELECT} ${w.sql}`, w.params);
  if (!t) throw notFound('Transfer not found');
  return t;
}

export async function getTransfer(req: Request, id: string) {
  const t = await loadTransfer(req.user!, id);
  const [checks, sections] = await Promise.all([
    certificateChecks(t.studentId, 'Transfer certificate'),
    many(`SELECT sec.id, sec.name, c.name AS grade, c.grade_level AS "gradeLevel", sec.capacity, sec.room, ct.full_name AS "classTeacher",
                 (SELECT count(*) FROM students x WHERE x.section_id = sec.id AND x.deleted_at IS NULL AND x.status = 'active')::int AS enrolled
            FROM sections sec JOIN classes c ON c.id = sec.class_id
            JOIN academic_years ay ON ay.id = sec.academic_year_id AND ay.is_current
            LEFT JOIN employees ct ON ct.id = sec.class_teacher_id
           WHERE c.campus_id = $1
           ORDER BY abs(c.grade_level - COALESCE($2::int, c.grade_level)), c.grade_level, sec.name`, [t.toCampusId, t.gradeLevel ?? null]),
  ]);
  await audit(req, { action: 'view', module: MODULE, description: `Opened transfer for ${t.studentName}`, entityType: 'student_transfer', entityId: id });
  return { ...t, checks, sections };
}

export async function createTransfer(req: Request, b: { studentId: string; toCampusId: string; reason: string }) {
  const studentId = await authorizeStudent(req, b.studentId);
  return tx(async (db) => {
    const s = await one<{ campus_id: string; full_name: string; status: string }>(
      'SELECT campus_id, full_name, status FROM students WHERE id = $1 FOR UPDATE', [studentId], db);
    if (!s || s.status !== 'active') throw badRequest('Only active students can be transferred', 'STUDENT_INACTIVE');
    if (s.campus_id === b.toCampusId) throw badRequest('The student is already at this campus', 'SAME_CAMPUS', [{ field: 'toCampusId', message: 'Choose a different campus' }]);
    const to = await one<{ name: string }>('SELECT name FROM campuses WHERE id = $1 AND is_active', [b.toCampusId], db);
    if (!to) throw badRequest('Campus not found', 'CAMPUS_NOT_FOUND', [{ field: 'toCampusId', message: 'Choose an active campus' }]);
    const open = await one(`SELECT 1 FROM student_transfers WHERE student_id = $1 AND status IN ('Submitted', 'Under Review', 'Approved')`, [studentId], db);
    if (open) throw conflict('This student already has an open transfer request', 'TRANSFER_OPEN');
    const r = await one<{ id: string }>(
      `INSERT INTO student_transfers (student_id, from_campus_id, to_campus_id, reason, status, requested_by)
       VALUES ($1,$2,$3,$4,'Submitted',$5) RETURNING id`, [studentId, s.campus_id, b.toCampusId, b.reason, req.user!.id], db);
    await audit(req, { action: 'create', module: MODULE, description: `Requested transfer of ${s.full_name} to ${to.name}`, entityType: 'student_transfer', entityId: r!.id }, db);
    await notifyRoles(['principal', 'super_admin'], {
      category: 'Attention', topic: 'group', icon: 'refresh', title: `Transfer request: ${s.full_name} → ${to.name}`, body: b.reason,
      route: '/transfers', entityType: 'student_transfer', entityId: r!.id,
    }, db);
    return { id: r!.id };
  });
}

const TRANSFER_FLOW: Record<string, { from: string[]; to: string }> = {
  review: { from: ['Submitted'], to: 'Under Review' },
  approve: { from: ['Submitted', 'Under Review'], to: 'Approved' },
  reject: { from: ['Submitted', 'Under Review', 'Approved'], to: 'Rejected' },
};

/** Records the decision only. Approving does NOT move the student — that is "Complete". */
export async function decideTransfer(req: Request, id: string, b: { action: string; note?: string | null }) {
  const t = await loadTransfer(req.user!, id);
  const step = TRANSFER_FLOW[b.action];
  if (!step.from.includes(t.status)) throw badRequest(`A transfer that is ${t.status} cannot move to ${step.to}`, 'INVALID_TRANSITION');
  if (b.action === 'reject' && !b.note) throw badRequest('Give a reason for rejecting', 'REASON_REQUIRED', [{ field: 'note', message: 'Reason required' }]);
  return tx(async (db) => {
    const r = await query(
      `UPDATE student_transfers SET status = $2, decision_note = COALESCE($3, decision_note),
              decided_by = CASE WHEN $2 IN ('Approved', 'Rejected') THEN $4::uuid ELSE decided_by END,
              decided_at = CASE WHEN $2 IN ('Approved', 'Rejected') THEN now() ELSE decided_at END
        WHERE id = $1 AND status = $5`, [id, step.to, b.note ?? null, req.user!.id, t.status], db);
    if (!r.rowCount) throw conflict('The transfer changed while you were reviewing it. Reload and try again.', 'STALE');
    await audit(req, {
      action: b.action === 'review' ? 'update' : 'approve', module: MODULE,
      description: `Transfer of ${t.studentName} (${t.fromCampus} → ${t.toCampus}): ${t.status} → ${step.to}`,
      entityType: 'student_transfer', entityId: id, metadata: { note: b.note ?? null },
    }, db);
    const requester = await one<{ requested_by: string | null }>('SELECT requested_by FROM student_transfers WHERE id = $1', [id], db);
    if (requester?.requested_by && requester.requested_by !== req.user!.id) {
      await notifyUsers([requester.requested_by], {
        category: step.to === 'Rejected' ? 'Attention' : 'Information', topic: 'group', icon: 'refresh',
        title: `Transfer of ${t.studentName} is ${step.to.toLowerCase()}`, body: b.note ?? undefined, route: '/transfers',
      }, db);
    }
    return { status: step.to };
  });
}

/** Moves the student into a section at the target campus, in one transaction. */
export async function completeTransfer(req: Request, id: string, b: { sectionId: string; note?: string | null }) {
  const t = await loadTransfer(req.user!, id);
  if (t.status !== 'Approved') throw badRequest('Only approved transfers can be completed', 'INVALID_TRANSITION');
  return tx(async (db) => {
    const tr = await one<{ status: string; student_id: string; to_campus_id: string }>(
      'SELECT status, student_id, to_campus_id FROM student_transfers WHERE id = $1 FOR UPDATE', [id], db);
    if (!tr || tr.status !== 'Approved') throw conflict('The transfer changed while you were completing it. Reload and try again.', 'STALE');
    const sec = await one<{ id: string; campus_id: string; academic_year_id: string; label: string; capacity: number; enrolled: number }>(
      `SELECT sec.id, c.campus_id, sec.academic_year_id, c.name || sec.name AS label, sec.capacity,
              (SELECT count(*) FROM students x WHERE x.section_id = sec.id AND x.deleted_at IS NULL AND x.status = 'active')::int AS enrolled
         FROM sections sec JOIN classes c ON c.id = sec.class_id
         JOIN academic_years ay ON ay.id = sec.academic_year_id AND ay.is_current
        WHERE sec.id = $1`, [b.sectionId], db);
    if (!sec || sec.campus_id !== tr.to_campus_id) {
      throw badRequest('Choose a current-year section at the destination campus', 'SECTION_MISMATCH', [{ field: 'sectionId', message: 'Section must belong to the destination campus' }]);
    }
    if (sec.enrolled >= sec.capacity) throw badRequest(`${sec.label} is full (${sec.enrolled}/${sec.capacity})`, 'SECTION_FULL', [{ field: 'sectionId', message: 'Section is full' }]);
    const s = await one<{ section_id: string | null; campus_id: string; full_name: string }>(
      'SELECT section_id, campus_id, full_name FROM students WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [tr.student_id], db);
    if (!s) throw notFound('Student not found');

    await query(`UPDATE students SET campus_id = $2, section_id = $3, academic_year_id = $4, updated_by = $5 WHERE id = $1`,
      [tr.student_id, sec.campus_id, sec.id, sec.academic_year_id, req.user!.id], db);
    const roll = await one<{ n: number }>('SELECT count(*)::int + 1 AS n FROM enrollments WHERE section_id = $1', [sec.id], db);
    await query(
      `INSERT INTO enrollments (student_id, section_id, academic_year_id, roll_no, status)
       VALUES ($1,$2,$3,$4,'active')
       ON CONFLICT (student_id, academic_year_id) DO UPDATE SET section_id = EXCLUDED.section_id, roll_no = EXCLUDED.roll_no, status = 'active'`,
      [tr.student_id, sec.id, sec.academic_year_id, roll!.n], db);
    // Transport routes belong to a campus; an assignment on the old campus no longer applies.
    await query(
      `DELETE FROM student_transport st USING transport_routes r WHERE st.student_id = $1 AND r.id = st.route_id AND r.campus_id <> $2`,
      [tr.student_id, sec.campus_id], db);
    await query(
      `UPDATE student_transfers SET status = 'Completed', from_section_id = $2, to_section_id = $3, completed_by = $4, completed_at = now(),
              decision_note = COALESCE($5, decision_note) WHERE id = $1`,
      [id, s.section_id, sec.id, req.user!.id, b.note ?? null], db);
    await query(
      `INSERT INTO student_timeline_events (student_id, occurred_on, title, body, category, tone, created_by)
       VALUES ($1, current_date, $2, $3, 'admission', 'teal', $4)`,
      [tr.student_id, `Transferred to ${t.toCampus}`, `Moved from ${t.fromCampus} to ${sec.label}. The Student 360 record moved intact.`, req.user!.id], db);
    await audit(req, {
      action: 'update', module: MODULE,
      description: `Completed transfer of ${s.full_name}: ${t.fromCampus} → ${t.toCampus} (${sec.label})`,
      entityType: 'student', entityId: tr.student_id, metadata: { transferId: id, fromSectionId: s.section_id, toSectionId: sec.id },
    }, db);
    await notifyGuardians(tr.student_id, {
      category: 'Completed', topic: 'group', icon: 'refresh',
      title: `${s.full_name} has moved to ${t.toCampus}`, body: `New class: ${sec.label}.`,
    }, db);
    return { sectionId: sec.id, section: sec.label };
  });
}

// =============================================================================
// Group policies (versioned)
// =============================================================================
export async function listPolicies(f: Pagination & { status?: string }) {
  const w = new Where();
  w.addIf(f.status, 'gp.status = ?');
  if (f.q) w.add('(gp.name ILIKE ? OR gp.scope ILIKE ?)', likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT gp.id, gp.name, gp.scope, gp.version, gp.status, gp.effective_on AS "effectiveOn", gp.updated_at AS "updatedAt",
            u.full_name AS "updatedBy", (gp.body IS NOT NULL AND gp.body <> '') AS "hasBody",
            (SELECT count(*) FROM group_policy_versions v WHERE v.policy_id = gp.id)::int AS "previousVersions",
            count(*) OVER() AS total
       FROM group_policies gp LEFT JOIN users u ON u.id = gp.updated_by
       ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, { name: 'gp.name', updated: 'gp.updated_at', status: 'gp.status', version: 'gp.version' }, 'name')}
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`, w.params);
  return splitTotal(rows);
}

export async function getPolicy(id: string) {
  const p = await one(
    `SELECT gp.id, gp.name, gp.scope, gp.version, gp.status, gp.body, gp.effective_on AS "effectiveOn",
            gp.created_at AS "createdAt", gp.updated_at AS "updatedAt", u.full_name AS "updatedBy"
       FROM group_policies gp LEFT JOIN users u ON u.id = gp.updated_by WHERE gp.id = $1`, [id]);
  if (!p) throw notFound('Policy not found');
  const versions = await many(
    `SELECT v.id, v.version, v.name, v.scope, v.status, v.body, v.effective_on AS "effectiveOn", v.change_note AS "changeNote",
            v.archived_at AS "archivedAt", u.full_name AS "archivedBy"
       FROM group_policy_versions v LEFT JOIN users u ON u.id = v.archived_by
      WHERE v.policy_id = $1 ORDER BY v.archived_at DESC`, [id]);
  return { ...p, versions };
}

export async function createPolicy(req: Request, b: any) {
  const dup = await one('SELECT 1 FROM group_policies WHERE lower(name) = lower($1) AND status <> $2', [b.name, 'Retired']);
  if (dup) throw conflict('A policy with this name already exists', 'POLICY_EXISTS');
  const r = await one<{ id: string }>(
    `INSERT INTO group_policies (name, scope, version, body, status, effective_on, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [b.name, b.scope, b.version, b.body ?? null, b.status, b.effectiveOn ?? null, req.user!.id]);
  await audit(req, { action: 'create', module: MODULE, description: `Created group policy "${b.name}" ${b.version}`, entityType: 'group_policy', entityId: r!.id });
  return { id: r!.id };
}

const POLICY_COLS: Record<string, string> = { name: 'name', scope: 'scope', version: 'version', body: 'body', status: 'status', effectiveOn: 'effective_on' };

function versionTuple(v: string) {
  return v.replace(/^v/, '').split('.').map(Number).concat([0, 0]).slice(0, 3);
}

export async function updatePolicy(req: Request, id: string, b: any) {
  return tx(async (db) => {
    const p = await one<{ name: string; scope: string; version: string; body: string | null; status: string; effective_on: string | null }>(
      'SELECT name, scope, version, body, status, effective_on FROM group_policies WHERE id = $1 FOR UPDATE', [id], db);
    if (!p) throw notFound('Policy not found');
    const contentChanged = (b.body !== undefined && (b.body ?? '') !== (p.body ?? '')) || (b.scope !== undefined && b.scope !== p.scope);
    const versionChanged = b.version !== undefined && b.version !== p.version;
    if (contentChanged && !versionChanged) {
      throw badRequest('Changing the policy text or scope needs a new version number', 'VERSION_REQUIRED', [{ field: 'version', message: `Increase from ${p.version}` }]);
    }
    if (versionChanged) {
      const [a, c] = [versionTuple(b.version), versionTuple(p.version)];
      const newer = a[0] > c[0] || (a[0] === c[0] && (a[1] > c[1] || (a[1] === c[1] && a[2] > c[2])));
      if (!newer) throw badRequest(`New version must be later than ${p.version}`, 'VERSION_NOT_NEWER', [{ field: 'version', message: `Must be later than ${p.version}` }]);
      await query(
        `INSERT INTO group_policy_versions (policy_id, version, name, scope, body, status, effective_on, change_note, archived_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, p.version, p.name, p.scope, p.body, p.status, p.effective_on, b.changeNote ?? null, req.user!.id], db);
    }
    const { changeNote: _n, ...fields } = b;
    const { keys } = await updateById('group_policies', id, { ...fields, updatedBy: req.user!.id }, { ...POLICY_COLS, updatedBy: 'updated_by' }, { db });
    await audit(req, {
      action: b.status && b.status !== p.status && (b.status === 'Active' || b.status === 'Retired') ? 'approve' : 'update', module: MODULE,
      description: `Updated group policy "${p.name}"${versionChanged ? ` ${p.version} → ${b.version}` : ''}${b.status && b.status !== p.status ? ` (${p.status} → ${b.status})` : ''}`,
      entityType: 'group_policy', entityId: id, metadata: { changed: keys, note: b.changeNote ?? null },
    }, db);
  });
}

export async function deletePolicy(req: Request, id: string) {
  const p = await one<{ name: string; status: string }>('SELECT name, status FROM group_policies WHERE id = $1', [id]);
  if (!p) throw notFound('Policy not found');
  if (p.status === 'Draft') {
    await query('DELETE FROM group_policies WHERE id = $1', [id]);
    await audit(req, { action: 'delete', module: MODULE, description: `Deleted draft policy "${p.name}"`, entityType: 'group_policy', entityId: id });
    return 'deleted';
  }
  await query(`UPDATE group_policies SET status = 'Retired', updated_by = $2 WHERE id = $1`, [id, req.user!.id]);
  await audit(req, { action: 'delete', module: MODULE, description: `Retired policy "${p.name}"`, entityType: 'group_policy', entityId: id });
  return 'retired';
}
