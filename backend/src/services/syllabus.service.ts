import type { Request } from 'express';
import { many, one, query, tx, type Queryable } from '../config/db.js';
import { Where } from '../utils/sql.js';
import { likeTerm, limitOffset, orderBy, type Pagination } from '../utils/pagination.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { audit } from './audit.service.js';
import { authorizeSection, schoolToday, sectionScope } from './academics.service.js';
import type { AuthUser } from '../types.js';

/**
 * Cambridge IGCSE syllabuses (Grades 9–10): syllabus → components (papers) →
 * topics, per-section topic coverage, and students' Core/Extended entries.
 * Lower grades follow Cambridge Primary / Lower Secondary (curriculum_stages,
 * learning_objectives) and are not tracked here.
 * Teachers only see and update their own sections (404 outside scope).
 */

/** Classes that follow IGCSE syllabuses. */
const IGCSE_CLASS = `(c.grade_level IN (9, 10) OR c.stage ILIKE '%IGCSE%')`;
const CURRENT_YEAR = '(SELECT id FROM academic_years WHERE is_current)';

/** Where builder for the current-year IGCSE sections the user may see (aliases sec, c). */
function igcseSections(user: AuthUser) {
  const w = new Where().add(`sec.academic_year_id = ${CURRENT_YEAR}`).add(IGCSE_CLASS);
  sectionScope(user, w, 'sec.id');
  return w;
}

const pg23505 = (e: unknown) => (e as { code?: string })?.code === '23505';

// =============================================================================
// Syllabuses
// =============================================================================
export async function listSyllabuses(user: AuthUser, f: { stage?: string; subjectId?: string; q?: string; active: 'true' | 'false' | 'all' }) {
  const w = igcseSections(user);
  const conds: string[] = [];
  if (f.stage) conds.push(`sy.stage = ${w.param(f.stage)}`);
  if (f.subjectId) conds.push(`sy.subject_id = ${w.param(f.subjectId)}`);
  if (f.q) {
    const t = w.param(likeTerm(f.q));
    conds.push(`(sy.title ILIKE ${t} OR sy.syllabus_code ILIKE ${t} OR sub.name ILIKE ${t})`);
  }
  if (f.active !== 'all') conds.push(`sy.is_active = ${w.param(f.active === 'true')}`);
  const rows = await many(
    `WITH secs AS (SELECT sec.id, c.grade_level FROM sections sec JOIN classes c ON c.id = sec.class_id ${w.sql}),
          pupils AS (SELECT s.id FROM students s WHERE s.deleted_at IS NULL AND s.status = 'active' AND s.section_id IN (SELECT id FROM secs))
     SELECT sy.id, sy.syllabus_code AS "syllabusCode", sy.title, sy.stage, sy.awarding_body AS "awardingBody",
            sy.exam_series_years AS "examSeriesYears", sy.tiered, sy.grading, sy.is_active AS "isActive",
            sub.id AS "subjectId", sub.code AS "subjectCode", sub.name AS subject,
            (SELECT count(*) FROM syllabus_topics t WHERE t.syllabus_id = sy.id)::int AS topics,
            (SELECT count(*) FROM secs)::int AS "allSections",
            -- Sections in the grade levels that track this syllabus (all IGCSE sections until tracking starts).
            COALESCE(NULLIF((SELECT count(*) FROM secs WHERE secs.grade_level IN (
                SELECT c2.grade_level FROM syllabus_topic_coverage cv JOIN syllabus_topics t ON t.id = cv.topic_id
                  JOIN sections s2 ON s2.id = cv.section_id JOIN classes c2 ON c2.id = s2.class_id WHERE t.syllabus_id = sy.id)), 0),
              (SELECT count(*) FROM secs))::int AS sections,
            (SELECT count(*) FROM syllabus_topic_coverage cv JOIN syllabus_topics t ON t.id = cv.topic_id
              WHERE t.syllabus_id = sy.id AND cv.status = 'Covered' AND cv.section_id IN (SELECT id FROM secs))::int AS covered,
            (SELECT count(*) FROM syllabus_topic_coverage cv JOIN syllabus_topics t ON t.id = cv.topic_id
              WHERE t.syllabus_id = sy.id AND cv.status = 'In progress' AND cv.section_id IN (SELECT id FROM secs))::int AS "inProgress",
            (SELECT count(*) FROM student_syllabus_entries e WHERE e.syllabus_id = sy.id AND e.student_id IN (SELECT id FROM pupils))::int AS entries,
            (SELECT count(*) FROM student_syllabus_entries e WHERE e.syllabus_id = sy.id AND e.tier = 'Core' AND e.student_id IN (SELECT id FROM pupils))::int AS "coreEntries",
            (SELECT count(*) FROM pupils)::int AS students,
            COALESCE((SELECT json_agg(json_build_object('id', sc.id, 'paperNo', sc.paper_no, 'name', sc.name, 'tier', sc.tier,
                                                        'maxMarks', sc.max_marks::float, 'weightingPercent', sc.weighting_percent::float)
                              ORDER BY sc.sort_order, sc.paper_no)
                        FROM syllabus_components sc WHERE sc.syllabus_id = sy.id), '[]') AS components
       FROM syllabuses sy JOIN subjects sub ON sub.id = sy.subject_id
      ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
      ORDER BY sy.syllabus_code IS NULL, sub.name, sy.syllabus_code`,
    w.params,
  );
  return rows.map((r) => {
    const slots = r.topics * r.sections;
    return { ...r, coveragePct: slots ? Math.round((100 * r.covered) / slots) : null, componentCount: r.components.length };
  });
}

async function syllabusRow(id: string, db?: Queryable) {
  const s = await one(
    `SELECT sy.id, sy.syllabus_code AS "syllabusCode", sy.title, sy.stage, sy.awarding_body AS "awardingBody",
            sy.exam_series_years AS "examSeriesYears", sy.tiered, sy.grading, sy.notes, sy.is_active AS "isActive",
            sub.id AS "subjectId", sub.code AS "subjectCode", sub.name AS subject, sy.updated_at AS "updatedAt"
       FROM syllabuses sy JOIN subjects sub ON sub.id = sy.subject_id WHERE sy.id = $1`,
    [id], db,
  );
  if (!s) throw notFound('Syllabus not found', 'SYLLABUS_NOT_FOUND');
  return s;
}

export async function getSyllabus(user: AuthUser, id: string) {
  const syllabus = await syllabusRow(id);
  const w = igcseSections(user);
  const sid = w.param(id);
  const [components, topics, sections, coverage, entrySummary] = await Promise.all([
    many(
      `SELECT id, paper_no AS "paperNo", name, tier, duration_minutes AS "durationMinutes", max_marks::float AS "maxMarks",
              weighting_percent::float AS "weightingPercent", assessment_type AS "assessmentType", option_group AS "optionGroup", notes, sort_order AS "sortOrder",
              (SELECT count(*) FROM assessments a WHERE a.syllabus_component_id = sc.id)::int AS assessments
         FROM syllabus_components sc WHERE syllabus_id = $1 ORDER BY sort_order, paper_no`,
      [id],
    ),
    many(
      `SELECT id, unit_no AS "unitNo", code, title, subtopics, tier, planned_hours::float AS "plannedHours",
              planned_weeks::float AS "plannedWeeks", sort_order AS "sortOrder"
         FROM syllabus_topics WHERE syllabus_id = $1 ORDER BY sort_order, unit_no, code`,
      [id],
    ),
    many(
      `SELECT sec.id, c.name || sec.name AS label, c.grade_level AS "gradeLevel", cp.short_name AS campus, c.campus_id AS "campusId",
              (SELECT count(*) FROM students s WHERE s.section_id = sec.id AND s.deleted_at IS NULL AND s.status = 'active')::int AS students
         FROM sections sec JOIN classes c ON c.id = sec.class_id JOIN campuses cp ON cp.id = c.campus_id
         ${w.sql}
        ORDER BY cp.short_name, c.grade_level, sec.name`,
      w.params.slice(0, -1),
    ),
    many(
      `SELECT cv.topic_id AS "topicId", cv.section_id AS "sectionId", cv.status, cv.covered_on AS "coveredOn", cv.notes,
              e.full_name AS teacher, cv.updated_at AS "updatedAt"
         FROM syllabus_topic_coverage cv
         JOIN syllabus_topics t ON t.id = cv.topic_id
         LEFT JOIN employees e ON e.id = cv.teacher_id
        WHERE t.syllabus_id = ${sid} AND cv.section_id IN (SELECT sec.id FROM sections sec JOIN classes c ON c.id = sec.class_id ${w.sql})`,
      w.params,
    ),
    one(
      `SELECT count(*)::int AS students,
              count(e.id)::int AS entered,
              count(*) FILTER (WHERE e.tier = 'Extended')::int AS extended,
              count(*) FILTER (WHERE e.tier = 'Core')::int AS core
         FROM students s
         LEFT JOIN student_syllabus_entries e ON e.student_id = s.id AND e.syllabus_id = ${sid}
        WHERE s.deleted_at IS NULL AND s.status = 'active'
          AND s.section_id IN (SELECT sec.id FROM sections sec JOIN classes c ON c.id = sec.class_id ${w.sql})`,
      w.params,
    ),
  ]);
  const byTopic = new Map<string, Record<string, unknown>>();
  for (const c of coverage) {
    const m = byTopic.get(c.topicId) ?? {};
    m[c.sectionId] = { status: c.status, coveredOn: c.coveredOn, teacher: c.teacher, notes: c.notes, updatedAt: c.updatedAt };
    byTopic.set(c.topicId, m);
  }
  const sectionSummary = sections.map((s) => {
    const covered = coverage.filter((c) => c.sectionId === s.id && c.status === 'Covered').length;
    const inProgress = coverage.filter((c) => c.sectionId === s.id && c.status === 'In progress').length;
    return { ...s, covered, inProgress, pct: topics.length ? Math.round((100 * covered) / topics.length) : null };
  });
  // Coverage is measured over the grade levels that track this syllabus (e.g. Physics in Grade 10 only).
  const trackedGrades = new Set(sectionSummary.filter((x) => x.covered || x.inProgress).map((x) => x.gradeLevel));
  const relevant = trackedGrades.size ? sectionSummary.filter((x) => trackedGrades.has(x.gradeLevel)) : sectionSummary;
  const slots = topics.length * relevant.length;
  const covered = coverage.filter((c) => c.status === 'Covered').length;
  const weight = components.reduce((a, c) => a + (c.weightingPercent ?? 0), 0);
  return {
    ...syllabus,
    components,
    topics: topics.map((t) => ({ ...t, coverage: byTopic.get(t.id) ?? {} })),
    sections: sectionSummary,
    coverage: { slots, covered, inProgress: coverage.filter((c) => c.status === 'In progress').length, pct: slots ? Math.round((100 * covered) / slots) : null },
    entries: entrySummary,
    componentWeightTotal: Math.round(weight * 10) / 10,
  };
}

const SYL_COLS: Record<string, string> = {
  subjectId: 'subject_id', stage: 'stage', awardingBody: 'awarding_body', syllabusCode: 'syllabus_code', title: 'title',
  examSeriesYears: 'exam_series_years', tiered: 'tiered', grading: 'grading', notes: 'notes', isActive: 'is_active',
};

async function assertSubject(subjectId: string, db: Queryable) {
  const s = await one('SELECT 1 FROM subjects WHERE id = $1', [subjectId], db);
  if (!s) throw badRequest('Subject not found', 'SUBJECT_NOT_FOUND', [{ field: 'subjectId', message: 'Choose a subject' }]);
}

export async function createSyllabus(req: Request, input: Record<string, unknown> & { subjectId: string; title: string }) {
  try {
    return await tx(async (db) => {
      await assertSubject(input.subjectId, db);
      const cols = Object.keys(SYL_COLS).filter((k) => input[k] !== undefined);
      const r = await one<{ id: string }>(
        `INSERT INTO syllabuses (${cols.map((k) => SYL_COLS[k]).join(', ')}, created_by)
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1}) RETURNING id`,
        [...cols.map((k) => input[k]), req.user!.id], db,
      );
      await audit(req, { action: 'create', module: 'syllabus', description: `Added syllabus ${input.syllabusCode ? `${input.syllabusCode} ` : ''}${input.title}`, entityType: 'syllabus', entityId: r!.id }, db);
      return { id: r!.id };
    });
  } catch (e) {
    if (pg23505(e)) throw conflict(`A syllabus with code ${input.syllabusCode} already exists`, 'SYLLABUS_CODE_TAKEN');
    throw e;
  }
}

export async function updateSyllabus(req: Request, id: string, input: Record<string, unknown>) {
  try {
    return await tx(async (db) => {
      const before = await one('SELECT * FROM syllabuses WHERE id = $1 FOR UPDATE', [id], db);
      if (!before) throw notFound('Syllabus not found', 'SYLLABUS_NOT_FOUND');
      if (input.subjectId) await assertSubject(input.subjectId as string, db);
      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const [k, col] of Object.entries(SYL_COLS)) {
        if (input[k] === undefined) continue;
        params.push(input[k]);
        sets.push(`${col} = $${params.length}`);
      }
      await query(`UPDATE syllabuses SET ${sets.join(', ')} WHERE id = $1`, params, db);
      await audit(req, {
        action: 'update', module: 'syllabus', description: `Updated syllabus ${before.syllabus_code ?? ''} ${before.title}`.replace(/\s+/g, ' ').trim(),
        entityType: 'syllabus', entityId: id, metadata: { changed: Object.keys(input).filter((k) => input[k] !== undefined) },
      }, db);
      return { id };
    });
  } catch (e) {
    if (pg23505(e)) throw conflict(`A syllabus with code ${input.syllabusCode} already exists`, 'SYLLABUS_CODE_TAKEN');
    throw e;
  }
}

// =============================================================================
// Components (papers)
// =============================================================================
const COMP_COLS: Record<string, string> = {
  paperNo: 'paper_no', name: 'name', tier: 'tier', durationMinutes: 'duration_minutes', maxMarks: 'max_marks',
  weightingPercent: 'weighting_percent', assessmentType: 'assessment_type', optionGroup: 'option_group', notes: 'notes', sortOrder: 'sort_order',
};

async function lockSyllabus(id: string, db: Queryable) {
  const s = await one<{ id: string; title: string; syllabus_code: string | null; tiered: boolean }>('SELECT id, title, syllabus_code, tiered FROM syllabuses WHERE id = $1 FOR UPDATE', [id], db);
  if (!s) throw notFound('Syllabus not found', 'SYLLABUS_NOT_FOUND');
  return s;
}
const label = (s: { title: string; syllabus_code: string | null }) => (s.syllabus_code ? `${s.syllabus_code} ${s.title}` : s.title);

export async function createComponent(req: Request, syllabusId: string, input: Record<string, unknown>) {
  try {
    return await tx(async (db) => {
      const s = await lockSyllabus(syllabusId, db);
      if (!s.tiered && input.tier && input.tier !== 'All') throw badRequest('This syllabus is not tiered — use tier "All"', 'VALIDATION_ERROR', [{ field: 'tier', message: 'Untiered syllabus' }]);
      const cols = Object.keys(COMP_COLS).filter((k) => input[k] !== undefined);
      const r = await one<{ id: string }>(
        `INSERT INTO syllabus_components (syllabus_id, ${cols.map((k) => COMP_COLS[k]).join(', ')})
         VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`,
        [syllabusId, ...cols.map((k) => input[k])], db,
      );
      await audit(req, { action: 'create', module: 'syllabus', description: `Added ${input.name} to ${label(s)}`, entityType: 'syllabus_component', entityId: r!.id }, db);
      return { id: r!.id };
    });
  } catch (e) {
    if (pg23505(e)) throw conflict(`Paper ${input.paperNo} already exists on this syllabus`, 'PAPER_EXISTS');
    throw e;
  }
}

export async function updateComponent(req: Request, syllabusId: string, componentId: string, input: Record<string, unknown>) {
  try {
    return await tx(async (db) => {
      const s = await lockSyllabus(syllabusId, db);
      const c = await one('SELECT name FROM syllabus_components WHERE id = $1 AND syllabus_id = $2', [componentId, syllabusId], db);
      if (!c) throw notFound('Component not found', 'COMPONENT_NOT_FOUND');
      if (!s.tiered && input.tier && input.tier !== 'All') throw badRequest('This syllabus is not tiered — use tier "All"', 'VALIDATION_ERROR', [{ field: 'tier', message: 'Untiered syllabus' }]);
      const sets: string[] = [];
      const params: unknown[] = [componentId];
      for (const [k, col] of Object.entries(COMP_COLS)) {
        if (input[k] === undefined) continue;
        params.push(input[k]);
        sets.push(`${col} = $${params.length}`);
      }
      await query(`UPDATE syllabus_components SET ${sets.join(', ')} WHERE id = $1`, params, db);
      await audit(req, { action: 'update', module: 'syllabus', description: `Updated ${c.name} on ${label(s)}`, entityType: 'syllabus_component', entityId: componentId }, db);
      return { id: componentId };
    });
  } catch (e) {
    if (pg23505(e)) throw conflict(`Paper ${input.paperNo} already exists on this syllabus`, 'PAPER_EXISTS');
    throw e;
  }
}

export async function deleteComponent(req: Request, syllabusId: string, componentId: string) {
  return tx(async (db) => {
    const s = await lockSyllabus(syllabusId, db);
    const c = await one<{ name: string; used: number }>(
      `SELECT name, (SELECT count(*) FROM assessments a WHERE a.syllabus_component_id = sc.id)::int AS used
         FROM syllabus_components sc WHERE id = $1 AND syllabus_id = $2`,
      [componentId, syllabusId], db,
    );
    if (!c) throw notFound('Component not found', 'COMPONENT_NOT_FOUND');
    if (c.used > 0) throw conflict(`${c.name} is linked to ${c.used} assessment(s) — edit it instead of deleting`, 'COMPONENT_IN_USE');
    await query('DELETE FROM syllabus_components WHERE id = $1', [componentId], db);
    await audit(req, { action: 'delete', module: 'syllabus', description: `Removed ${c.name} from ${label(s)}`, entityType: 'syllabus_component', entityId: componentId }, db);
    return { id: componentId };
  });
}

// =============================================================================
// Topics
// =============================================================================
const TOPIC_COLS: Record<string, string> = {
  unitNo: 'unit_no', code: 'code', title: 'title', subtopics: 'subtopics', tier: 'tier',
  plannedHours: 'planned_hours', plannedWeeks: 'planned_weeks', sortOrder: 'sort_order',
};

export async function createTopic(req: Request, syllabusId: string, input: Record<string, unknown>) {
  try {
    return await tx(async (db) => {
      const s = await lockSyllabus(syllabusId, db);
      if (input.sortOrder === undefined) {
        const m = await one<{ n: number }>('SELECT COALESCE(max(sort_order), 0)::int + 1 AS n FROM syllabus_topics WHERE syllabus_id = $1', [syllabusId], db);
        input.sortOrder = m!.n;
      }
      const cols = Object.keys(TOPIC_COLS).filter((k) => input[k] !== undefined);
      const r = await one<{ id: string }>(
        `INSERT INTO syllabus_topics (syllabus_id, ${cols.map((k) => TOPIC_COLS[k]).join(', ')})
         VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`,
        [syllabusId, ...cols.map((k) => input[k])], db,
      );
      await audit(req, { action: 'create', module: 'syllabus', description: `Added topic "${input.title}" to ${label(s)}`, entityType: 'syllabus_topic', entityId: r!.id }, db);
      return { id: r!.id };
    });
  } catch (e) {
    if (pg23505(e)) throw conflict(`Topic code ${input.code} already exists on this syllabus`, 'TOPIC_CODE_TAKEN');
    throw e;
  }
}

export async function updateTopic(req: Request, syllabusId: string, topicId: string, input: Record<string, unknown>) {
  try {
    return await tx(async (db) => {
      const s = await lockSyllabus(syllabusId, db);
      const t = await one('SELECT title FROM syllabus_topics WHERE id = $1 AND syllabus_id = $2', [topicId, syllabusId], db);
      if (!t) throw notFound('Topic not found', 'TOPIC_NOT_FOUND');
      const sets: string[] = [];
      const params: unknown[] = [topicId];
      for (const [k, col] of Object.entries(TOPIC_COLS)) {
        if (input[k] === undefined) continue;
        params.push(input[k]);
        sets.push(`${col} = $${params.length}`);
      }
      await query(`UPDATE syllabus_topics SET ${sets.join(', ')} WHERE id = $1`, params, db);
      await audit(req, { action: 'update', module: 'syllabus', description: `Updated topic "${t.title}" on ${label(s)}`, entityType: 'syllabus_topic', entityId: topicId }, db);
      return { id: topicId };
    });
  } catch (e) {
    if (pg23505(e)) throw conflict(`Topic code ${input.code} already exists on this syllabus`, 'TOPIC_CODE_TAKEN');
    throw e;
  }
}

export async function deleteTopic(req: Request, syllabusId: string, topicId: string) {
  return tx(async (db) => {
    const s = await lockSyllabus(syllabusId, db);
    const t = await one<{ title: string; tracked: number }>(
      `SELECT title, (SELECT count(*) FROM syllabus_topic_coverage cv WHERE cv.topic_id = t.id AND cv.status <> 'Not started')::int AS tracked
         FROM syllabus_topics t WHERE id = $1 AND syllabus_id = $2`,
      [topicId, syllabusId], db,
    );
    if (!t) throw notFound('Topic not found', 'TOPIC_NOT_FOUND');
    await query('DELETE FROM syllabus_topics WHERE id = $1', [topicId], db);
    await audit(req, {
      action: 'delete', module: 'syllabus', description: `Removed topic "${t.title}" from ${label(s)}${t.tracked ? ` (coverage for ${t.tracked} section(s) removed)` : ''}`,
      entityType: 'syllabus_topic', entityId: topicId,
    }, db);
    return { id: topicId };
  });
}

// =============================================================================
// Coverage (teachers mark their own sections)
// =============================================================================
export async function saveCoverage(req: Request, syllabusId: string, topicId: string, input: { sectionId: string; status: string; coveredOn?: string | null; notes?: string | null }) {
  const user = req.user!;
  return tx(async (db) => {
    const t = await one<{ title: string; code: string | null; syllabus: string }>(
      `SELECT t.title, t.code, COALESCE(sy.syllabus_code || ' ', '') || sy.title AS syllabus
         FROM syllabus_topics t JOIN syllabuses sy ON sy.id = t.syllabus_id WHERE t.id = $1 AND t.syllabus_id = $2`,
      [topicId, syllabusId], db,
    );
    if (!t) throw notFound('Topic not found', 'TOPIC_NOT_FOUND');
    const sec = await authorizeSection(user, input.sectionId, db); // 404 outside the teacher's sections
    const igcse = await one(`SELECT 1 FROM sections sec JOIN classes c ON c.id = sec.class_id WHERE sec.id = $1 AND ${IGCSE_CLASS}`, [sec.id], db);
    if (!igcse) throw badRequest(`${sec.label} follows Cambridge Primary / Lower Secondary, not an IGCSE syllabus`, 'NOT_IGCSE_SECTION', [{ field: 'sectionId', message: 'Choose a Grade 9 or 10 section' }]);
    const today = schoolToday();
    if (input.coveredOn && input.coveredOn > today) throw badRequest('The date cannot be in the future', 'VALIDATION_ERROR', [{ field: 'coveredOn', message: 'Cannot be in the future' }]);
    const coveredOn = input.status === 'Covered' ? input.coveredOn ?? today : null;
    await query(
      `INSERT INTO syllabus_topic_coverage (topic_id, section_id, status, covered_on, teacher_id, notes, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (topic_id, section_id) DO UPDATE
          SET status = EXCLUDED.status, covered_on = EXCLUDED.covered_on,
              teacher_id = COALESCE(EXCLUDED.teacher_id, syllabus_topic_coverage.teacher_id),
              notes = COALESCE(EXCLUDED.notes, syllabus_topic_coverage.notes), updated_by = EXCLUDED.updated_by`,
      [topicId, sec.id, input.status, coveredOn, user.employeeId, input.notes ?? null, user.id], db,
    );
    await audit(req, {
      action: 'update', module: 'syllabus',
      description: `${sec.label}: ${t.code ? `${t.code} ` : ''}${t.title} (${t.syllabus}) marked ${input.status}`,
      entityType: 'syllabus_topic', entityId: topicId, metadata: { sectionId: sec.id, status: input.status, coveredOn },
    }, db);
    return { topicId, sectionId: sec.id, status: input.status, coveredOn };
  });
}

// =============================================================================
// Student entries (Core / Extended tier per syllabus)
// =============================================================================
const ENTRY_SORTS: Record<string, string> = {
  name: 's.full_name', section: `c.grade_level, sec.name`, tier: 'e.tier', series: 'e.exam_series', admissionNo: 's.admission_no',
};

export async function listEntries(user: AuthUser, syllabusId: string, f: Pagination & { sectionId?: string; campusId?: string; tier?: string }) {
  await syllabusRow(syllabusId);
  const w = new Where().add(`s.deleted_at IS NULL AND s.status = 'active'`).add(`sec.academic_year_id = ${CURRENT_YEAR}`).add(IGCSE_CLASS);
  sectionScope(user, w, 's.section_id');
  w.addIf(f.sectionId, 's.section_id = ?');
  w.addIf(f.campusId, 'c.campus_id = ?');
  if (f.q) w.add('(s.full_name ILIKE ? OR s.admission_no ILIKE ?)', likeTerm(f.q), likeTerm(f.q));
  if (f.tier === 'None') w.add('e.id IS NULL');
  else w.addIf(f.tier, 'e.tier = ?');
  const sid = w.param(syllabusId);
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT s.id, s.admission_no AS "admissionNo", s.full_name AS "fullName", c.name || sec.name AS section, sec.id AS "sectionId",
            cp.short_name AS campus, e.id AS "entryId", e.tier, e.exam_series AS "examSeries", e.updated_at AS "updatedAt", u.full_name AS "updatedBy",
            count(*) OVER() AS total
       FROM students s
       JOIN sections sec ON sec.id = s.section_id JOIN classes c ON c.id = sec.class_id JOIN campuses cp ON cp.id = c.campus_id
       LEFT JOIN student_syllabus_entries e ON e.student_id = s.id AND e.syllabus_id = ${sid}
       LEFT JOIN users u ON u.id = e.updated_by
      ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, ENTRY_SORTS, 'section')}, s.full_name
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export async function saveEntries(req: Request, syllabusId: string, input: { entries: { studentId: string; tier?: 'Core' | 'Extended' | null; examSeries?: string | null; remove?: boolean }[] }) {
  const user = req.user!;
  return tx(async (db) => {
    const s = await lockSyllabus(syllabusId, db);
    const ids = input.entries.map((e) => e.studentId);
    const w = new Where().add('s.id = ANY(?::uuid[])', ids).add(`s.deleted_at IS NULL AND s.status = 'active'`).add(IGCSE_CLASS);
    sectionScope(user, w, 's.section_id');
    const allowed = new Set((await many<{ id: string }>(
      `SELECT s.id FROM students s JOIN sections sec ON sec.id = s.section_id JOIN classes c ON c.id = sec.class_id ${w.sql}`, w.params, db,
    )).map((r) => r.id));
    const errors: { field: string; message: string }[] = [];
    input.entries.forEach((e, i) => {
      if (!allowed.has(e.studentId)) errors.push({ field: `entries.${i}.studentId`, message: 'Student is not a Grade 9–10 student in your scope' });
      if (!e.remove && s.tiered && !e.tier) errors.push({ field: `entries.${i}.tier`, message: 'Choose Core or Extended' });
    });
    if (new Set(ids).size !== ids.length) errors.push({ field: 'entries', message: 'Each student can appear only once' });
    if (errors.length) {
      // Out-of-scope students are not found, like other student routes.
      if (errors.every((e) => e.field.endsWith('studentId'))) throw notFound('Student not found', 'STUDENT_NOT_FOUND');
      throw badRequest('Some entries are invalid', 'VALIDATION_ERROR', errors);
    }
    let saved = 0;
    let removed = 0;
    for (const e of input.entries) {
      if (e.remove) {
        const r = await query('DELETE FROM student_syllabus_entries WHERE student_id = $1 AND syllabus_id = $2', [e.studentId, syllabusId], db);
        removed += r.rowCount ?? 0;
        continue;
      }
      await query(
        `INSERT INTO student_syllabus_entries (student_id, syllabus_id, tier, exam_series, updated_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (student_id, syllabus_id) DO UPDATE
            SET tier = EXCLUDED.tier, exam_series = COALESCE(EXCLUDED.exam_series, student_syllabus_entries.exam_series), updated_by = EXCLUDED.updated_by`,
        [e.studentId, syllabusId, s.tiered ? e.tier : null, e.examSeries ?? null, user.id], db,
      );
      saved++;
    }
    const tiers = input.entries.filter((e) => !e.remove && e.tier).reduce<Record<string, number>>((a, e) => ({ ...a, [e.tier!]: (a[e.tier!] ?? 0) + 1 }), {});
    await audit(req, {
      action: 'update', module: 'syllabus',
      description: `${label(s)}: saved ${saved} entr${saved === 1 ? 'y' : 'ies'}${Object.keys(tiers).length ? ` (${Object.entries(tiers).map(([k, n]) => `${n} ${k}`).join(', ')})` : ''}${removed ? `, removed ${removed}` : ''}`,
      entityType: 'syllabus', entityId: syllabusId, metadata: { saved, removed, tiers },
    }, db);
    return { saved, removed };
  });
}
