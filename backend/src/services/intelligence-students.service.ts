import type { Request } from 'express';
import { many, one, query, tx } from '../config/db.js';
import { Where } from '../utils/sql.js';
import { likeTerm, limitOffset } from '../utils/pagination.js';
import { conflict, forbidden, notFound } from '../utils/errors.js';
import type { AuthUser } from '../types.js';
import { audit } from './audit.service.js';
import { authorizeStudent, canAccessStudent, studentScope } from './access.service.js';
import { addBehaviour } from './students.service.js';

/** Start of the current term window (never before the academic year starts). */
const TERM_START = `GREATEST((SELECT starts_on FROM academic_years WHERE is_current), (date_trunc('month', now()) - interval '2 months')::date)`;

function scoped(user: AuthUser, campusId?: string) {
  const w = new Where().add("s.deleted_at IS NULL AND s.status = 'active'");
  studentScope(user, w);
  w.addIf(campusId, 's.campus_id = ?');
  return w;
}

// =============================================================================
// Talent Discovery
// =============================================================================
const STRONG = 82;

export async function talentOverview(user: AuthUser, campusId?: string) {
  const w = scoped(user, campusId);
  const [distribution, suggestions, decisions, totals] = await Promise.all([
    many(
      `SELECT sk.skill, count(*) FILTER (WHERE sk.score >= ${STRONG})::int AS strong,
              count(*) FILTER (WHERE sk.score >= 68 AND sk.score < ${STRONG})::int AS developing,
              count(*) FILTER (WHERE sk.score < 68)::int AS emerging,
              round(avg(sk.score))::int AS average
         FROM student_skills sk JOIN students s ON s.id = sk.student_id ${w.sql}
        GROUP BY sk.skill ORDER BY sk.skill`, w.params),
    many(
      `SELECT sk.id AS "skillId", sk.skill, sk.score, sk.confidence, sk.evidence, jsonb_array_length(sk.evidence)::int AS "evidenceCount",
              sk.assessed_on AS "assessedOn", s.id AS "studentId", s.full_name AS "studentName", s.admission_no AS "admissionNo",
              c.name AS grade, sec.name AS section,
              (SELECT count(*) FROM student_activities sa WHERE sa.student_id = s.id AND sa.status = 'active')::int AS activities
         FROM student_skills sk
         JOIN students s ON s.id = sk.student_id
         LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
         ${w.sql} AND sk.score >= ${STRONG}
          AND NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.entity_type = 'student_skill' AND a.entity_id = sk.id::text
                            AND a.module = 'talent' AND a.action IN ('accept', 'dismiss'))
        ORDER BY sk.score DESC, jsonb_array_length(sk.evidence) DESC, s.full_name
        LIMIT 8`, w.params),
    many(
      `SELECT a.created_at AS at, a.action, a.user_name AS "by", a.description, a.metadata->>'skill' AS skill,
              s.id AS "studentId", s.full_name AS "studentName"
         FROM audit_logs a
         JOIN student_skills sk ON a.entity_id = sk.id::text
         JOIN students s ON s.id = sk.student_id
        ${w.sql} AND a.entity_type = 'student_skill' AND a.module = 'talent' AND a.action IN ('accept', 'dismiss')
        ORDER BY a.created_at DESC LIMIT 8`, w.params),
    one(
      `SELECT count(DISTINCT s.id)::int AS students,
              count(DISTINCT s.id) FILTER (WHERE sk.score >= ${STRONG})::int AS "withStrength"
         FROM students s LEFT JOIN student_skills sk ON sk.student_id = s.id ${w.sql}`, w.params),
  ]);
  return {
    rule: `A suggestion appears when a skill is rated ${STRONG} or above and no opportunity has yet been recorded or declined for it.`,
    threshold: STRONG,
    distribution,
    suggestions,
    decisions,
    totals,
  };
}

export async function talentStudent(req: Request, idOrCode: string) {
  const id = await authorizeStudent(req, idOrCode);
  const [student, skills, interests, activities] = await Promise.all([
    one(`SELECT s.id, s.full_name AS "fullName", s.admission_no AS "admissionNo", c.name AS grade, sec.name AS section
           FROM students s LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id WHERE s.id = $1`, [id]),
    many(`SELECT sk.id, sk.skill AS name, sk.score, sk.confidence, sk.evidence, sk.assessed_on AS "assessedOn",
                 (SELECT json_build_object('action', a.action, 'by', a.user_name, 'at', a.created_at, 'note', COALESCE(a.metadata->>'opportunity', a.metadata->>'reason'))
                    FROM audit_logs a WHERE a.entity_type = 'student_skill' AND a.entity_id = sk.id::text AND a.module = 'talent'
                     AND a.action IN ('accept', 'dismiss') ORDER BY a.created_at DESC LIMIT 1) AS decision
            FROM student_skills sk WHERE sk.student_id = $1 ORDER BY sk.score DESC`, [id]),
    many(`SELECT interest FROM student_interests WHERE student_id = $1 ORDER BY interest`, [id]),
    many(`SELECT act.name, act.category, sa.role, sa.hours FROM student_activities sa JOIN activities act ON act.id = sa.activity_id
           WHERE sa.student_id = $1 AND sa.status = 'active' ORDER BY sa.hours DESC`, [id]),
  ]);
  return { student, strengths: skills, interests: interests.map((i) => i.interest), activities };
}

export async function talentDecision(req: Request, skillId: string, input: { decision: 'accept'; opportunity: string } | { decision: 'dismiss'; reason: string }) {
  const user = req.user!;
  return tx(async (db) => {
    const sk = await one(
      `SELECT sk.id, sk.skill, sk.score, s.id AS "studentId", s.full_name AS "studentName", s.admission_no AS "admissionNo"
         FROM student_skills sk JOIN students s ON s.id = sk.student_id WHERE sk.id = $1 AND s.deleted_at IS NULL FOR UPDATE OF sk`, [skillId], db);
    if (!sk || !(await canAccessStudent(user, sk.studentId))) throw notFound('Suggestion not found', 'SUGGESTION_NOT_FOUND');
    const done = await one(
      `SELECT action FROM audit_logs WHERE entity_type = 'student_skill' AND entity_id = $1 AND module = 'talent' AND action IN ('accept', 'dismiss') LIMIT 1`,
      [skillId], db);
    if (done) throw conflict('A decision has already been recorded for this suggestion', 'ALREADY_DECIDED');
    if (input.decision === 'accept') {
      await query(
        `INSERT INTO student_timeline_events (student_id, occurred_on, title, body, category, tone, created_by)
         VALUES ($1, current_date, $2, $3, 'talent', 'teal', $4)`,
        [sk.studentId, `Opportunity offered — ${sk.skill}`, input.opportunity, user.id], db);
      await audit(req, {
        action: 'accept', module: 'talent', entityType: 'student_skill', entityId: skillId,
        description: `Accepted talent suggestion for ${sk.studentName} (${sk.admissionNo}) — ${sk.skill}: ${input.opportunity}`,
        metadata: { skill: sk.skill, score: sk.score, opportunity: input.opportunity, studentId: sk.studentId },
      }, db);
    } else {
      await audit(req, {
        action: 'dismiss', module: 'talent', entityType: 'student_skill', entityId: skillId,
        description: `Dismissed talent suggestion for ${sk.studentName} (${sk.admissionNo}) — ${sk.skill}: ${input.reason}`,
        metadata: { skill: sk.skill, score: sk.score, reason: input.reason, studentId: sk.studentId },
      }, db);
    }
    return { skillId, decision: input.decision === 'accept' ? 'accepted' : 'dismissed', studentId: sk.studentId };
  });
}

// =============================================================================
// Behaviour & Wellbeing
// =============================================================================
export async function wellbeingOverview(user: AuthUser, campusId?: string) {
  const w = scoped(user, campusId);
  const sensitive = user.permissions.has('students.sensitive');
  const canSeeInfirmary = sensitive || user.permissions.has('safety.read');
  const [notes, byGrade, counselling, safeguarding, moods, infirmary] = await Promise.all([
    one(
      `WITH win AS (SELECT ${TERM_START} AS start, current_date - ${TERM_START} AS len)
       SELECT count(*) FILTER (WHERE b.record_type = 'Positive' AND b.recorded_on >= win.start)::int AS positive,
              count(*) FILTER (WHERE b.record_type = 'Positive' AND b.recorded_on >= win.start - win.len AND b.recorded_on < win.start)::int AS "positivePrev",
              count(*) FILTER (WHERE b.record_type IN ('Concern', 'Incident') AND b.recorded_on >= win.start)::int AS concerns,
              count(*) FILTER (WHERE b.record_type IN ('Concern', 'Incident') AND b.recorded_on >= win.start - win.len AND b.recorded_on < win.start)::int AS "concernsPrev",
              min(win.start) AS "termStart"
         FROM win CROSS JOIN behaviour_records b JOIN students s ON s.id = b.student_id ${w.sql}`, w.params),
    many(
      `SELECT c.grade_level AS level, 'G' || c.grade_level AS label,
              count(*) FILTER (WHERE b.record_type = 'Positive')::int AS positive,
              count(*) FILTER (WHERE b.record_type IN ('Concern', 'Incident'))::int AS concern
         FROM behaviour_records b JOIN students s ON s.id = b.student_id
         JOIN sections sec ON sec.id = s.section_id JOIN classes c ON c.id = sec.class_id
        ${w.sql} AND b.recorded_on >= ${TERM_START}
        GROUP BY c.grade_level ORDER BY c.grade_level`, w.params),
    one(
      `SELECT count(*)::int AS sessions, count(DISTINCT cs.student_id)::int AS students,
              count(*) FILTER (WHERE cs.status = 'Scheduled' AND cs.session_on >= now())::int AS upcoming
         FROM counselling_sessions cs JOIN students s ON s.id = cs.student_id
        ${w.sql} AND cs.session_on >= ${TERM_START}`, w.params),
    (() => {
      // Counts only; staff with class scope see incidents linked to their own students.
      const iw = new Where().add(`i.incident_type = 'Safeguarding' AND i.occurred_on >= ${TERM_START}`);
      iw.addIf(campusId, 'i.campus_id = ?');
      studentScope(user, iw);
      return one(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE i.status = 'Closed')::int AS closed,
                count(*) FILTER (WHERE i.status <> 'Closed')::int AS open
           FROM incidents i LEFT JOIN students s ON s.id = i.student_id ${iw.sql}`, iw.params);
    })(),
    many(
      `SELECT x.mood AS label, count(*)::int AS value FROM (
         SELECT DISTINCT ON (wc.student_id) wc.mood FROM wellbeing_checkins wc JOIN students s ON s.id = wc.student_id
          ${w.sql} ${sensitive ? '' : 'AND NOT wc.is_confidential'}
          ORDER BY wc.student_id, wc.checked_on DESC) x
        GROUP BY x.mood ORDER BY 2 DESC`, w.params),
    canSeeInfirmary
      ? many(
        `SELECT iv.id, iv.visited_at AS "visitedAt", iv.reason, iv.outcome AS status, iv.parent_informed AS "parentInformed",
                s.id AS "studentId", s.full_name AS student, c.name || sec.name AS grade
           FROM infirmary_visits iv JOIN students s ON s.id = iv.student_id
           LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
          ${w.sql} AND iv.visited_at >= current_date ORDER BY iv.visited_at DESC`, w.params)
      : Promise.resolve(null),
  ]);
  const delta = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : null);
  return {
    termStart: notes?.termStart,
    positive: { value: notes?.positive ?? 0, delta: delta(notes?.positive ?? 0, notes?.positivePrev ?? 0) },
    concerns: { value: notes?.concerns ?? 0, delta: delta(notes?.concerns ?? 0, notes?.concernsPrev ?? 0) },
    counselling,
    safeguarding,
    byGrade,
    moods,
    moodScope: sensitive ? 'all check-ins' : 'non-confidential check-ins only',
    infirmary,
    canViewSensitive: sensitive,
  };
}

export async function listBehaviour(user: AuthUser, f: { page: number; pageSize: number; q?: string; campusId?: string; type?: string }) {
  const w = scoped(user, f.campusId);
  w.addIf(f.type, 'b.record_type = ?');
  if (f.q) w.add('(s.full_name ILIKE ? OR b.note ILIKE ?)', likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT b.id, b.recorded_on AS date, b.record_type AS type, b.note, e.full_name AS "by",
            s.id AS "studentId", s.full_name AS "studentName", s.admission_no AS "admissionNo", c.name || sec.name AS grade,
            count(*) OVER() AS total
       FROM behaviour_records b JOIN students s ON s.id = b.student_id
       LEFT JOIN employees e ON e.id = b.recorded_by
       LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
      ${w.sql} ORDER BY b.recorded_on DESC, b.created_at DESC
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`, w.params);
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export async function listCheckins(req: Request, f: { page: number; pageSize: number; q?: string; campusId?: string; mood?: string }) {
  const user = req.user!;
  const sensitive = user.permissions.has('students.sensitive');
  const w = scoped(user, f.campusId);
  if (!sensitive) w.add('NOT wc.is_confidential');
  w.addIf(f.mood, 'wc.mood = ?');
  if (f.q) w.add('s.full_name ILIKE ?', likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT wc.id, wc.checked_on AS date, wc.mood, wc.notes, wc.is_confidential AS confidential, e.full_name AS "by",
            s.id AS "studentId", s.full_name AS "studentName", s.admission_no AS "admissionNo", c.name || sec.name AS grade,
            count(*) OVER() AS total
       FROM wellbeing_checkins wc JOIN students s ON s.id = wc.student_id
       LEFT JOIN employees e ON e.id = wc.recorded_by
       LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
      ${w.sql} ORDER BY wc.checked_on DESC, wc.created_at DESC
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`, w.params);
  const confidential = rows.filter((r) => r.confidential).length;
  if (confidential) {
    await audit(req, { action: 'view', module: 'wellbeing', description: `Viewed ${confidential} confidential wellbeing check-in(s)`, metadata: { ids: rows.filter((r) => r.confidential).map((r) => r.id) } });
  }
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0, confidentialVisible: sensitive };
}

export async function createBehaviour(req: Request, input: { studentId: string; recordType: string; note: string; recordedOn?: string }) {
  const id = await authorizeStudent(req, input.studentId);
  return addBehaviour(req, id, input);
}

export async function createCheckin(req: Request, input: { studentId: string; mood: string; notes?: string; isConfidential: boolean; checkedOn?: string }) {
  const user = req.user!;
  if (input.isConfidential && !user.permissions.has('students.sensitive')) {
    throw forbidden('Confidential check-ins need the students.sensitive permission');
  }
  const id = await authorizeStudent(req, input.studentId);
  const row = await one<{ id: string }>(
    `INSERT INTO wellbeing_checkins (student_id, checked_on, mood, notes, is_confidential, recorded_by)
     VALUES ($1, COALESCE($2::date, current_date), $3, $4, $5, $6) RETURNING id`,
    [id, input.checkedOn ?? null, input.mood, input.notes ?? null, input.isConfidential, user.employeeId]);
  await audit(req, {
    action: 'create', module: 'wellbeing', entityType: 'student', entityId: id,
    description: `Recorded ${input.isConfidential ? 'confidential ' : ''}wellbeing check-in (${input.mood})`,
  });
  return row;
}

// =============================================================================
// Portfolio
// =============================================================================
const EVIDENCE_SQL = `
  CROSS JOIN LATERAL (
    SELECT EXISTS (SELECT 1 FROM achievements a WHERE a.student_id = s.id AND a.is_verified) AS ach,
           EXISTS (SELECT 1 FROM student_activities sa WHERE sa.student_id = s.id) AS act,
           (EXISTS (SELECT 1 FROM innovation_projects p WHERE p.lead_student_id = s.id)
             OR EXISTS (SELECT 1 FROM innovation_project_members m WHERE m.student_id = s.id)
             OR EXISTS (SELECT 1 FROM student_timeline_events t WHERE t.student_id = s.id AND t.category IN ('activity', 'project'))) AS proj,
           EXISTS (SELECT 1 FROM documents d WHERE d.student_id = s.id AND d.deleted_at IS NULL AND d.status = 'Verified') AS doc
  ) ev`;

export async function portfolioOverview(user: AuthUser, campusId?: string) {
  const w = scoped(user, campusId);
  const byGrade = await many(
    `SELECT c.grade_level AS level, 'G' || c.grade_level AS label, count(*)::int AS students,
            round(100.0 * count(*) FILTER (WHERE ev.ach AND ev.act AND ev.proj AND ev.doc) / count(*))::int AS complete,
            round(100.0 * count(*) FILTER (WHERE ev.ach) / count(*))::int AS achievements,
            round(100.0 * count(*) FILTER (WHERE ev.act) / count(*))::int AS activities,
            round(100.0 * count(*) FILTER (WHERE ev.proj) / count(*))::int AS projects,
            round(100.0 * count(*) FILTER (WHERE ev.doc) / count(*))::int AS documents
       FROM students s JOIN sections sec ON sec.id = s.section_id JOIN classes c ON c.id = sec.class_id
       ${EVIDENCE_SQL}
      ${w.sql}
      GROUP BY c.grade_level ORDER BY c.grade_level`, w.params);
  const total = byGrade.reduce((a, g) => a + g.students, 0);
  const weighted = (k: string) => (total ? Math.round(byGrade.reduce((a, g) => a + g[k] * g.students, 0) / total) : 0);
  return {
    students: total,
    complete: weighted('complete'),
    categories: [
      { key: 'achievements', label: 'Verified achievements', value: weighted('achievements') },
      { key: 'activities', label: 'Activities', value: weighted('activities') },
      { key: 'projects', label: 'Project evidence', value: weighted('projects') },
      { key: 'documents', label: 'Verified documents', value: weighted('documents') },
    ],
    byGrade,
  };
}

export async function portfolioStudent(req: Request, idOrCode: string) {
  const id = await authorizeStudent(req, idOrCode);
  const [student, achievements, activities, projects, documents, skills, interests, milestones] = await Promise.all([
    one(`SELECT s.id, s.full_name AS "fullName", s.admission_no AS "admissionNo", s.house, c.name AS grade, sec.name AS section,
                cp.short_name AS campus, ev.ach, ev.act, ev.proj, ev.doc
           FROM students s JOIN campuses cp ON cp.id = s.campus_id
           LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
           ${EVIDENCE_SQL}
          WHERE s.id = $1`, [id]),
    many(`SELECT a.id, a.title, a.achievement_type AS type, a.level, a.achieved_on AS date, a.is_verified AS verified,
                 d.id AS "documentId", (d.storage_key IS NOT NULL) AS "hasCertificate"
            FROM achievements a LEFT JOIN documents d ON d.id = a.document_id AND d.deleted_at IS NULL
           WHERE a.student_id = $1 ORDER BY a.achieved_on DESC`, [id]),
    many(`SELECT act.name, act.category, sa.role, sa.since, sa.hours, sa.status
            FROM student_activities sa JOIN activities act ON act.id = sa.activity_id WHERE sa.student_id = $1 ORDER BY sa.since DESC`, [id]),
    many(`SELECT p.id, p.code, p.title, p.status, p.started_on AS date, m.full_name AS mentor, 'Innovation Lab' AS source
            FROM innovation_projects p LEFT JOIN employees m ON m.id = p.mentor_id
           WHERE p.lead_student_id = $1 OR p.id IN (SELECT project_id FROM innovation_project_members WHERE student_id = $1)
          UNION ALL
          SELECT t.id, NULL, t.title, 'Recorded', t.occurred_on, NULL, 'Growth timeline'
            FROM student_timeline_events t WHERE t.student_id = $1 AND t.category IN ('activity', 'project')
          ORDER BY date DESC NULLS LAST`, [id]),
    many(`SELECT id, name, category, status, verified_at AS "verifiedAt", (storage_key IS NOT NULL) AS "hasFile"
            FROM documents WHERE student_id = $1 AND deleted_at IS NULL ORDER BY category, name`, [id]),
    many(`SELECT skill AS name, score, confidence FROM student_skills WHERE student_id = $1 ORDER BY score DESC LIMIT 5`, [id]),
    many(`SELECT interest FROM student_interests WHERE student_id = $1 ORDER BY interest`, [id]),
    many(`SELECT occurred_on AS date, title, body, category, tone FROM student_timeline_events WHERE student_id = $1 ORDER BY occurred_on DESC LIMIT 12`, [id]),
  ]);
  if (!student) throw notFound('Student not found', 'STUDENT_NOT_FOUND');
  await audit(req, { action: 'view', module: 'students', entityType: 'student', entityId: id, description: `Viewed portfolio of ${student.admissionNo}` });
  const { ach, act, proj, doc, ...rest } = student;
  return {
    student: rest,
    completeness: [
      { key: 'achievements', label: 'Verified achievements', done: ach },
      { key: 'activities', label: 'Activities', done: act },
      { key: 'projects', label: 'Project evidence', done: proj },
      { key: 'documents', label: 'Verified documents', done: doc },
    ],
    achievements, activities, projects, documents, skills,
    interests: interests.map((i) => i.interest),
    timeline: milestones,
  };
}
