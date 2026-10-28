/**
 * Student Innovation Lab: Idea → Review → Mentor → Project → Prototype → Competition → Achievement.
 * Teachers see only projects of students in their scope (or projects they mentor).
 */
import type { Request } from 'express';
import { many, one, query, tx, type Queryable } from '../config/db.js';
import { Where } from '../utils/sql.js';
import { likeTerm, limitOffset, orderBy, type Pagination } from '../utils/pagination.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { nextCode } from '../utils/codes.js';
import { audit } from './audit.service.js';
import { authorizeStudent, studentScope } from './access.service.js';
import { notifyGuardians, notifyUsers } from './notification.service.js';
import { splitTotal, updateById } from './operations-helpers.js';
import { schoolToday } from './intelligence-common.service.js';
import type { AuthUser } from '../types.js';
import { STAGES, STAGE_STATUS } from '../validators/innovation.validators.js';

const MODULE = 'innovation';

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------
/** Records the fragments studentScope() adds, so the same rule can be embedded in sub-queries. */
class CaptureWhere extends Where {
  frags: { sql: string; values: unknown[] }[] = [];
  add(fragment: string, ...values: unknown[]) {
    this.frags.push({ sql: fragment, values });
    return super.add(fragment, ...values);
  }
}

/** `SELECT s.id FROM students s WHERE <scope>` for the user, or null when unrestricted. */
function scopedStudents(user: AuthUser) {
  const c = new CaptureWhere();
  studentScope(user, c, 's');
  if (!c.frags.length) return null;
  return { sql: `SELECT s.id FROM students s WHERE ${c.frags.map((f) => `(${f.sql})`).join(' AND ')}`, params: c.frags.flatMap((f) => f.values) };
}

/** Restricts innovation_projects (alias p) to what the user may see. */
function projectScope(user: AuthUser, w: Where, alias = 'p') {
  const s = scopedStudents(user);
  if (!s) return w;
  return w.add(
    `(${alias}.mentor_id = ? OR ${alias}.lead_student_id IN (${s.sql})
      OR EXISTS (SELECT 1 FROM innovation_project_members pm WHERE pm.project_id = ${alias}.id AND pm.student_id IN (${s.sql})))`,
    user.employeeId, ...s.params, ...s.params,
  );
}

/** Restricts a student id column to the user's scope. */
function studentColumnScope(user: AuthUser, w: Where, column: string) {
  const s = scopedStudents(user);
  if (!s) return w;
  return w.add(`${column} IN (${s.sql})`, ...s.params);
}

async function loadProject(user: AuthUser, id: string, db?: Queryable, lock = false) {
  const w = new Where().add('p.id = ?', id);
  projectScope(user, w);
  const p = await one<{ id: string; code: string; title: string; stage: number; status: string; lead_student_id: string; mentor_id: string | null; lead_name: string }>(
    `SELECT p.id, p.code, p.title, p.stage, p.status, p.lead_student_id, p.mentor_id, s.full_name AS lead_name
       FROM innovation_projects p JOIN students s ON s.id = p.lead_student_id ${w.sql} ${lock ? 'FOR UPDATE OF p' : ''}`, w.params, db);
  if (!p) throw notFound('Project not found', 'PROJECT_NOT_FOUND');
  return p;
}

async function assertMentor(mentorId: string, db?: Queryable) {
  const m = await one<{ full_name: string; user_id: string | null }>(
    `SELECT e.full_name, e.user_id FROM employees e JOIN teachers t ON t.employee_id = e.id
      WHERE e.id = $1 AND e.deleted_at IS NULL AND e.employment_status = 'active'`, [mentorId], db);
  if (!m) throw badRequest('Mentor must be an active teaching employee', 'MENTOR_NOT_FOUND', [{ field: 'mentorId', message: 'Choose an active teacher' }]);
  return m;
}

const STUDENT_COLS = `s.id AS "studentId", s.full_name AS "studentName", s.admission_no AS "admissionNo",
  c.name AS grade, sec.name AS section, cp.short_name AS "campusName"`;
const STUDENT_JOINS = (col: string) => `JOIN students s ON s.id = ${col}
  JOIN campuses cp ON cp.id = s.campus_id
  LEFT JOIN sections sec ON sec.id = s.section_id
  LEFT JOIN classes c ON c.id = sec.class_id`;

// =============================================================================
// Dashboard
// =============================================================================
export async function dashboard(user: AuthUser, campusId?: string) {
  const pw = new Where();
  projectScope(user, pw);
  pw.addIf(campusId, 's.campus_id = ?');
  const iw = new Where();
  studentColumnScope(user, iw, 'i.student_id');
  iw.addIf(campusId, 's.campus_id = ?');

  const [projects, ideas, stageCounts, mentors, participants, school, competitions, achievements, milestones, recent, upcoming, skills] = await Promise.all([
    one(`SELECT count(*)::int AS total, count(*) FILTER (WHERE p.stage < 6)::int AS active,
                count(*) FILTER (WHERE p.stage >= 4)::int AS prototypes,
                count(*) FILTER (WHERE p.stage = 6)::int AS completed,
                count(DISTINCT p.mentor_id) FILTER (WHERE p.stage < 6)::int AS "activeMentors"
           FROM innovation_projects p JOIN students s ON s.id = p.lead_student_id ${pw.sql}`, pw.params),
    one(`SELECT count(*)::int AS total,
                count(*) FILTER (WHERE i.status = 'Submitted')::int AS submitted,
                count(*) FILTER (WHERE i.status = 'Under Review')::int AS "underReview",
                count(*) FILTER (WHERE i.status = 'Accepted')::int AS accepted,
                count(*) FILTER (WHERE i.submitted_on >= date_trunc('month', current_date))::int AS "thisMonth",
                count(*) FILTER (WHERE i.submitted_on >= date_trunc('month', current_date) - interval '1 month' AND i.submitted_on < date_trunc('month', current_date))::int AS "lastMonth"
           FROM innovation_ideas i JOIN students s ON s.id = i.student_id ${iw.sql}`, iw.params),
    many<{ stage: number; n: number }>(`SELECT p.stage, count(*)::int AS n FROM innovation_projects p JOIN students s ON s.id = p.lead_student_id ${pw.sql} GROUP BY p.stage`, pw.params),
    one(`SELECT count(*)::int AS n FROM teachers t JOIN employees e ON e.id = t.employee_id
          WHERE t.is_mentor AND e.deleted_at IS NULL AND e.employment_status = 'active' AND ($1::uuid IS NULL OR e.campus_id = $1)`, [campusId ?? null]),
    one(`SELECT count(DISTINCT x.sid)::int AS n FROM (
           SELECT p.lead_student_id AS sid, s.campus_id FROM innovation_projects p JOIN students s ON s.id = p.lead_student_id ${pw.sql}
           UNION SELECT pm.student_id, s.campus_id FROM innovation_project_members pm
             JOIN innovation_projects p ON p.id = pm.project_id JOIN students s ON s.id = p.lead_student_id ${pw.sql}) x`, [...pw.params]),
    one(`SELECT count(*)::int AS n FROM students WHERE deleted_at IS NULL AND status = 'active' AND ($1::uuid IS NULL OR campus_id = $1)`, [campusId ?? null]),
    one(`SELECT count(DISTINCT ce.competition_id)::int AS entered,
                count(*)::int AS entries,
                count(*) FILTER (WHERE ce.result ~* '(1st|2nd|3rd|place|winner|finalist|medal)')::int AS placed
           FROM competition_entries ce JOIN innovation_projects p ON p.id = ce.project_id JOIN students s ON s.id = p.lead_student_id ${pw.sql}`, pw.params),
    achievementCounts(user, campusId),
    milestoneCounts(user, campusId),
    many(`SELECT p.id, p.code, p.title, p.stage, p.status, p.updated_at AS "updatedAt", m.full_name AS mentor, ${STUDENT_COLS},
                 (SELECT count(*) FROM innovation_milestones x WHERE x.project_id = p.id)::int AS milestones,
                 (SELECT count(*) FROM innovation_milestones x WHERE x.project_id = p.id AND x.completed_on IS NOT NULL)::int AS done
            FROM innovation_projects p ${STUDENT_JOINS('p.lead_student_id')}
            LEFT JOIN employees m ON m.id = p.mentor_id
            ${pw.sql} ORDER BY p.updated_at DESC LIMIT 8`, pw.params),
    many(`SELECT co.id, co.name, co.level, co.held_on AS "heldOn", co.result,
                 (SELECT count(*) FROM competition_entries ce WHERE ce.competition_id = co.id)::int AS teams
            FROM competitions co WHERE co.held_on >= current_date - 60 ORDER BY co.held_on LIMIT 5`),
    many(`WITH lab AS (
            SELECT p.lead_student_id AS sid FROM innovation_projects p JOIN students s ON s.id = p.lead_student_id ${pw.sql}
            UNION SELECT pm.student_id FROM innovation_project_members pm JOIN innovation_projects p ON p.id = pm.project_id
              JOIN students s ON s.id = p.lead_student_id ${pw.sql})
          SELECT k.skill,
                 round(avg(k.score) FILTER (WHERE k.student_id IN (SELECT sid FROM lab)))::int AS lab,
                 round((percentile_cont(0.5) WITHIN GROUP (ORDER BY k.score))::numeric)::int AS school
            FROM student_skills k JOIN students s ON s.id = k.student_id
           WHERE s.deleted_at IS NULL AND k.skill = ANY($${pw.params.length + 1})
           GROUP BY k.skill`, [...pw.params, ['Creativity', 'Critical Thinking', 'Collaboration', 'Communication', 'Leadership']]),
  ]);

  const byStage = new Map(stageCounts.map((r) => [r.stage, r.n]));
  const pipeline = STAGES.map((label, i) => {
    let value = byStage.get(i) ?? 0;
    if (i === 0) value += ideas!.submitted;
    if (i === 1) value += ideas!.underReview;
    if (i === 2) value += ideas!.accepted;
    return { stage: i, label, value };
  });
  const skillOrder = ['Creativity', 'Critical Thinking', 'Collaboration', 'Communication', 'Leadership'];
  return {
    kpis: {
      ideas: ideas!.total,
      ideasThisMonth: ideas!.thisMonth,
      ideasLastMonth: ideas!.lastMonth,
      activeProjects: projects!.active,
      totalProjects: projects!.total,
      mentors: mentors!.n,
      activeMentors: projects!.activeMentors,
      students: participants!.n,
      studentsPct: school!.n ? Math.round((participants!.n / school!.n) * 1000) / 10 : 0,
      competitions: competitions!.entered,
      competitionEntries: competitions!.entries,
      placed: competitions!.placed,
      achievements: achievements.thisYear,
      prototypes: projects!.prototypes,
      overdueMilestones: milestones.overdue,
    },
    pipeline,
    projects: recent,
    competitions: upcoming,
    skills: skillOrder.map((k) => {
      const r = skills.find((x) => x.skill === k);
      return { skill: k, lab: r?.lab ?? null, school: r?.school ?? null };
    }),
  };
}

// =============================================================================
// Ideas
// =============================================================================
const IDEA_SORTS: Record<string, string> = {
  submitted: 'i.submitted_on', title: 'i.title', student: 's.full_name', category: 'i.category',
  status: `array_position(ARRAY['Submitted','Under Review','Accepted','Converted','Declined'], i.status)`,
};

export async function listIdeas(user: AuthUser, f: Pagination & { campusId?: string; status?: string; category?: string }) {
  const w = new Where();
  studentColumnScope(user, w, 'i.student_id');
  w.addIf(f.campusId, 's.campus_id = ?');
  if (f.status === 'open') w.add(`i.status IN ('Submitted', 'Under Review', 'Accepted')`);
  else w.addIf(f.status, 'i.status = ?');
  w.addIf(f.category, 'i.category = ?');
  if (f.q) w.add('(i.title ILIKE ? OR s.full_name ILIKE ?)', likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT i.id, i.title, i.problem, i.category, i.status, i.submitted_on AS "submittedOn",
            (current_date - i.submitted_on) AS "ageDays", rv.full_name AS "reviewedBy",
            pr.id AS "projectId", pr.code AS "projectCode", ${STUDENT_COLS}, count(*) OVER() AS total
       FROM innovation_ideas i ${STUDENT_JOINS('i.student_id')}
       LEFT JOIN employees rv ON rv.id = i.reviewed_by
       LEFT JOIN innovation_projects pr ON pr.idea_id = i.id
       ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, IDEA_SORTS, 'submitted')}, i.created_at DESC
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`, w.params);
  return splitTotal(rows);
}

export async function ideaSummary(user: AuthUser, campusId?: string) {
  const w = new Where();
  studentColumnScope(user, w, 'i.student_id');
  w.addIf(campusId, 's.campus_id = ?');
  return one(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE i.status = 'Submitted')::int AS submitted,
            count(*) FILTER (WHERE i.status = 'Under Review')::int AS "underReview",
            count(*) FILTER (WHERE i.status = 'Accepted')::int AS accepted,
            count(*) FILTER (WHERE i.status = 'Converted')::int AS converted,
            count(*) FILTER (WHERE i.status = 'Declined')::int AS declined,
            count(*) FILTER (WHERE i.status = 'Submitted' AND i.submitted_on < current_date - 7)::int AS "overdueReview"
       FROM innovation_ideas i JOIN students s ON s.id = i.student_id ${w.sql}`, w.params);
}

export async function createIdea(req: Request, b: { title: string; problem: string; studentId: string; category: string; wantsMentor?: string }) {
  const studentId = await authorizeStudent(req, b.studentId);
  const r = await one<{ id: string; name: string }>(
    `INSERT INTO innovation_ideas (title, problem, student_id, category, status)
     VALUES ($1,$2,$3,$4,'Submitted') RETURNING id, (SELECT full_name FROM students WHERE id = $3) AS name`,
    [b.title, b.wantsMentor ? `${b.problem}\n\nMentor: ${b.wantsMentor}` : b.problem, studentId, b.category]);
  await audit(req, { action: 'create', module: MODULE, description: `Submitted idea "${b.title}" for ${r!.name}`, entityType: 'innovation_idea', entityId: r!.id });
  return { id: r!.id };
}

// ---------------------------------------------------------------------------
// Student portal (self-service)
// ---------------------------------------------------------------------------
/** The student record behind the signed-in account, or a clear error when unlinked. */
function ownStudentId(user: AuthUser): string {
  if (!user.studentId) throw forbidden('No student record is linked to this account. Please contact the school office.');
  return user.studentId;
}

/**
 * A student submits their own idea. The student is taken from the access token,
 * never from the request body, so one student cannot submit as another.
 */
export async function createOwnIdea(req: Request, b: { title: string; problem: string; category: string; wantsMentor?: string }) {
  return createIdea(req, { ...b, studentId: ownStudentId(req.user!) });
}

/** The signed-in student's own ideas, newest first, with the review outcome. */
export async function listOwnIdeas(user: AuthUser) {
  return many(
    `SELECT i.id, i.title, i.problem, i.category, i.status, i.submitted_on AS "submittedOn",
            e.full_name AS "reviewedBy",
            (current_date - i.submitted_on)::int AS "ageDays",
            p.id AS "projectId", p.code AS "projectCode", p.stage AS "projectStage"
       FROM innovation_ideas i
       LEFT JOIN employees e ON e.id = i.reviewed_by
       LEFT JOIN innovation_projects p ON p.idea_id = i.id
      WHERE i.student_id = $1
      ORDER BY i.submitted_on DESC, i.created_at DESC`, [ownStudentId(user)]);
}

async function loadIdea(user: AuthUser, id: string, db: Queryable) {
  const w = new Where().add('i.id = ?', id);
  studentColumnScope(user, w, 'i.student_id');
  const i = await one<{ id: string; title: string; problem: string | null; status: string; student_id: string; student_name: string }>(
    `SELECT i.id, i.title, i.problem, i.status, i.student_id, s.full_name AS student_name
       FROM innovation_ideas i JOIN students s ON s.id = i.student_id ${w.sql} FOR UPDATE OF i`, w.params, db);
  if (!i) throw notFound('Idea not found');
  return i;
}

const IDEA_FLOW: Record<string, { from: string[]; to: string }> = {
  start: { from: ['Submitted'], to: 'Under Review' },
  accept: { from: ['Submitted', 'Under Review'], to: 'Accepted' },
  decline: { from: ['Submitted', 'Under Review', 'Accepted'], to: 'Declined' },
};

export async function reviewIdea(req: Request, id: string, b: { action: string; note?: string | null }) {
  return tx(async (db) => {
    const i = await loadIdea(req.user!, id, db);
    const step = IDEA_FLOW[b.action];
    if (!step.from.includes(i.status)) throw badRequest(`An idea that is ${i.status} cannot be moved to ${step.to}`, 'INVALID_TRANSITION');
    if (b.action === 'decline' && !b.note) throw badRequest('Give the student a reason', 'REASON_REQUIRED', [{ field: 'note', message: 'Reason required' }]);
    await query('UPDATE innovation_ideas SET status = $2, reviewed_by = COALESCE($3, reviewed_by) WHERE id = $1', [id, step.to, req.user!.employeeId], db);
    await audit(req, {
      action: b.action === 'start' ? 'update' : 'approve', module: MODULE,
      description: `Idea "${i.title}" (${i.student_name}): ${i.status} → ${step.to}`, entityType: 'innovation_idea', entityId: id, metadata: { note: b.note ?? null },
    }, db);
    if (b.action !== 'start') {
      await notifyGuardians(i.student_id, {
        category: 'Information', topic: 'innovation', icon: 'lightbulb',
        title: `${i.student_name}'s idea "${i.title}" was ${step.to.toLowerCase()}`, body: b.note ?? undefined,
      }, db);
    }
    return { status: step.to };
  });
}

async function insertMilestones(projectId: string, list: { title: string; dueOn?: string | null }[] | undefined, db: Queryable) {
  let seq = 0;
  for (const m of list ?? []) {
    seq += 1;
    await query('INSERT INTO innovation_milestones (project_id, sequence, title, due_on) VALUES ($1,$2,$3,$4)', [projectId, seq, m.title, m.dueOn ?? null], db);
  }
}

export async function convertIdea(req: Request, id: string, b: { mentorId: string; title?: string; summary?: string | null; milestones?: { title: string; dueOn?: string | null }[] }) {
  return tx(async (db) => {
    const i = await loadIdea(req.user!, id, db);
    if (i.status !== 'Accepted') throw badRequest('Accept the idea before converting it into a project', 'INVALID_TRANSITION');
    const mentor = await assertMentor(b.mentorId, db);
    const code = await nextCode('innovation_projects', 'code', 'IP-', db, 3);
    const p = await one<{ id: string }>(
      `INSERT INTO innovation_projects (code, title, summary, idea_id, lead_student_id, mentor_id, stage, status, started_on)
       VALUES ($1,$2,$3,$4,$5,$6,2,$7,current_date) RETURNING id`,
      [code, b.title ?? i.title, b.summary ?? i.problem, id, i.student_id, b.mentorId, STAGE_STATUS[2]], db);
    await query(`INSERT INTO innovation_project_members (project_id, student_id, role) VALUES ($1,$2,'Lead')`, [p!.id, i.student_id], db);
    await insertMilestones(p!.id, b.milestones, db);
    await query(`UPDATE innovation_ideas SET status = 'Converted', reviewed_by = COALESCE(reviewed_by, $2) WHERE id = $1`, [id, req.user!.employeeId], db);
    await query(
      `INSERT INTO student_timeline_events (student_id, occurred_on, title, body, category, tone, created_by)
       VALUES ($1, current_date, $2, $3, 'activity', 'teal', $4)`,
      [i.student_id, `Innovation project ${code} started`, `${b.title ?? i.title} — mentor ${mentor.full_name}`, req.user!.id], db);
    await audit(req, { action: 'create', module: MODULE, description: `Converted idea "${i.title}" into project ${code} (mentor ${mentor.full_name})`, entityType: 'innovation_project', entityId: p!.id }, db);
    if (mentor.user_id) {
      await notifyUsers([mentor.user_id], {
        category: 'Attention', topic: 'innovation', icon: 'rocket', title: `You are mentoring ${code}: ${b.title ?? i.title}`,
        body: `Lead student ${i.student_name}`, route: `/projects/${p!.id}`, entityType: 'innovation_project', entityId: p!.id,
      }, db);
    }
    return { id: p!.id, code };
  });
}

// =============================================================================
// Projects
// =============================================================================
const PROJECT_SORTS: Record<string, string> = {
  updated: 'p.updated_at', code: `substring(p.code FROM 4)::int`, title: 'p.title', stage: 'p.stage',
  student: 's.full_name', mentor: 'm.full_name', progress: `ms.done::float / NULLIF(ms.total, 0)`,
};

export async function listProjects(user: AuthUser, f: Pagination & { campusId?: string; stage?: number; mentorId?: string; studentId?: string; active?: boolean }) {
  const w = new Where();
  projectScope(user, w);
  w.addIf(f.campusId, 's.campus_id = ?');
  if (f.stage !== undefined) w.add('p.stage = ?', f.stage);
  w.addIf(f.mentorId, 'p.mentor_id = ?');
  if (f.studentId) w.add('(p.lead_student_id = ? OR EXISTS (SELECT 1 FROM innovation_project_members x WHERE x.project_id = p.id AND x.student_id = ?))', f.studentId, f.studentId);
  if (f.active === true) w.add('p.stage < 6');
  if (f.active === false) w.add('p.stage = 6');
  if (f.q) w.add('(p.title ILIKE ? OR p.code ILIKE ? OR s.full_name ILIKE ?)', likeTerm(f.q), likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT p.id, p.code, p.title, p.summary, p.stage, p.status, p.started_on AS "startedOn", p.updated_at AS "updatedAt",
            p.mentor_id AS "mentorId", m.full_name AS mentor, ${STUDENT_COLS},
            ms.total AS milestones, ms.done, ms.overdue AS "overdueMilestones", ms.next_title AS "nextMilestone", ms.next_due AS "nextDue",
            (SELECT count(*) FROM innovation_project_members pm WHERE pm.project_id = p.id)::int AS members,
            count(*) OVER() AS total
       FROM innovation_projects p ${STUDENT_JOINS('p.lead_student_id')}
       LEFT JOIN employees m ON m.id = p.mentor_id
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS total, count(*) FILTER (WHERE x.completed_on IS NOT NULL)::int AS done,
                count(*) FILTER (WHERE x.completed_on IS NULL AND x.due_on < current_date)::int AS overdue,
                (array_agg(x.title ORDER BY x.sequence) FILTER (WHERE x.completed_on IS NULL))[1] AS next_title,
                (array_agg(x.due_on ORDER BY x.sequence) FILTER (WHERE x.completed_on IS NULL))[1] AS next_due
           FROM innovation_milestones x WHERE x.project_id = p.id) ms ON true
       ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, PROJECT_SORTS, 'updated')}, p.code DESC
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`, w.params);
  return splitTotal(rows);
}

export async function getProject(req: Request, id: string) {
  const user = req.user!;
  await loadProject(user, id);
  const [base, members, milestones, evidence, feedback, competitions, achievements] = await Promise.all([
    one(`SELECT p.id, p.code, p.title, p.summary, p.stage, p.status, p.started_on AS "startedOn", p.created_at AS "createdAt", p.updated_at AS "updatedAt",
                p.mentor_id AS "mentorId", m.full_name AS mentor, m.designation AS "mentorRole",
                p.idea_id AS "ideaId", i.title AS "ideaTitle", i.submitted_on AS "ideaSubmittedOn", ${STUDENT_COLS}
           FROM innovation_projects p ${STUDENT_JOINS('p.lead_student_id')}
           LEFT JOIN employees m ON m.id = p.mentor_id
           LEFT JOIN innovation_ideas i ON i.id = p.idea_id
          WHERE p.id = $1`, [id]),
    many(`SELECT pm.role, ${STUDENT_COLS}
            FROM innovation_project_members pm ${STUDENT_JOINS('pm.student_id')}
           WHERE pm.project_id = $1 ORDER BY (pm.role = 'Lead') DESC, s.full_name`, [id]),
    many(`SELECT x.id, x.sequence, x.title, x.due_on AS "dueOn", x.completed_on AS "completedOn", x.evidence, x.feedback,
                 CASE WHEN x.completed_on IS NOT NULL THEN 'Completed' WHEN x.due_on < current_date THEN 'Overdue'
                      WHEN x.sequence = min(x.sequence) FILTER (WHERE x.completed_on IS NULL) OVER () THEN 'In Progress' ELSE 'Pending' END AS status
            FROM innovation_milestones x WHERE x.project_id = $1 ORDER BY x.sequence`, [id]),
    many(`SELECT ev.id, ev.title, ev.kind, ev.link, ev.note, ev.created_at AS "createdAt", u.full_name AS "addedBy", ms.title AS milestone
            FROM innovation_evidence ev LEFT JOIN users u ON u.id = ev.added_by LEFT JOIN innovation_milestones ms ON ms.id = ev.milestone_id
           WHERE ev.project_id = $1 ORDER BY ev.created_at DESC`, [id]),
    many(`SELECT f.id, f.author_name AS author, e.designation AS "authorRole", f.body, f.created_at AS "createdAt"
            FROM innovation_feedback f LEFT JOIN employees e ON e.id = f.author_id
           WHERE f.project_id = $1 ORDER BY f.created_at DESC`, [id]),
    many(`SELECT co.id, co.name, co.level, co.held_on AS "heldOn", ce.result
            FROM competition_entries ce JOIN competitions co ON co.id = ce.competition_id
           WHERE ce.project_id = $1 ORDER BY co.held_on DESC`, [id]),
    many(`SELECT a.id, a.title, a.achievement_type AS type, a.level, a.achieved_on AS "achievedOn", a.is_verified AS verified
            FROM innovation_project_achievements pa JOIN achievements a ON a.id = pa.achievement_id
           WHERE pa.project_id = $1 ORDER BY a.achieved_on DESC`, [id]),
  ]);
  await audit(req, { action: 'view', module: MODULE, description: `Opened project ${base!.code}`, entityType: 'innovation_project', entityId: id });
  return { ...base, stages: STAGES, members, milestones, evidence, feedback, competitions, achievements };
}

export async function createProject(req: Request, b: {
  title: string; summary?: string | null; leadStudentId: string; mentorId: string; stage: number;
  memberIds?: string[]; milestones?: { title: string; dueOn?: string | null }[];
}) {
  const lead = await authorizeStudent(req, b.leadStudentId);
  const memberIds: string[] = [];
  for (const m of b.memberIds ?? []) {
    const sid = await authorizeStudent(req, m);
    if (sid !== lead && !memberIds.includes(sid)) memberIds.push(sid);
  }
  return tx(async (db) => {
    const mentor = await assertMentor(b.mentorId, db);
    const code = await nextCode('innovation_projects', 'code', 'IP-', db, 3);
    const p = await one<{ id: string }>(
      `INSERT INTO innovation_projects (code, title, summary, lead_student_id, mentor_id, stage, status, started_on)
       VALUES ($1,$2,$3,$4,$5,$6,$7,current_date) RETURNING id`,
      [code, b.title, b.summary ?? null, lead, b.mentorId, b.stage, STAGE_STATUS[b.stage]], db);
    await query(`INSERT INTO innovation_project_members (project_id, student_id, role) VALUES ($1,$2,'Lead')`, [p!.id, lead], db);
    for (const sid of memberIds) await query(`INSERT INTO innovation_project_members (project_id, student_id, role) VALUES ($1,$2,'Member')`, [p!.id, sid], db);
    await insertMilestones(p!.id, b.milestones, db);
    await audit(req, { action: 'create', module: MODULE, description: `Created project ${code} — ${b.title} (mentor ${mentor.full_name})`, entityType: 'innovation_project', entityId: p!.id }, db);
    return { id: p!.id, code };
  });
}

export async function updateProject(req: Request, id: string, b: { title?: string; summary?: string | null; mentorId?: string }) {
  const p = await loadProject(req.user!, id);
  if (b.mentorId) await assertMentor(b.mentorId);
  const { keys } = await updateById('innovation_projects', id, b, { title: 'title', summary: 'summary', mentorId: 'mentor_id' });
  await audit(req, { action: 'update', module: MODULE, description: `Updated project ${p.code}`, entityType: 'innovation_project', entityId: id, metadata: { changed: keys } });
}

/** Moves a project to the next stage. Reaching "Achievement" records a verified achievement for the lead student. */
export async function advanceStage(req: Request, id: string, b: { achievementTitle?: string; level?: string; achievedOn?: string; note?: string | null }) {
  return tx(async (db) => {
    const p = await loadProject(req.user!, id, db, true);
    if (p.stage >= 6) throw badRequest('This project has already reached the Achievement stage', 'ALREADY_COMPLETE');
    const next = p.stage + 1;
    if (next === 2 && !p.mentor_id) throw badRequest('Assign a mentor first', 'MENTOR_REQUIRED');
    let achievementId: string | null = null;
    if (next === 6) {
      if (!b.achievementTitle) throw badRequest('Describe the achievement to record on the Student 360 profile', 'ACHIEVEMENT_REQUIRED', [{ field: 'achievementTitle', message: 'Required to complete the project' }]);
      // School day (Asia/Kolkata), not the UTC date, which lags until 05:30.
      const achievedOn = b.achievedOn ?? schoolToday();
      if (achievedOn > schoolToday()) throw badRequest('Achievement date cannot be in the future', 'FUTURE_DATE', [{ field: 'achievedOn', message: 'Cannot be in the future' }]);
      const a = await one<{ id: string }>(
        `INSERT INTO achievements (student_id, title, achievement_type, level, achieved_on, is_verified, verified_by, verified_at, created_by)
         VALUES ($1,$2,'Innovation',$3,$4,true,$5,now(),$5) RETURNING id`,
        [p.lead_student_id, b.achievementTitle, b.level ?? 'School', achievedOn, req.user!.id], db);
      achievementId = a!.id;
      await query('INSERT INTO innovation_project_achievements (project_id, achievement_id) VALUES ($1,$2)', [id, achievementId], db);
      await query(
        `INSERT INTO student_timeline_events (student_id, occurred_on, title, body, category, tone, created_by)
         VALUES ($1,$2,$3,$4,'achievement','amber',$5)`,
        [p.lead_student_id, achievedOn, b.achievementTitle, `Innovation project ${p.code} — ${p.title}`, req.user!.id], db);
    }
    await query('UPDATE innovation_projects SET stage = $2, status = $3 WHERE id = $1', [id, next, STAGE_STATUS[next]], db);
    await audit(req, {
      action: next === 6 ? 'approve' : 'update', module: MODULE,
      description: `Project ${p.code} moved from ${STAGES[p.stage]} to ${STAGES[next]}${achievementId ? ` — achievement recorded for ${p.lead_name}` : ''}`,
      entityType: 'innovation_project', entityId: id, metadata: { note: b.note ?? null, achievementId },
    }, db);
    if (next === 6) {
      await notifyGuardians(p.lead_student_id, {
        category: 'Completed', topic: 'innovation', icon: 'award', title: `${p.lead_name}: ${b.achievementTitle}`,
        body: `Recorded on the Student 360 profile (project ${p.code}).`,
      }, db);
    }
    return { stage: next, status: STAGE_STATUS[next], achievementId };
  });
}

export async function addMember(req: Request, id: string, b: { studentId: string; role: string }) {
  const p = await loadProject(req.user!, id);
  const sid = await authorizeStudent(req, b.studentId);
  const r = await query(
    `INSERT INTO innovation_project_members (project_id, student_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [id, sid, b.role]);
  if (!r.rowCount) throw conflict('This student is already on the project', 'ALREADY_MEMBER');
  await audit(req, { action: 'update', module: MODULE, description: `Added a member to project ${p.code}`, entityType: 'innovation_project', entityId: id, metadata: { studentId: sid } });
}

export async function removeMember(req: Request, id: string, studentId: string) {
  const p = await loadProject(req.user!, id);
  if (studentId === p.lead_student_id) throw badRequest('The lead student cannot be removed', 'LEAD_REQUIRED');
  const r = await query('DELETE FROM innovation_project_members WHERE project_id = $1 AND student_id = $2', [id, studentId]);
  if (!r.rowCount) throw notFound('Member not found');
  await audit(req, { action: 'update', module: MODULE, description: `Removed a member from project ${p.code}`, entityType: 'innovation_project', entityId: id, metadata: { studentId } });
}

// ---- Evidence & feedback ------------------------------------------------------
export async function addEvidence(req: Request, id: string, b: { title: string; kind: string; link?: string | null; note?: string | null; milestoneId?: string | null }) {
  const p = await loadProject(req.user!, id);
  if (b.milestoneId) {
    const m = await one('SELECT 1 FROM innovation_milestones WHERE id = $1 AND project_id = $2', [b.milestoneId, id]);
    if (!m) throw badRequest('Milestone does not belong to this project', 'MILESTONE_MISMATCH');
  }
  const r = await one<{ id: string }>(
    `INSERT INTO innovation_evidence (project_id, milestone_id, title, kind, link, note, added_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [id, b.milestoneId ?? null, b.title, b.kind, b.link ?? null, b.note ?? null, req.user!.id]);
  await query('UPDATE innovation_projects SET updated_at = now() WHERE id = $1', [id]);
  await audit(req, { action: 'create', module: MODULE, description: `Added evidence "${b.title}" to ${p.code}`, entityType: 'innovation_project', entityId: id });
  return { id: r!.id };
}

export async function removeEvidence(req: Request, evidenceId: string) {
  const ev = await one<{ project_id: string; title: string }>('SELECT project_id, title FROM innovation_evidence WHERE id = $1', [evidenceId]);
  if (!ev) throw notFound('Evidence not found');
  const p = await loadProject(req.user!, ev.project_id);
  await query('DELETE FROM innovation_evidence WHERE id = $1', [evidenceId]);
  await audit(req, { action: 'delete', module: MODULE, description: `Removed evidence "${ev.title}" from ${p.code}`, entityType: 'innovation_project', entityId: p.id });
}

export async function addFeedback(req: Request, id: string, b: { body: string }) {
  const p = await loadProject(req.user!, id);
  const r = await one<{ id: string }>(
    `INSERT INTO innovation_feedback (project_id, author_id, author_name, body, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [id, req.user!.employeeId, req.user!.fullName, b.body, req.user!.id]);
  await query('UPDATE innovation_projects SET updated_at = now() WHERE id = $1', [id]);
  await audit(req, { action: 'create', module: MODULE, description: `Added mentor feedback on ${p.code}`, entityType: 'innovation_project', entityId: id });
  return { id: r!.id };
}

// =============================================================================
// Milestones
// =============================================================================
const MILESTONE_STATUS_SQL = `CASE WHEN x.completed_on IS NOT NULL THEN 'Completed' WHEN x.due_on < current_date THEN 'Overdue'
  WHEN x.sequence = (SELECT min(y.sequence) FROM innovation_milestones y WHERE y.project_id = x.project_id AND y.completed_on IS NULL) THEN 'In Progress'
  ELSE 'Pending' END`;

async function milestoneCounts(user: AuthUser, campusId?: string) {
  const w = new Where();
  projectScope(user, w);
  w.addIf(campusId, 's.campus_id = ?');
  const r = await one(
    `SELECT count(*) FILTER (WHERE x.due_on BETWEEN ay.starts_on AND ay.ends_on OR x.completed_on >= ay.starts_on)::int AS "thisYear",
            count(*) FILTER (WHERE x.completed_on IS NOT NULL AND x.completed_on >= ay.starts_on)::int AS completed,
            count(*) FILTER (WHERE x.completed_on IS NULL AND x.due_on BETWEEN current_date AND current_date + 7)::int AS "dueThisWeek",
            count(*) FILTER (WHERE x.completed_on IS NULL AND x.due_on < current_date)::int AS overdue
       FROM innovation_milestones x
       JOIN innovation_projects p ON p.id = x.project_id
       JOIN students s ON s.id = p.lead_student_id
       JOIN academic_years ay ON ay.is_current
       ${w.sql}`, w.params);
  return r as { thisYear: number; completed: number; dueThisWeek: number; overdue: number };
}

export { milestoneCounts as milestoneSummary };

const MS_SORTS: Record<string, string> = { due: 'x.due_on', title: 'x.title', project: 'p.title', student: 's.full_name', status: MILESTONE_STATUS_SQL };

export async function listMilestones(user: AuthUser, f: Pagination & { campusId?: string; status?: string; projectId?: string }) {
  const w = new Where();
  projectScope(user, w);
  w.addIf(f.campusId, 's.campus_id = ?');
  w.addIf(f.projectId, 'p.id = ?');
  if (f.status === 'due_week') w.add('x.completed_on IS NULL AND x.due_on BETWEEN current_date AND current_date + 7');
  else if (f.status === 'open') w.add('x.completed_on IS NULL');
  else w.addIf(f.status, `${MILESTONE_STATUS_SQL} = ?`);
  if (f.q) w.add('(x.title ILIKE ? OR p.title ILIKE ? OR s.full_name ILIKE ?)', likeTerm(f.q), likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT x.id, x.title, x.sequence, x.due_on AS "dueOn", x.completed_on AS "completedOn", x.evidence, x.feedback,
            ${MILESTONE_STATUS_SQL} AS status, (x.due_on - current_date) AS "daysLeft",
            p.id AS "projectId", p.code AS "projectCode", p.title AS "projectTitle", m.full_name AS mentor, ${STUDENT_COLS},
            count(*) OVER() AS total
       FROM innovation_milestones x
       JOIN innovation_projects p ON p.id = x.project_id
       ${STUDENT_JOINS('p.lead_student_id')}
       LEFT JOIN employees m ON m.id = p.mentor_id
       ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, MS_SORTS, 'due')}, x.sequence
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`, w.params);
  return splitTotal(rows);
}

export async function addMilestone(req: Request, id: string, b: { title: string; dueOn?: string | null }) {
  const p = await loadProject(req.user!, id);
  return tx(async (db) => {
    const seq = await one<{ n: number }>('SELECT COALESCE(max(sequence), 0) + 1 AS n FROM innovation_milestones WHERE project_id = $1', [id], db);
    const r = await one<{ id: string }>(
      'INSERT INTO innovation_milestones (project_id, sequence, title, due_on) VALUES ($1,$2,$3,$4) RETURNING id', [id, seq!.n, b.title, b.dueOn ?? null], db);
    await query('UPDATE innovation_projects SET updated_at = now() WHERE id = $1', [id], db);
    await audit(req, { action: 'create', module: MODULE, description: `Added milestone "${b.title}" to ${p.code}`, entityType: 'innovation_milestone', entityId: r!.id }, db);
    return { id: r!.id };
  });
}

async function loadMilestone(user: AuthUser, milestoneId: string) {
  const m = await one<{ project_id: string; title: string; completed_on: string | null }>(
    'SELECT project_id, title, completed_on FROM innovation_milestones WHERE id = $1', [milestoneId]);
  if (!m) throw notFound('Milestone not found');
  const p = await loadProject(user, m.project_id);
  return { m, p };
}

export async function updateMilestone(req: Request, milestoneId: string, b: {
  title?: string; dueOn?: string | null; completed?: boolean; completedOn?: string; evidence?: string | null; feedback?: string | null;
}) {
  const { m, p } = await loadMilestone(req.user!, milestoneId);
  const today = schoolToday();
  const input: Record<string, unknown> = { title: b.title, dueOn: b.dueOn, evidence: b.evidence, feedback: b.feedback };
  if (b.completed === true) {
    const on = b.completedOn ?? today;
    if (on > today) throw badRequest('Completion date cannot be in the future', 'FUTURE_DATE', [{ field: 'completedOn', message: 'Cannot be in the future' }]);
    input.completedOn = on;
  }
  if (b.completed === false) input.completedOn = null;
  const { keys } = await updateById('innovation_milestones', milestoneId, input, {
    title: 'title', dueOn: 'due_on', completedOn: 'completed_on', evidence: 'evidence', feedback: 'feedback',
  });
  await query('UPDATE innovation_projects SET updated_at = now() WHERE id = $1', [p.id]);
  const verb = b.completed === true && !m.completed_on ? 'Completed' : b.completed === false ? 'Reopened' : 'Updated';
  await audit(req, { action: 'update', module: MODULE, description: `${verb} milestone "${m.title}" on ${p.code}`, entityType: 'innovation_milestone', entityId: milestoneId, metadata: { changed: keys } });
}

export async function deleteMilestone(req: Request, milestoneId: string) {
  const { m, p } = await loadMilestone(req.user!, milestoneId);
  if (m.completed_on) throw badRequest('Completed milestones are kept as evidence and cannot be deleted', 'MILESTONE_COMPLETED');
  await query('DELETE FROM innovation_milestones WHERE id = $1', [milestoneId]);
  await audit(req, { action: 'delete', module: MODULE, description: `Deleted milestone "${m.title}" from ${p.code}`, entityType: 'innovation_milestone', entityId: milestoneId });
}

// =============================================================================
// Mentors
// =============================================================================
export async function listMentors(user: AuthUser, f: { campusId?: string; q?: string; all?: boolean }) {
  const pw = new Where().add('p.mentor_id = e.id');
  projectScope(user, pw);
  // Parameters of the correlated sub-query come first in the text, so they are numbered first.
  const params = [...pw.params];
  const cond: string[] = ['e.deleted_at IS NULL', `e.employment_status = 'active'`];
  if (!f.all) cond.push('(t.is_mentor OR EXISTS (SELECT 1 FROM innovation_projects p0 WHERE p0.mentor_id = e.id))');
  if (f.campusId) { params.push(f.campusId); cond.push(`e.campus_id = $${params.length}`); }
  if (f.q) { params.push(likeTerm(f.q)); cond.push(`(e.full_name ILIKE $${params.length} OR e.designation ILIKE $${params.length})`); }
  return many(
    `SELECT e.id, e.employee_code AS "employeeCode", e.full_name AS name, e.designation, e.department,
            cp.short_name AS "campusName", t.is_mentor AS "isMentor", t.specialisation,
            COALESCE(ld.active, 0)::int AS "activeProjects", COALESCE(ld.completed, 0)::int AS "completedProjects",
            COALESCE(ld.students, 0)::int AS students, COALESCE(ld.projects, '[]') AS projects,
            (SELECT count(*) FROM innovation_feedback fb WHERE fb.author_id = e.id AND fb.created_at > now() - interval '30 days')::int AS "feedback30d"
       FROM employees e
       JOIN teachers t ON t.employee_id = e.id
       JOIN campuses cp ON cp.id = e.campus_id
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE p.stage < 6) AS active, count(*) FILTER (WHERE p.stage = 6) AS completed,
                (SELECT count(DISTINCT z.sid) FROM (
                   SELECT p2.lead_student_id AS sid FROM innovation_projects p2 WHERE p2.mentor_id = e.id AND p2.stage < 6
                   UNION SELECT pm.student_id FROM innovation_project_members pm JOIN innovation_projects p3 ON p3.id = pm.project_id
                    WHERE p3.mentor_id = e.id AND p3.stage < 6) z) AS students,
                json_agg(json_build_object('id', p.id, 'code', p.code, 'title', p.title, 'stage', p.stage) ORDER BY p.stage DESC)
                  FILTER (WHERE p.stage < 6) AS projects
           FROM innovation_projects p ${pw.sql}) ld ON true
      WHERE ${cond.join(' AND ')}
      ORDER BY COALESCE(ld.active, 0) DESC, e.full_name`, params);
}

export async function setMentor(req: Request, employeeId: string, isMentor: boolean) {
  const r = await one<{ full_name: string }>(
    `UPDATE teachers t SET is_mentor = $2 FROM employees e WHERE t.employee_id = $1 AND e.id = t.employee_id AND e.deleted_at IS NULL RETURNING e.full_name`,
    [employeeId, isMentor]);
  if (!r) throw notFound('Teacher not found');
  await audit(req, { action: 'update', module: MODULE, description: `${isMentor ? 'Added' : 'Removed'} ${r.full_name} ${isMentor ? 'to' : 'from'} the mentor panel`, entityType: 'employee', entityId: employeeId });
}

// =============================================================================
// Competitions
// =============================================================================
export async function listCompetitions(user: AuthUser, f: Pagination & { when?: 'upcoming' | 'past' }) {
  const w = new Where();
  if (f.when === 'upcoming') w.add('co.held_on >= current_date');
  if (f.when === 'past') w.add('co.held_on < current_date');
  if (f.q) w.add('co.name ILIKE ?', likeTerm(f.q));
  const ew = new Where().add('ce.competition_id = co.id');
  projectScope(user, ew);
  // entries sub-query params are appended after the outer filter params
  const entryWhere = ew.sql.replace(/\$(\d+)/g, (_m, n) => `$${Number(n) + w.params.length}`);
  const params = [...w.params, ...ew.params];
  const { limit, offset } = limitOffset(f);
  params.push(limit, offset);
  const rows = await many(
    `SELECT co.id, co.name, co.level, co.held_on AS "heldOn", co.result, (co.held_on - current_date) AS "daysAway",
            (SELECT count(*) FROM competition_entries x WHERE x.competition_id = co.id)::int AS teams,
            COALESCE((SELECT json_agg(json_build_object('projectId', p.id, 'code', p.code, 'title', p.title, 'result', ce.result,
                        'studentId', s.id, 'studentName', s.full_name) ORDER BY p.code)
                        FROM competition_entries ce JOIN innovation_projects p ON p.id = ce.project_id
                        JOIN students s ON s.id = p.lead_student_id ${entryWhere}), '[]') AS entries,
            count(*) OVER() AS total
       FROM competitions co ${w.sql}
      ORDER BY (co.held_on >= current_date) DESC, abs(co.held_on - current_date)
      LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return splitTotal(rows);
}

const COMP_COLS: Record<string, string> = { name: 'name', level: 'level', heldOn: 'held_on', result: 'result' };

export async function createCompetition(req: Request, b: { name: string; level: string; heldOn: string; result?: string | null }) {
  const r = await one<{ id: string }>('INSERT INTO competitions (name, level, held_on, result) VALUES ($1,$2,$3,$4) RETURNING id',
    [b.name, b.level, b.heldOn, b.result ?? 'Registered']);
  await audit(req, { action: 'create', module: MODULE, description: `Registered for competition ${b.name} (${b.heldOn})`, entityType: 'competition', entityId: r!.id });
  return { id: r!.id };
}

export async function updateCompetition(req: Request, id: string, b: Record<string, unknown>) {
  const { row, keys } = await updateById<{ name: string }>('competitions', id, b, COMP_COLS, { returning: 'name' });
  if (!row) throw notFound('Competition not found');
  await audit(req, { action: 'update', module: MODULE, description: `Updated competition ${row.name}`, entityType: 'competition', entityId: id, metadata: { changed: keys } });
}

export async function addEntry(req: Request, competitionId: string, b: { projectId: string; result?: string | null }) {
  return tx(async (db) => {
    const co = await one<{ name: string }>('SELECT name FROM competitions WHERE id = $1', [competitionId], db);
    if (!co) throw notFound('Competition not found');
    const p = await loadProject(req.user!, b.projectId, db, true);
    if (p.stage < 3) throw badRequest('Only projects at the Project stage or beyond can be entered', 'STAGE_TOO_EARLY');
    const r = await query('INSERT INTO competition_entries (competition_id, project_id, result) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [competitionId, b.projectId, b.result ?? 'Registered'], db);
    if (!r.rowCount) throw conflict('This project is already entered', 'ALREADY_ENTERED');
    if (p.stage < 5) await query('UPDATE innovation_projects SET stage = 5, status = $2 WHERE id = $1', [p.id, STAGE_STATUS[5]], db);
    await audit(req, { action: 'create', module: MODULE, description: `Entered ${p.code} in ${co.name}${p.stage < 5 ? ' (stage → Competition)' : ''}`, entityType: 'competition', entityId: competitionId }, db);
  });
}

export async function updateEntry(req: Request, competitionId: string, projectId: string, result: string) {
  const p = await loadProject(req.user!, projectId);
  const r = await one<{ name: string }>(
    `UPDATE competition_entries ce SET result = $3 FROM competitions co
      WHERE ce.competition_id = $1 AND ce.project_id = $2 AND co.id = ce.competition_id RETURNING co.name`, [competitionId, projectId, result]);
  if (!r) throw notFound('Entry not found');
  await audit(req, { action: 'update', module: MODULE, description: `Recorded result for ${p.code} at ${r.name}: ${result}`, entityType: 'competition', entityId: competitionId });
}

export async function removeEntry(req: Request, competitionId: string, projectId: string) {
  const p = await loadProject(req.user!, projectId);
  const r = await query('DELETE FROM competition_entries WHERE competition_id = $1 AND project_id = $2', [competitionId, projectId]);
  if (!r.rowCount) throw notFound('Entry not found');
  await audit(req, { action: 'delete', module: MODULE, description: `Withdrew ${p.code} from a competition`, entityType: 'competition', entityId: competitionId });
}

// =============================================================================
// Achievements (verified achievements of Innovation Lab participants)
// =============================================================================
const LAB_STUDENTS = `(SELECT lead_student_id FROM innovation_projects UNION SELECT student_id FROM innovation_project_members)`;

async function achievementCounts(user: AuthUser, campusId?: string) {
  const w = new Where().add(`a.is_verified AND a.student_id IN ${LAB_STUDENTS}`);
  studentColumnScope(user, w, 'a.student_id');
  w.addIf(campusId, 's.campus_id = ?');
  const r = await one(
    `SELECT count(*) FILTER (WHERE a.achieved_on >= ay.starts_on)::int AS "thisYear",
            count(*) FILTER (WHERE a.achieved_on >= ay.starts_on - interval '1 year' AND a.achieved_on < ay.starts_on)::int AS "lastYear",
            count(*) FILTER (WHERE a.achieved_on >= ay.starts_on AND a.achievement_type IN ('Competition', 'Innovation'))::int AS competition,
            count(*) FILTER (WHERE a.achieved_on >= ay.starts_on AND a.achievement_type = 'Academic')::int AS academic,
            count(*) FILTER (WHERE a.achieved_on >= ay.starts_on AND a.achievement_type NOT IN ('Competition', 'Innovation', 'Academic'))::int AS other,
            count(*)::int AS total
       FROM achievements a JOIN students s ON s.id = a.student_id JOIN academic_years ay ON ay.is_current ${w.sql}`, w.params);
  return r as { thisYear: number; lastYear: number; competition: number; academic: number; other: number; total: number };
}

export { achievementCounts as achievementSummary };

export async function listAchievements(user: AuthUser, f: Pagination & { campusId?: string; type?: string }) {
  const w = new Where().add(`a.is_verified AND a.student_id IN ${LAB_STUDENTS}`);
  studentColumnScope(user, w, 'a.student_id');
  w.addIf(f.campusId, 's.campus_id = ?');
  w.addIf(f.type, 'a.achievement_type = ?');
  if (f.q) w.add('(a.title ILIKE ? OR s.full_name ILIKE ?)', likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT a.id, a.title, a.achievement_type AS type, a.level, a.achieved_on AS "achievedOn", a.is_verified AS verified,
            a.verified_at AS "verifiedAt", vu.full_name AS "verifiedBy", ${STUDENT_COLS},
            pr.id AS "projectId", pr.code AS "projectCode", count(*) OVER() AS total
       FROM achievements a ${STUDENT_JOINS('a.student_id')}
       LEFT JOIN users vu ON vu.id = a.verified_by
       LEFT JOIN innovation_project_achievements pa ON pa.achievement_id = a.id
       LEFT JOIN innovation_projects pr ON pr.id = pa.project_id
       ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, { date: 'a.achieved_on', title: 'a.title', student: 's.full_name', type: 'a.achievement_type' }, 'date')}, a.title
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`, w.params);
  return splitTotal(rows);
}

export async function achievementTypes() {
  return (await many<{ t: string }>(`SELECT DISTINCT achievement_type AS t FROM achievements ORDER BY 1`)).map((r) => r.t);
}
