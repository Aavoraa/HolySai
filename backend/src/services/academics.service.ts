import type { Request } from 'express';
import { many, one, query, tx, type Queryable } from '../config/db.js';
import { Where } from '../utils/sql.js';
import { likeTerm, limitOffset, orderBy, type Pagination } from '../utils/pagination.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { audit } from './audit.service.js';
import type { AuthUser } from '../types.js';

// =============================================================================
// Data scope for section-bound academic data
//   school staff (students.read)  → every section (optionally one campus)
//   teachers (students.read_assigned) → sections they teach or are class teacher of
// =============================================================================

/** True when the user only sees their assigned sections. */
export function isRestricted(user: AuthUser) {
  return !user.permissions.has('students.read');
}

const MY_SECTIONS = `SELECT ta.section_id FROM teacher_assignments ta WHERE ta.employee_id = ?
                     UNION SELECT sec2.id FROM sections sec2 WHERE sec2.class_teacher_id = ?`;

/** Adds a predicate limiting `column` (a section id) to the user's sections. */
export function sectionScope(user: AuthUser, w: Where, column: string) {
  if (!isRestricted(user)) return w;
  if (!user.employeeId) return w.add('false');
  return w.add(`${column} IN (${MY_SECTIONS})`, user.employeeId, user.employeeId);
}

/** Class-level data (whole-grade assessments): visible when the user teaches any section of the class. */
export function classScope(user: AuthUser, w: Where, classColumn: string) {
  if (!isRestricted(user)) return w;
  if (!user.employeeId) return w.add('false');
  return w.add(`${classColumn} IN (SELECT s3.class_id FROM sections s3 WHERE s3.id IN (${MY_SECTIONS}))`, user.employeeId, user.employeeId);
}

export interface SectionInfo {
  id: string;
  name: string;
  label: string;
  classId: string;
  className: string;
  gradeLevel: number;
  campusId: string;
  room: string | null;
  classTeacherId: string | null;
}

/** Loads a section and checks it is in the user's scope. Out-of-scope sections are 404. */
export async function authorizeSection(user: AuthUser, sectionId: string, db?: Queryable): Promise<SectionInfo> {
  const w = new Where().add('sec.id = ?', sectionId);
  sectionScope(user, w, 'sec.id');
  const s = await one<SectionInfo>(
    `SELECT sec.id, sec.name, c.name || sec.name AS label, c.id AS "classId", c.name AS "className",
            c.grade_level AS "gradeLevel", c.campus_id AS "campusId", sec.room, sec.class_teacher_id AS "classTeacherId"
       FROM sections sec JOIN classes c ON c.id = sec.class_id ${w.sql}`,
    w.params, db,
  );
  if (!s) throw notFound('Section not found', 'SECTION_NOT_FOUND');
  return s;
}

/** Requires a school-level (not class-scoped) user — used for approvals and school configuration. */
export function requireSchoolScope(user: AuthUser, what = 'This action') {
  if (isRestricted(user) || user.scope === 'class') throw forbidden(`${what} needs a school-level role`);
}

export async function currentYearId(db?: Queryable) {
  const y = await one<{ id: string }>('SELECT id FROM academic_years WHERE is_current', [], db);
  if (!y) throw badRequest('No current academic year is configured', 'NO_CURRENT_YEAR');
  return y.id;
}

/** Today's date in the school timezone. */
export function schoolToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Minutes since midnight in the school timezone. */
export function schoolMinutesNow() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  const [h, m] = parts.split(':').map(Number);
  return (h % 24) * 60 + m;
}

/** ISO day of week (1 = Monday … 7 = Sunday) for a YYYY-MM-DD date. */
export function isoDow(date: string) {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

// =============================================================================
// Sections (pickers) and Classes screen
// =============================================================================
export async function listSections(user: AuthUser, campusId?: string) {
  const w = new Where().add('sec.academic_year_id = (SELECT id FROM academic_years WHERE is_current)');
  w.addIf(campusId, 'c.campus_id = ?');
  sectionScope(user, w, 'sec.id');
  const me = user.employeeId;
  const p = w.param(me);
  return many(
    `SELECT sec.id, c.name || sec.name AS label, sec.name, c.id AS "classId", c.name AS "className", c.grade_level AS "gradeLevel",
            c.campus_id AS "campusId", cp.short_name AS "campusName", sec.room,
            (SELECT count(*)::int FROM students s WHERE s.section_id = sec.id AND s.deleted_at IS NULL AND s.status = 'active') AS students,
            COALESCE((SELECT json_agg(DISTINCT sub.name) FROM teacher_assignments ta JOIN subjects sub ON sub.id = ta.subject_id
                       WHERE ta.section_id = sec.id AND ta.employee_id = ${p}::uuid), '[]') AS "mySubjects",
            (sec.class_teacher_id IS NOT NULL AND sec.class_teacher_id = ${p}::uuid) AS "isClassTeacher"
       FROM sections sec JOIN classes c ON c.id = sec.class_id JOIN campuses cp ON cp.id = c.campus_id
       ${w.sql}
      ORDER BY cp.established, c.grade_level, sec.name`,
    w.params,
  );
}

const CLASS_SORTS: Record<string, string> = {
  name: 'q."gradeLevel", q.section',
  students: 'q.students',
  attendance: 'q.attendance',
  teacher: 'q."classTeacher"',
  room: 'q.room',
};

export async function listClasses(user: AuthUser, f: Pagination & { campusId?: string; grade?: number; register?: string }) {
  const w = new Where().add('sec.academic_year_id = (SELECT id FROM academic_years WHERE is_current)');
  w.addIf(f.campusId, 'c.campus_id = ?');
  w.addIf(f.grade, 'c.grade_level = ?');
  if (f.q) w.add(`(replace(c.name || sec.name, ' ', '') ILIKE ? OR e.full_name ILIKE ?)`, likeTerm(f.q.replace(/\s+/g, '')), likeTerm(f.q));
  sectionScope(user, w, 'sec.id');
  const outer = f.register ? `WHERE q.register = ${w.param(f.register)}` : '';
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT q.*, count(*) OVER() AS total FROM (
       SELECT sec.id, c.name || sec.name AS name, sec.name AS section, c.grade_level AS "gradeLevel", c.id AS "classId",
              cp.short_name AS "campusName", sec.room, sec.class_teacher_id AS "classTeacherId", e.full_name AS "classTeacher",
              st.students, att.marked, att.present,
              CASE WHEN att.marked > 0 THEN round(100.0 * att.present / att.marked)::int END AS attendance,
              CASE WHEN st.students = 0 THEN 'No students'
                   WHEN att.marked >= st.students THEN 'Marked'
                   WHEN att.marked > 0 THEN 'Partial' ELSE 'Not marked' END AS register
         FROM sections sec
         JOIN classes c ON c.id = sec.class_id
         JOIN campuses cp ON cp.id = c.campus_id
         LEFT JOIN employees e ON e.id = sec.class_teacher_id
         CROSS JOIN LATERAL (SELECT count(*)::int AS students FROM students s WHERE s.section_id = sec.id AND s.deleted_at IS NULL AND s.status = 'active') st
         CROSS JOIN LATERAL (
           SELECT count(*)::int AS marked, count(*) FILTER (WHERE a.status IN ('present', 'late'))::int AS present
             FROM attendance_records a JOIN students s ON s.id = a.student_id AND s.deleted_at IS NULL AND s.status = 'active'
            WHERE a.section_id = sec.id AND a.attendance_date = (now() AT TIME ZONE 'Asia/Kolkata')::date) att
         ${w.sql}) q
     ${outer}
     ORDER BY ${orderBy(f.sort, f.dir, CLASS_SORTS, 'name')}, q.name
     LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export async function classesSummary(user: AuthUser, campusId?: string) {
  const w = new Where().add('sec.academic_year_id = (SELECT id FROM academic_years WHERE is_current)');
  w.addIf(campusId, 'c.campus_id = ?');
  sectionScope(user, w, 'sec.id');
  return one(
    `SELECT count(*)::int AS sections, count(DISTINCT c.id)::int AS classes,
            count(*) FILTER (WHERE sec.class_teacher_id IS NULL)::int AS "withoutClassTeacher"
       FROM sections sec JOIN classes c ON c.id = sec.class_id ${w.sql}`,
    w.params,
  );
}

export async function updateSection(req: Request, id: string, input: { classTeacherId?: string | null; room?: string | null }) {
  requireSchoolScope(req.user!, 'Changing class teachers and rooms');
  return tx(async (db) => {
    const sec = await authorizeSection(req.user!, id, db);
    if (input.classTeacherId) {
      const t = await one(`SELECT 1 FROM employees WHERE id = $1 AND employee_type = 'teaching' AND deleted_at IS NULL AND campus_id = $2`, [input.classTeacherId, sec.campusId], db);
      if (!t) throw badRequest('Choose a teacher from the same campus', 'INVALID_TEACHER');
    }
    await query(
      `UPDATE sections SET class_teacher_id = CASE WHEN $2 THEN $3::uuid ELSE class_teacher_id END,
                           room = CASE WHEN $4 THEN $5 ELSE room END
        WHERE id = $1`,
      [id, input.classTeacherId !== undefined, input.classTeacherId ?? null, input.room !== undefined, input.room ?? null], db,
    );
    await audit(req, { action: 'update', module: 'academics', description: `Updated section ${sec.label}`, entityType: 'section', entityId: id, metadata: input }, db);
    return { id };
  });
}

// =============================================================================
// Subjects
// =============================================================================
export async function listSubjects(campusId?: string) {
  const p: unknown[] = [campusId ?? null];
  return many(
    `SELECT sub.id, sub.code, sub.name, sub.stage, sub.is_core AS "isCore",
            (SELECT count(DISTINCT ta.employee_id)::int FROM teacher_assignments ta JOIN sections sec ON sec.id = ta.section_id JOIN classes c ON c.id = sec.class_id
              WHERE ta.subject_id = sub.id AND ($1::uuid IS NULL OR c.campus_id = $1)
                AND ta.academic_year_id = (SELECT id FROM academic_years WHERE is_current)) AS teachers,
            (SELECT count(DISTINCT ta.section_id)::int FROM teacher_assignments ta JOIN sections sec ON sec.id = ta.section_id JOIN classes c ON c.id = sec.class_id
              WHERE ta.subject_id = sub.id AND ($1::uuid IS NULL OR c.campus_id = $1)
                AND ta.academic_year_id = (SELECT id FROM academic_years WHERE is_current)) AS classes,
            (SELECT round(avg(r.score))::int FROM student_academic_records r JOIN students s ON s.id = r.student_id AND s.deleted_at IS NULL
              WHERE r.subject_id = sub.id AND r.academic_year_id = (SELECT id FROM academic_years WHERE is_current)
                -- latest term of the current year, computed once (not per record)
                AND r.term_order = (SELECT max(term_order) FROM student_academic_records
                                     WHERE academic_year_id = (SELECT id FROM academic_years WHERE is_current))
                AND ($1::uuid IS NULL OR s.campus_id = $1)) AS average,
            (SELECT round(avg(o.coverage_pct))::int FROM learning_objectives o WHERE o.subject_id = sub.id) AS coverage,
            (SELECT count(*)::int FROM learning_objectives o WHERE o.subject_id = sub.id) AS objectives
       FROM subjects sub
      ORDER BY sub.is_core DESC, sub.name`,
    p,
  );
}

// =============================================================================
// Curriculum & objectives
// =============================================================================
export async function curriculumOverview(campusId?: string) {
  const [stages, bySubject, trendRows, now] = await Promise.all([
    many(
      `SELECT cs.id, cs.name AS stage, cs.grades, cs.coverage_pct AS coverage,
              (SELECT count(*)::int FROM students s JOIN sections sec ON sec.id = s.section_id JOIN classes c ON c.id = sec.class_id
                WHERE c.stage = cs.name AND s.deleted_at IS NULL AND s.status = 'active' AND ($1::uuid IS NULL OR s.campus_id = $1)) AS students,
              (SELECT count(DISTINCT ta.subject_id)::int FROM teacher_assignments ta JOIN sections sec ON sec.id = ta.section_id JOIN classes c ON c.id = sec.class_id
                WHERE c.stage = cs.name AND ($1::uuid IS NULL OR c.campus_id = $1)) AS subjects,
              (SELECT count(*)::int FROM classes c WHERE c.stage = cs.name AND ($1::uuid IS NULL OR c.campus_id = $1)) AS classes
         FROM curriculum_stages cs ORDER BY cs.sort_order`,
      [campusId ?? null],
    ),
    many(
      `SELECT sub.name AS subject, round(avg(o.coverage_pct))::int AS coverage, round(avg(o.mastery_pct))::int AS mastery, count(*)::int AS objectives
         FROM learning_objectives o JOIN subjects sub ON sub.id = o.subject_id
        GROUP BY sub.name ORDER BY count(*) DESC, sub.name`,
    ),
    many(
      `SELECT sn.term, sn.term_order, round(avg(sn.coverage_pct))::int AS coverage, round(avg(sn.mastery_pct))::int AS mastery
         FROM learning_objective_snapshots sn
        WHERE sn.academic_year_id = (SELECT id FROM academic_years WHERE is_current)
        GROUP BY sn.term, sn.term_order ORDER BY sn.term_order`,
    ),
    one(`SELECT round(avg(coverage_pct))::int AS coverage, round(avg(mastery_pct))::int AS mastery, count(*)::int AS objectives FROM learning_objectives`),
  ]);
  return {
    stages,
    coverageBySubject: bySubject,
    trend: {
      labels: [...trendRows.map((t) => t.term), 'Now'],
      coverage: [...trendRows.map((t) => t.coverage), now?.coverage ?? 0],
      mastery: [...trendRows.map((t) => t.mastery), now?.mastery ?? 0],
    },
    totals: now,
  };
}

const OBJ_SORTS: Record<string, string> = {
  code: 'o.code', text: 'o.description', subject: 'sub.name', stage: 'o.stage_label', coverage: 'o.coverage_pct', mastery: 'o.mastery_pct',
};

export async function listObjectives(f: Pagination & { subjectId?: string; stage?: string }) {
  const w = new Where();
  w.addIf(f.subjectId, 'o.subject_id = ?');
  w.addIf(f.stage, 'o.stage_label = ?');
  if (f.q) w.add('(o.code ILIKE ? OR o.description ILIKE ?)', likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT o.id, o.code, o.description AS text, o.subject_id AS "subjectId", sub.name AS subject, o.stage_label AS stage,
            o.coverage_pct AS coverage, o.mastery_pct AS mastery,
            (SELECT count(*)::int FROM lesson_plans lp WHERE lp.objective_id = o.id) AS "lessonPlans",
            count(*) OVER() AS total
       FROM learning_objectives o JOIN subjects sub ON sub.id = o.subject_id
       ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, OBJ_SORTS, 'code')}, o.code
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export async function objectiveStages() {
  return (await many<{ stage: string }>('SELECT DISTINCT stage_label AS stage FROM learning_objectives ORDER BY 1')).map((r) => r.stage);
}

interface ObjectiveInput { code: string; description: string; subjectId: string; stageLabel: string; coveragePct: number; masteryPct: number }

async function insertObjective(o: ObjectiveInput, db: Queryable) {
  if (o.masteryPct > o.coveragePct) throw badRequest(`Mastery cannot exceed coverage (${o.code})`, 'VALIDATION_ERROR', [{ field: 'masteryPct', message: 'Mastery cannot exceed coverage' }]);
  const sub = await one('SELECT 1 FROM subjects WHERE id = $1', [o.subjectId], db);
  if (!sub) throw badRequest(`Unknown subject for ${o.code}`, 'SUBJECT_NOT_FOUND');
  const exists = await one('SELECT 1 FROM learning_objectives WHERE code = $1', [o.code], db);
  if (exists) throw conflict(`Objective ${o.code} already exists`, 'OBJECTIVE_EXISTS');
  return (await one<{ id: string }>(
    `INSERT INTO learning_objectives (code, description, subject_id, stage_label, coverage_pct, mastery_pct)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [o.code, o.description, o.subjectId, o.stageLabel, o.coveragePct, o.masteryPct], db,
  ))!.id;
}

export async function createObjective(req: Request, input: ObjectiveInput) {
  requireSchoolScope(req.user!, 'Curriculum mapping');
  return tx(async (db) => {
    const id = await insertObjective(input, db);
    await audit(req, { action: 'create', module: 'academics', description: `Added learning objective ${input.code}`, entityType: 'learning_objective', entityId: id }, db);
    return { id };
  });
}

export async function importObjectives(req: Request, rows: ObjectiveInput[]) {
  requireSchoolScope(req.user!, 'Importing objectives');
  const codes = rows.map((r) => r.code);
  if (new Set(codes).size !== codes.length) throw badRequest('The import contains duplicate codes', 'DUPLICATE_CODES');
  return tx(async (db) => {
    for (const r of rows) await insertObjective(r, db);
    await audit(req, { action: 'import', module: 'academics', description: `Imported ${rows.length} learning objectives`, entityType: 'learning_objective', metadata: { codes } }, db);
    return { imported: rows.length };
  });
}

export async function updateObjective(req: Request, id: string, input: Partial<ObjectiveInput>) {
  return tx(async (db) => {
    const cur = await one('SELECT * FROM learning_objectives WHERE id = $1 FOR UPDATE', [id], db);
    if (!cur) throw notFound('Objective not found');
    const coverage = input.coveragePct ?? cur.coverage_pct;
    const mastery = input.masteryPct ?? cur.mastery_pct;
    if (mastery > coverage) throw badRequest('Mastery cannot exceed coverage', 'VALIDATION_ERROR', [{ field: 'masteryPct', message: 'Mastery cannot exceed coverage' }]);
    await query(
      `UPDATE learning_objectives SET description = $2, stage_label = $3, coverage_pct = $4, mastery_pct = $5 WHERE id = $1`,
      [id, input.description ?? cur.description, input.stageLabel ?? cur.stage_label, coverage, mastery], db,
    );
    await audit(req, { action: 'update', module: 'academics', description: `Updated objective ${cur.code} (coverage ${coverage}%, mastery ${mastery}%)`, entityType: 'learning_objective', entityId: id }, db);
    return { id };
  });
}
