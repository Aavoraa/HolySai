import type { Request } from 'express';
import { many, one, query, tx, type Queryable } from '../config/db.js';
import { Where } from '../utils/sql.js';
import { likeTerm, limitOffset, orderBy, type Pagination } from '../utils/pagination.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { nextCode } from '../utils/codes.js';
import { audit } from './audit.service.js';
import { isRestricted, requireSchoolScope, schoolToday } from './academics.service.js';
import { EFFECTIVE_TIER_JOINS, EFFECTIVE_TIER_SQL, getActiveScale, gradeOrder } from './grading.service.js';
import { gradeFromScale, type Tier } from './grading-shared.js';
import type { AuthUser } from '../types.js';

/**
 * Students an assessment applies to, optionally limited to the teacher's own
 * sections. `a` is the assessments alias; `mine` adds the teacher predicate
 * (bound to the given placeholder holding the employee id).
 */
function rosterSql(mine: string | null) {
  return `SELECT s.id FROM students s
           WHERE s.deleted_at IS NULL AND s.status = 'active'
             AND ((a.section_id IS NULL AND s.section_id IN (SELECT id FROM sections WHERE class_id = a.class_id)) OR s.section_id = a.section_id)
             ${mine ? `AND s.section_id IN (SELECT ta.section_id FROM teacher_assignments ta WHERE ta.employee_id = ${mine}::uuid
                                            UNION SELECT id FROM sections WHERE class_teacher_id = ${mine}::uuid)` : ''}`;
}

/** Assessment visibility for teachers: their sections, or whole-grade assessments of classes they teach. */
function assessmentScope(user: AuthUser, w: Where) {
  if (!isRestricted(user)) return w;
  if (!user.employeeId) return w.add('false');
  const e = user.employeeId;
  return w.add(
    `((a.section_id IS NOT NULL AND a.section_id IN (SELECT ta.section_id FROM teacher_assignments ta WHERE ta.employee_id = ? UNION SELECT id FROM sections WHERE class_teacher_id = ?))
      OR (a.section_id IS NULL AND a.class_id IN (SELECT sx.class_id FROM sections sx WHERE sx.id IN (SELECT ta.section_id FROM teacher_assignments ta WHERE ta.employee_id = ? UNION SELECT id FROM sections WHERE class_teacher_id = ?))))`,
    e, e, e, e,
  );
}

const SORTS: Record<string, string> = {
  name: 'a.name', date: 'a.held_on', heldOn: 'a.held_on', status: `array_position(ARRAY['In Progress','Scheduled','Moderation','Completed'], a.status)`,
  max: 'a.max_marks', grade: 'c.grade_level', code: 'a.code', subject: 'sub.name',
};

function baseSelect(minePh: string | null) {
  return `SELECT a.id, a.code, a.name, a.assessment_type AS "assessmentType", a.status, a.held_on AS "heldOn", a.max_marks AS "maxMarks",
                 a.class_id AS "classId", a.section_id AS "sectionId", c.name || COALESCE(sec.name, '') AS grade, c.campus_id AS "campusId",
                 a.subject_id AS "subjectId", sub.name AS subject,
                 (SELECT count(*)::int FROM (${rosterSql(minePh)}) r) AS "of",
                 (SELECT count(*)::int FROM assessment_marks m WHERE m.assessment_id = a.id AND (m.marks IS NOT NULL OR m.is_absent)
                    AND m.student_id IN (${rosterSql(minePh)})) AS entered,
                 (SELECT round(avg(100.0 * m.marks / a.max_marks))::int FROM assessment_marks m WHERE m.assessment_id = a.id AND m.marks IS NOT NULL
                    AND m.student_id IN (${rosterSql(minePh)})) AS "averagePct",
                 u.full_name AS "createdBy",
                 a.syllabus_component_id AS "syllabusComponentId",
                 CASE WHEN sc.id IS NOT NULL THEN concat_ws(' · ', sy.syllabus_code, sc.name) END AS "igcsePaper"
            FROM assessments a
            JOIN classes c ON c.id = a.class_id
            LEFT JOIN sections sec ON sec.id = a.section_id
            JOIN subjects sub ON sub.id = a.subject_id
            LEFT JOIN users u ON u.id = a.created_by
            LEFT JOIN syllabus_components sc ON sc.id = a.syllabus_component_id
            LEFT JOIN syllabuses sy ON sy.id = sc.syllabus_id`;
}

export async function listAssessments(user: AuthUser, f: Pagination & { campusId?: string; status?: string; subjectId?: string; classId?: string }) {
  const w = new Where().add('a.academic_year_id = (SELECT id FROM academic_years WHERE is_current)');
  w.addIf(f.campusId, 'c.campus_id = ?');
  w.addIf(f.status, 'a.status = ?');
  w.addIf(f.subjectId, 'a.subject_id = ?');
  w.addIf(f.classId, 'a.class_id = ?');
  if (f.q) w.add('(a.name ILIKE ? OR a.code ILIKE ?)', likeTerm(f.q), likeTerm(f.q));
  assessmentScope(user, w);
  const mine = isRestricted(user) ? w.param(user.employeeId) : null;
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `${baseSelect(mine).replace('FROM assessments a', ', count(*) OVER() AS total FROM assessments a')} ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, SORTS, 'date')}, a.code DESC
     LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export async function assessmentSummary(user: AuthUser, campusId?: string) {
  const w = new Where().add('a.academic_year_id = (SELECT id FROM academic_years WHERE is_current)');
  w.addIf(campusId, 'c.campus_id = ?');
  assessmentScope(user, w);
  const mine = isRestricted(user) ? w.param(user.employeeId) : null;
  const all = await many(`${baseSelect(mine)} ${w.sql} ORDER BY a.held_on DESC`, w.params);
  const today = schoolToday();
  const termStart = new Date(Date.parse(`${today}T00:00:00Z`) - 90 * 86400000).toISOString().slice(0, 10);
  const scheduled = all.filter((a) => a.status === 'Scheduled');
  const inProgress = all.filter((a) => a.status === 'In Progress');
  const pending = all
    .filter((a) => (a.status === 'In Progress' || a.status === 'Scheduled') && a.heldOn <= today)
    .map((a) => ({ name: a.name, grade: a.grade, pending: Math.max(0, a.of - a.entered) }))
    .filter((a) => a.pending > 0)
    .sort((a, b) => b.pending - a.pending);
  const moderation = all.filter((a) => a.status === 'Moderation');
  const completed = all.filter((a) => a.status === 'Completed' && a.heldOn >= termStart);

  // Grade distribution for the most recent completed assessment in scope.
  const latest = all.find((a) => a.status === 'Completed');
  let distribution = null;
  if (latest) {
    const d = await many<{ grade: string; n: number }>(
      `SELECT m.grade, count(*)::int AS n FROM assessment_marks m WHERE m.assessment_id = $1 AND m.grade IS NOT NULL GROUP BY m.grade`,
      [latest.id],
    );
    const by = Object.fromEntries(d.map((x) => [x.grade, x.n]));
    // Cambridge IGCSE order A*, A … G, U — every band shown so the shape of the cohort is visible.
    const bands = await gradeOrder();
    distribution = { assessment: `${latest.grade} — ${latest.name}`, labels: [...bands], values: bands.map((g) => by[g] ?? 0) };
  }

  // Marker consistency for the assessment in moderation (else the latest completed one).
  const modTarget = moderation[0] ?? all.find((a) => a.status === 'Completed' && a.entered > 0);
  let markers = null;
  if (modTarget) {
    const m = await many<{ marker: string; mean: number; scripts: number }>(
      `SELECT COALESCE(u.full_name, 'Unknown') AS marker, round(avg(100.0 * m.marks / a.max_marks), 1)::float AS mean, count(*)::int AS scripts
         FROM assessment_marks m JOIN assessments a ON a.id = m.assessment_id LEFT JOIN users u ON u.id = m.entered_by
        WHERE m.assessment_id = $1 AND m.marks IS NOT NULL
        GROUP BY u.full_name ORDER BY mean DESC`,
      [modTarget.id],
    );
    const total = m.reduce((a, x) => a + x.scripts, 0);
    const cohort = total ? Math.round((m.reduce((a, x) => a + x.mean * x.scripts, 0) / total) * 10) / 10 : 0;
    markers = {
      assessment: `${modTarget.grade} — ${modTarget.name}`,
      status: modTarget.status,
      cohortMean: cohort,
      rows: m.map((x) => ({ ...x, deviation: Math.round((x.mean - cohort) * 10) / 10, flagged: m.length > 1 && Math.abs(x.mean - cohort) >= 4 })),
    };
  }
  return {
    active: scheduled.length + inProgress.length,
    scheduled: scheduled.length,
    inProgress: inProgress.length,
    marksPending: pending.reduce((a, x) => a + x.pending, 0),
    marksPendingFoot: pending[0] ? `${pending[0].name} · ${pending[0].grade}` : null,
    awaitingModeration: moderation.length,
    moderationFoot: moderation.length ? [...new Set(moderation.map((m) => m.grade))].join(', ') : null,
    completedThisTerm: completed.length,
    distribution,
    markers,
  };
}

async function loadAssessment(user: AuthUser, id: string, db?: Queryable, lock = false) {
  const w = new Where().add('a.id = ?', id);
  assessmentScope(user, w);
  const a = await one(
    `SELECT a.*, c.name AS class_name, c.campus_id, sec.name AS section_name, sub.name AS subject_name,
            sc.name AS component_name, sc.paper_no, sc.tier AS component_tier, sy.id AS syllabus_id, sy.syllabus_code, sy.title AS syllabus_title, sy.tiered
       FROM assessments a JOIN classes c ON c.id = a.class_id LEFT JOIN sections sec ON sec.id = a.section_id
       JOIN subjects sub ON sub.id = a.subject_id
       LEFT JOIN syllabus_components sc ON sc.id = a.syllabus_component_id
       LEFT JOIN syllabuses sy ON sy.id = sc.syllabus_id ${w.sql} ${lock ? 'FOR UPDATE OF a' : ''}`,
    w.params, db,
  );
  if (!a) throw notFound('Assessment not found', 'ASSESSMENT_NOT_FOUND');
  return a;
}

export async function getAssessment(user: AuthUser, id: string) {
  const a = await loadAssessment(user, id);
  const mine = isRestricted(user) ? '$2' : null;
  const params: unknown[] = [id];
  if (mine) params.push(user.employeeId);
  const students = await many(
    `SELECT s.id, s.admission_no AS "admissionNo", s.full_name AS "fullName", c.name || sec.name AS section, en.roll_no AS roll,
            m.marks, m.is_absent AS "isAbsent", m.grade, m.remarks, u.full_name AS "enteredBy", m.updated_at AS "updatedAt",
            ${EFFECTIVE_TIER_SQL} AS tier
       FROM assessments a
       JOIN students s ON s.id IN (${rosterSql(mine)})
       JOIN sections sec ON sec.id = s.section_id JOIN classes c ON c.id = sec.class_id
       LEFT JOIN enrollments en ON en.student_id = s.id AND en.academic_year_id = a.academic_year_id
       LEFT JOIN assessment_marks m ON m.assessment_id = a.id AND m.student_id = s.id
       LEFT JOIN users u ON u.id = m.entered_by
       LEFT JOIN syllabus_components scx ON scx.id = a.syllabus_component_id
       LEFT JOIN syllabuses syx ON syx.id = scx.syllabus_id
       LEFT JOIN student_syllabus_entries sex ON sex.syllabus_id = syx.id AND sex.student_id = s.id
      WHERE a.id = $1
      ORDER BY sec.name, en.roll_no NULLS LAST, s.full_name`,
    params,
  );
  const today = schoolToday();
  const locked = a.status === 'Moderation' || a.status === 'Completed';
  return {
    id: a.id, code: a.code, name: a.name, assessmentType: a.assessment_type, status: a.status,
    heldOn: a.held_on, maxMarks: a.max_marks, grade: `${a.class_name}${a.section_name ?? ''}`, subject: a.subject_name,
    component: a.syllabus_component_id ? {
      id: a.syllabus_component_id, paperNo: a.paper_no, name: a.component_name, tier: a.component_tier,
      syllabusId: a.syllabus_id, syllabusCode: a.syllabus_code, syllabusTitle: a.syllabus_title, tiered: a.tiered,
    } : null,
    locked,
    canEnter: !locked && a.held_on <= today,
    lockReason: locked ? `Marks are locked — the assessment is in ${a.status}.` : a.held_on > today ? 'Marks can be entered once the assessment has been held.' : null,
    students,
    entered: students.filter((s) => s.marks != null || s.isAbsent).length,
    of: students.length,
  };
}

export async function createAssessment(req: Request, input: { name: string; classId: string; sectionId?: string | null; subjectId: string; assessmentType: string; heldOn: string; maxMarks: number; syllabusComponentId?: string | null }) {
  const user = req.user!;
  return tx(async (db) => {
    const cls = await one<{ id: string; name: string }>('SELECT id, name FROM classes WHERE id = $1', [input.classId], db);
    if (!cls) throw badRequest('Class not found', 'CLASS_NOT_FOUND', [{ field: 'classId', message: 'Choose a class' }]);
    if (input.sectionId) {
      const s = await one('SELECT 1 FROM sections WHERE id = $1 AND class_id = $2', [input.sectionId, input.classId], db);
      if (!s) throw badRequest('The section does not belong to this class', 'SECTION_CLASS_MISMATCH', [{ field: 'sectionId', message: 'Choose a section of this class' }]);
    }
    const sub = await one('SELECT 1 FROM subjects WHERE id = $1', [input.subjectId], db);
    if (!sub) throw badRequest('Subject not found', 'SUBJECT_NOT_FOUND', [{ field: 'subjectId', message: 'Choose a subject' }]);
    if (input.syllabusComponentId) {
      const comp = await one(
        `SELECT 1 FROM syllabus_components sc JOIN syllabuses sy ON sy.id = sc.syllabus_id WHERE sc.id = $1 AND sy.subject_id = $2`,
        [input.syllabusComponentId, input.subjectId], db,
      );
      if (!comp) throw badRequest('That IGCSE paper does not belong to this subject', 'COMPONENT_SUBJECT_MISMATCH', [{ field: 'syllabusComponentId', message: 'Choose a paper from this subject\'s syllabus' }]);
    }
    if (isRestricted(user)) {
      const teaches = await one(
        `SELECT 1 FROM teacher_assignments ta JOIN sections sx ON sx.id = ta.section_id
          WHERE ta.employee_id = $1 AND ta.subject_id = $2 AND sx.class_id = $3 AND ($4::uuid IS NULL OR ta.section_id = $4)`,
        [user.employeeId, input.subjectId, input.classId, input.sectionId ?? null], db,
      );
      if (!teaches) throw notFound('You can only create assessments for sections and subjects you teach', 'SECTION_NOT_FOUND');
    }
    const year = await one<{ id: string; starts_on: string; ends_on: string }>('SELECT id, starts_on, ends_on FROM academic_years WHERE is_current', [], db);
    if (!year) throw badRequest('No current academic year is configured', 'NO_CURRENT_YEAR');
    if (input.heldOn < year.starts_on || input.heldOn > year.ends_on) {
      throw badRequest('The date must fall within the current academic year', 'VALIDATION_ERROR', [{ field: 'heldOn', message: 'Outside the current academic year' }]);
    }
    const code = await nextCode('assessments', 'code', 'AS-', db);
    const a = await one<{ id: string }>(
      `INSERT INTO assessments (code, name, class_id, section_id, subject_id, academic_year_id, assessment_type, held_on, max_marks, status, created_by, syllabus_component_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Scheduled',$10,$11) RETURNING id`,
      [code, input.name, input.classId, input.sectionId ?? null, input.subjectId, year.id, input.assessmentType, input.heldOn, input.maxMarks, user.id, input.syllabusComponentId ?? null], db,
    );
    await audit(req, { action: 'create', module: 'assessments', description: `Created assessment ${code} — ${input.name} (${cls.name})`, entityType: 'assessment', entityId: a!.id }, db);
    return { id: a!.id, code };
  });
}

export async function saveMarks(req: Request, id: string, input: { marks: { studentId: string; marks: number | null; isAbsent: boolean; remarks?: string | null }[]; action: 'save' | 'moderation' | 'complete' }) {
  const user = req.user!;
  return tx(async (db) => {
    const a = await loadAssessment(user, id, db, true);
    const today = schoolToday();
    if (a.status === 'Completed') throw conflict('This assessment is completed and its marks are locked', 'ASSESSMENT_LOCKED');
    if (a.status === 'Moderation') {
      if (input.marks.length) throw conflict('Marks are locked while the assessment is in moderation', 'ASSESSMENT_LOCKED');
      if (input.action !== 'complete') throw conflict('The assessment is already in moderation', 'ASSESSMENT_LOCKED');
      requireSchoolScope(user, 'Completing moderation');
    }
    if (input.marks.length && a.held_on > today) throw badRequest('Marks can be entered once the assessment has been held', 'NOT_HELD_YET');

    const mine = isRestricted(user) ? '$2' : null;
    const allowed = new Set((await many<{ id: string }>(
      `SELECT r.id FROM assessments a CROSS JOIN LATERAL (${rosterSql(mine)}) r WHERE a.id = $1`,
      mine ? [id, user.employeeId] : [id], db,
    )).map((r) => r.id));
    const errors: { field: string; message: string }[] = [];
    input.marks.forEach((m, i) => {
      if (!allowed.has(m.studentId)) errors.push({ field: `marks.${i}.studentId`, message: 'Student is not on this assessment roster' });
      if (m.marks != null && m.marks > Number(a.max_marks)) errors.push({ field: `marks.${i}.marks`, message: `Mark cannot exceed ${a.max_marks}` });
      if (m.isAbsent && m.marks != null) errors.push({ field: `marks.${i}.marks`, message: 'An absent student cannot have a mark' });
    });
    if (errors.length) throw badRequest('Some marks are invalid', 'VALIDATION_ERROR', errors);

    // Cambridge IGCSE grade on the active scale, with the Core/Extended tier when the assessment mirrors a syllabus paper.
    const scale = await getActiveScale();
    const tiers = new Map<string, Tier | null>();
    if (a.syllabus_component_id && input.marks.length) {
      const t = await many<{ student_id: string; tier: Tier | null }>(
        `SELECT m.student_id, ${EFFECTIVE_TIER_SQL} AS tier
           FROM assessments a CROSS JOIN unnest($2::uuid[]) AS m(student_id) ${EFFECTIVE_TIER_JOINS}
          WHERE a.id = $1`,
        [id, input.marks.map((m) => m.studentId)], db,
      );
      for (const x of t) tiers.set(x.student_id, x.tier);
    }
    for (const m of input.marks) {
      const grade = m.marks == null ? null : gradeFromScale(scale, (100 * m.marks) / Number(a.max_marks), tiers.get(m.studentId) ?? null);
      await query(
        `INSERT INTO assessment_marks (assessment_id, student_id, marks, is_absent, grade, remarks, entered_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (assessment_id, student_id) DO UPDATE
            SET marks = EXCLUDED.marks, is_absent = EXCLUDED.is_absent, grade = EXCLUDED.grade,
                remarks = COALESCE(EXCLUDED.remarks, assessment_marks.remarks), entered_by = EXCLUDED.entered_by`,
        [id, m.studentId, m.marks, m.isAbsent, grade, m.remarks ?? null, user.id], db,
      );
    }

    const counts = await one<{ of: number; entered: number }>(
      `SELECT (SELECT count(*)::int FROM (${rosterSql(null)}) r) AS "of",
              (SELECT count(*)::int FROM assessment_marks m WHERE m.assessment_id = a.id AND (m.marks IS NOT NULL OR m.is_absent)
                 AND m.student_id IN (${rosterSql(null)})) AS entered
         FROM assessments a WHERE a.id = $1`,
      [id], db,
    );
    const complete = !!counts && counts.of > 0 && counts.entered >= counts.of;
    let status = a.status as string;
    if (input.action === 'moderation' || input.action === 'complete') {
      if (!complete) throw badRequest(`Marks are missing for ${counts!.of - counts!.entered} student(s)`, 'MARKS_INCOMPLETE');
      status = input.action === 'moderation' ? 'Moderation' : 'Completed';
    } else if (status === 'Scheduled' && (counts?.entered ?? 0) > 0) {
      status = 'In Progress';
    }
    if (status !== a.status) await query('UPDATE assessments SET status = $2 WHERE id = $1', [id, status], db);
    await audit(req, {
      action: input.action === 'save' ? 'update' : 'approve', module: 'assessments',
      description: `${input.marks.length ? `Saved ${input.marks.length} mark(s) for` : 'Updated'} ${a.code} — ${a.name}${status !== a.status ? ` (${a.status} → ${status})` : ''}`,
      entityType: 'assessment', entityId: id, metadata: { saved: input.marks.length, status, entered: counts?.entered, of: counts?.of },
    }, db);
    return { id, status, entered: counts?.entered ?? 0, of: counts?.of ?? 0 };
  });
}

// =============================================================================
// Question bank
// =============================================================================
export async function questionTopics(f: { subjectId?: string; q?: string }) {
  const w = new Where().add(`qb.status <> 'Retired'`);
  w.addIf(f.subjectId, 'qb.subject_id = ?');
  if (f.q) w.add('qb.topic ILIKE ?', likeTerm(f.q));
  return many(
    `SELECT qb.topic, qb.subject_id AS "subjectId", sub.name AS subject, qb.stage_label AS stage,
            count(*)::int AS items, count(*) FILTER (WHERE qb.times_used > 0)::int AS used,
            count(*) FILTER (WHERE qb.status = 'Draft')::int AS drafts,
            CASE WHEN count(DISTINCT qb.difficulty) > 1 THEN 'Mixed' ELSE min(qb.difficulty) END AS difficulty
       FROM question_bank qb JOIN subjects sub ON sub.id = qb.subject_id
       ${w.sql}
      GROUP BY qb.topic, qb.subject_id, sub.name, qb.stage_label
      ORDER BY sub.name, qb.topic`,
    w.params,
  );
}

const Q_SORTS: Record<string, string> = { question: 'qb.question', topic: 'qb.topic', difficulty: 'qb.difficulty', marks: 'qb.marks', used: 'qb.times_used', status: 'qb.status', updated: 'qb.updated_at' };

export async function listQuestions(f: Pagination & { subjectId?: string; topic?: string; difficulty?: string; status?: string }) {
  const w = new Where();
  w.addIf(f.subjectId, 'qb.subject_id = ?');
  w.addIf(f.topic, 'qb.topic = ?');
  w.addIf(f.difficulty, 'qb.difficulty = ?');
  w.addIf(f.status, 'qb.status = ?');
  if (f.q) w.add('(qb.question ILIKE ? OR qb.topic ILIKE ?)', likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT qb.id, qb.subject_id AS "subjectId", sub.name AS subject, qb.topic, qb.stage_label AS "stageLabel", qb.question,
            qb.question_type AS "questionType", qb.difficulty, qb.marks, qb.times_used AS "timesUsed", qb.status,
            qb.created_by AS "createdById", u.full_name AS "createdBy", qb.updated_at AS "updatedAt", count(*) OVER() AS total
       FROM question_bank qb JOIN subjects sub ON sub.id = qb.subject_id LEFT JOIN users u ON u.id = qb.created_by
       ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, Q_SORTS, 'question')}, qb.id
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export async function createQuestion(req: Request, input: { subjectId: string; topic: string; stageLabel: string; question: string; questionType: string; difficulty: string; marks: number; status: string }) {
  return tx(async (db) => {
    const sub = await one('SELECT 1 FROM subjects WHERE id = $1', [input.subjectId], db);
    if (!sub) throw badRequest('Subject not found', 'SUBJECT_NOT_FOUND', [{ field: 'subjectId', message: 'Choose a subject' }]);
    const q = await one<{ id: string }>(
      `INSERT INTO question_bank (subject_id, topic, stage_label, question, question_type, difficulty, marks, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [input.subjectId, input.topic, input.stageLabel, input.question, input.questionType, input.difficulty, input.marks, input.status, req.user!.id], db,
    );
    await audit(req, { action: 'create', module: 'academics', description: `Added question to "${input.topic}"`, entityType: 'question', entityId: q!.id }, db);
    return { id: q!.id };
  });
}

async function editableQuestion(user: AuthUser, id: string, db: Queryable) {
  const q = await one('SELECT * FROM question_bank WHERE id = $1 FOR UPDATE', [id], db);
  if (!q) throw notFound('Question not found');
  if (isRestricted(user) && q.created_by !== user.id) throw notFound('Question not found');
  return q;
}

const Q_COLS: Record<string, string> = { topic: 'topic', stageLabel: 'stage_label', question: 'question', questionType: 'question_type', difficulty: 'difficulty', marks: 'marks', status: 'status' };

export async function updateQuestion(req: Request, id: string, input: Record<string, unknown>) {
  return tx(async (db) => {
    const q = await editableQuestion(req.user!, id, db);
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const [k, col] of Object.entries(Q_COLS)) {
      if (input[k] === undefined) continue;
      params.push(input[k]);
      sets.push(`${col} = $${params.length}`);
    }
    await query(`UPDATE question_bank SET ${sets.join(', ')} WHERE id = $1`, params, db);
    await audit(req, { action: 'update', module: 'academics', description: `Updated question in "${q.topic}"${input.status ? ` (${input.status})` : ''}`, entityType: 'question', entityId: id }, db);
    return { id };
  });
}

export async function deleteQuestion(req: Request, id: string) {
  return tx(async (db) => {
    const q = await editableQuestion(req.user!, id, db);
    if (q.times_used > 0) throw conflict('This question has been used in assessments — retire it instead of deleting', 'QUESTION_IN_USE');
    await query('DELETE FROM question_bank WHERE id = $1', [id], db);
    await audit(req, { action: 'delete', module: 'academics', description: `Deleted unused question from "${q.topic}"`, entityType: 'question', entityId: id, metadata: { question: q.question } }, db);
    return { id };
  });
}

