import type { Request } from 'express';
import { many, one, query, tx, type Queryable } from '../config/db.js';
import { Where } from '../utils/sql.js';
import { likeTerm, limitOffset, orderBy, type Pagination } from '../utils/pagination.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { audit } from './audit.service.js';
import { notifyGuardians, notifyRoles } from './notification.service.js';
import { studentScope } from './access.service.js';
import { requireSchoolScope, sectionScope } from './academics.service.js';
import { REPORT_CARD_STAGES, REPORT_CARD_STATUS, draftReportComment } from './academics-shared.js';
import { expectationBands } from './grading.service.js';
import type { AuthUser } from '../types.js';

// =============================================================================
// Report cards
// =============================================================================
export async function listReportCards(user: AuthUser, f: { campusId?: string; term?: string }) {
  const w = new Where().add('b.academic_year_id = (SELECT id FROM academic_years WHERE is_current)');
  w.addIf(f.campusId, 'c.campus_id = ?');
  w.addIf(f.term, 'b.term = ?');
  sectionScope(user, w, 'b.section_id');
  const rows = await many(
    `SELECT b.id, b.section_id AS "sectionId", c.name || sec.name AS grade, c.grade_level AS "gradeLevel", b.term, b.stage,
            b.due_on AS due, b.released_at AS "releasedAt", u.full_name AS "approvedBy",
            (SELECT count(*)::int FROM students s WHERE s.section_id = b.section_id AND s.deleted_at IS NULL AND s.status = 'active') AS students,
            (SELECT count(*)::int FROM report_card_comments rc WHERE rc.batch_id = b.id AND rc.status = 'Draft') AS drafts,
            (SELECT count(*)::int FROM report_card_comments rc WHERE rc.batch_id = b.id AND rc.status = 'Approved') AS approved,
            (SELECT count(*)::int FROM report_card_comments rc WHERE rc.batch_id = b.id AND rc.status = 'Rejected') AS rejected
       FROM report_card_batches b
       JOIN sections sec ON sec.id = b.section_id JOIN classes c ON c.id = sec.class_id
       LEFT JOIN users u ON u.id = b.approved_by
       ${w.sql}
      ORDER BY b.stage, b.due_on, c.grade_level, sec.name`,
    w.params,
  );
  const stageCounts = REPORT_CARD_STAGES.map((label, i) => ({ label, count: rows.filter((r) => r.stage === i).length }));
  return {
    stages: REPORT_CARD_STAGES,
    stageCounts,
    rows: rows.map((r) => ({ ...r, status: REPORT_CARD_STATUS[r.stage] })),
    awaitingRelease: rows.filter((r) => r.stage === 4).length,
    terms: [...new Set(rows.map((r) => r.term))],
  };
}

async function loadBatch(user: AuthUser, id: string, db?: Queryable, lock = false) {
  const w = new Where().add('b.id = ?', id);
  sectionScope(user, w, 'b.section_id');
  const b = await one(
    `SELECT b.*, c.name || sec.name AS label, c.campus_id
       FROM report_card_batches b JOIN sections sec ON sec.id = b.section_id JOIN classes c ON c.id = sec.class_id
       ${w.sql} ${lock ? 'FOR UPDATE OF b' : ''}`,
    w.params, db,
  );
  if (!b) throw notFound('Report card batch not found', 'BATCH_NOT_FOUND');
  return b;
}

async function studentResults(studentId: string, yearId: string, db?: Queryable) {
  return many<{ subject: string; score: number; grade: string | null; target: number | null; trend: number; teacher: string | null }>(
    `SELECT sub.name AS subject, round(r.score)::int AS score, r.grade, round(r.target_score)::int AS target,
            round(r.score - COALESCE(p.score, r.score))::int AS trend, e.full_name AS teacher
       FROM student_academic_records r
       JOIN subjects sub ON sub.id = r.subject_id
       LEFT JOIN employees e ON e.id = r.teacher_id
       LEFT JOIN student_academic_records p ON p.student_id = r.student_id AND p.subject_id = r.subject_id
            AND p.academic_year_id = r.academic_year_id AND p.term_order = r.term_order - 1
      WHERE r.student_id = $1 AND r.academic_year_id = $2
        AND r.term_order = (SELECT max(term_order) FROM student_academic_records WHERE student_id = $1 AND academic_year_id = $2)
      ORDER BY sub.name`,
    [studentId, yearId], db,
  );
}

async function draftFor(studentId: string, yearId: string, db?: Queryable) {
  const s = await one<{ first_name: string; pct: number | null }>(
    `SELECT s.first_name,
            (SELECT round(100.0 * count(*) FILTER (WHERE a.status IN ('present', 'late')) / NULLIF(count(*), 0))::int
               FROM attendance_records a JOIN academic_years ay ON ay.id = $2 AND a.attendance_date BETWEEN ay.starts_on AND ay.ends_on
              WHERE a.student_id = s.id) AS pct
       FROM students s WHERE s.id = $1`,
    [studentId, yearId], db,
  );
  const results = await studentResults(studentId, yearId, db);
  return draftReportComment(s?.first_name ?? 'The student', results, { attendance: s?.pct });
}

export async function getBatch(user: AuthUser, id: string, studentId?: string) {
  const b = await loadBatch(user, id);
  const students = await many(
    `SELECT s.id, s.admission_no AS "admissionNo", s.full_name AS "fullName", en.roll_no AS roll,
            rc.id AS "commentId", rc.status AS "commentStatus", rc.ai_drafted AS "aiDrafted"
       FROM students s
       LEFT JOIN enrollments en ON en.student_id = s.id AND en.academic_year_id = $2
       LEFT JOIN report_card_comments rc ON rc.batch_id = $1 AND rc.student_id = s.id
      WHERE s.section_id = $3 AND s.deleted_at IS NULL AND s.status = 'active'
      ORDER BY (rc.status = 'Draft') DESC NULLS LAST, en.roll_no NULLS LAST, s.full_name`,
    [id, b.academic_year_id, b.section_id],
  );
  const selectedId = studentId && students.some((s) => s.id === studentId) ? studentId : students[0]?.id;
  if (studentId && selectedId !== studentId) throw notFound('Student not found in this class', 'STUDENT_NOT_FOUND');
  let selected = null;
  if (selectedId) {
    const st = students.find((s) => s.id === selectedId)!;
    const [results, comment] = await Promise.all([
      studentResults(selectedId, b.academic_year_id),
      one(
        `SELECT rc.id, rc.comment, rc.ai_drafted AS "aiDrafted", rc.status, u.full_name AS "reviewedBy", rc.updated_at AS "updatedAt"
           FROM report_card_comments rc LEFT JOIN users u ON u.id = rc.reviewed_by WHERE rc.batch_id = $1 AND rc.student_id = $2`,
        [id, selectedId],
      ),
    ]);
    const sources = await one<{ assessments: number; observations: number; behaviour: number }>(
      `SELECT (SELECT count(*)::int FROM assessment_marks m WHERE m.student_id = $1) AS assessments,
              (SELECT count(*)::int FROM teacher_observations o WHERE o.student_id = $1) AS observations,
              (SELECT count(*)::int FROM behaviour_records br WHERE br.student_id = $1) AS behaviour`,
      [selectedId],
    );
    selected = { student: st, results, comment, sources };
  }
  return {
    id: b.id, label: b.label, term: b.term, stage: b.stage, status: REPORT_CARD_STATUS[b.stage], stages: REPORT_CARD_STAGES,
    due: b.due_on, releasedAt: b.released_at, locked: b.stage >= 5,
    students,
    counts: {
      total: students.length,
      drafts: students.filter((s) => s.commentStatus === 'Draft').length,
      approved: students.filter((s) => s.commentStatus === 'Approved').length,
      rejected: students.filter((s) => s.commentStatus === 'Rejected').length,
      missing: students.filter((s) => !s.commentStatus).length,
    },
    selected,
  };
}

async function releaseBatch(req: Request, b: { id: string; label: string; section_id: string; term: string }, db: Queryable) {
  await query(`UPDATE report_card_batches SET stage = 5, approved_by = $2, released_at = now() WHERE id = $1`, [b.id, req.user!.id], db);
  const students = await many<{ id: string; first_name: string }>(
    `SELECT s.id, s.first_name FROM students s WHERE s.section_id = $1 AND s.deleted_at IS NULL AND s.status = 'active'`, [b.section_id], db,
  );
  let notified = 0;
  for (const s of students) {
    notified += (await notifyGuardians(s.id, {
      category: 'Information', topic: 'report_cards', icon: 'fileText', channels: ['push', 'email'],
      title: `${s.first_name}'s ${b.term} report card is ready`, body: `${b.label} — open Parent 360 to read it.`,
      route: '/parent-360?tab=academics', entityType: 'report_card_batch', entityId: b.id,
    }, db)).length;
  }
  return notified;
}

export async function advanceBatch(req: Request, id: string, toStage: number) {
  const user = req.user!;
  return tx(async (db) => {
    const b = await loadBatch(user, id, db, true);
    if (toStage !== b.stage + 1) throw conflict(`This class is at "${REPORT_CARD_STAGES[b.stage]}" — it can only move to the next stage`, 'INVALID_TRANSITION');
    const roster = await one<{ n: number }>(`SELECT count(*)::int AS n FROM students WHERE section_id = $1 AND deleted_at IS NULL AND status = 'active'`, [b.section_id], db);
    // Only comments of students currently in the class count against the roster;
    // a comment left behind by a student who moved away must not stand in for a missing one.
    const c = await one<{ total: number; approved: number }>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE rc.status = 'Approved')::int AS approved
         FROM report_card_comments rc JOIN students s ON s.id = rc.student_id
        WHERE rc.batch_id = $1 AND s.section_id = $2 AND s.deleted_at IS NULL AND s.status = 'active'`, [id, b.section_id], db,
    );
    let drafted = 0;
    let notified = 0;
    if (toStage === 2) {
      // AI draft comments for every student without one (advisory; reviewed at the next stage).
      const missing = await many<{ id: string }>(
        `SELECT s.id FROM students s WHERE s.section_id = $1 AND s.deleted_at IS NULL AND s.status = 'active'
            AND NOT EXISTS (SELECT 1 FROM report_card_comments rc WHERE rc.batch_id = $2 AND rc.student_id = s.id)`,
        [b.section_id, id], db,
      );
      for (const s of missing) {
        await query(`INSERT INTO report_card_comments (batch_id, student_id, comment, ai_drafted, status) VALUES ($1,$2,$3,true,'Draft')`,
          [id, s.id, await draftFor(s.id, b.academic_year_id, db)], db);
        drafted++;
      }
    }
    if (toStage === 3 && (c?.total ?? 0) < (roster?.n ?? 0)) {
      throw badRequest('Every student needs a draft comment before teacher review', 'COMMENTS_MISSING');
    }
    if (toStage === 4) {
      if ((c?.approved ?? 0) < (roster?.n ?? 0)) {
        throw badRequest(`${(roster?.n ?? 0) - (c?.approved ?? 0)} comment(s) still need teacher approval`, 'COMMENTS_PENDING');
      }
      notified = (await notifyRoles(['principal', 'super_admin'], {
        category: 'Attention', topic: 'report_cards', icon: 'fileText',
        title: `${b.label} report cards await approval`, body: `${b.term} · ${roster?.n ?? 0} students`, route: '/report-cards',
        entityType: 'report_card_batch', entityId: id,
      }, db)).length;
    }
    if (toStage === 5) {
      requireSchoolScope(user, 'Approving report cards for release');
      notified = await releaseBatch(req, b, db);
    } else {
      await query('UPDATE report_card_batches SET stage = $2 WHERE id = $1', [id, toStage], db);
    }
    await audit(req, {
      action: toStage === 5 ? 'approve' : 'update', module: 'academics',
      description: `Report cards ${b.label} (${b.term}): ${REPORT_CARD_STAGES[b.stage]} → ${REPORT_CARD_STAGES[toStage]}`,
      entityType: 'report_card_batch', entityId: id, metadata: { drafted, notified },
    }, db);
    return { id, stage: toStage, status: REPORT_CARD_STATUS[toStage], drafted, notified };
  });
}

/** Drafts comments for students who joined the class after drafting (stages 2–3). */
export async function draftMissingComments(req: Request, id: string) {
  return tx(async (db) => {
    const b = await loadBatch(req.user!, id, db, true);
    if (b.stage < 2 || b.stage > 3) throw conflict('Comments can be drafted during the "AI draft comments" and "Teacher review" stages', 'INVALID_TRANSITION');
    const missing = await many<{ id: string }>(
      `SELECT s.id FROM students s WHERE s.section_id = $1 AND s.deleted_at IS NULL AND s.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM report_card_comments rc WHERE rc.batch_id = $2 AND rc.student_id = s.id)`,
      [b.section_id, id], db,
    );
    for (const s of missing) {
      await query(`INSERT INTO report_card_comments (batch_id, student_id, comment, ai_drafted, status) VALUES ($1,$2,$3,true,'Draft')`,
        [id, s.id, await draftFor(s.id, b.academic_year_id, db)], db);
    }
    await audit(req, { action: 'create', module: 'academics', description: `Drafted ${missing.length} missing report comment(s) for ${b.label}`, entityType: 'report_card_batch', entityId: id }, db);
    return { id, drafted: missing.length };
  });
}

export async function releaseApproved(req: Request, campusId?: string) {
  requireSchoolScope(req.user!, 'Releasing report cards');
  return tx(async (db) => {
    const batches = await many<{ id: string; label: string; section_id: string; term: string }>(
      `SELECT b.id, c.name || sec.name AS label, b.section_id, b.term
         FROM report_card_batches b JOIN sections sec ON sec.id = b.section_id JOIN classes c ON c.id = sec.class_id
        WHERE b.stage = 4 AND b.academic_year_id = (SELECT id FROM academic_years WHERE is_current) AND ($1::uuid IS NULL OR c.campus_id = $1)
        FOR UPDATE OF b`,
      [campusId ?? null], db,
    );
    let notified = 0;
    for (const b of batches) notified += await releaseBatch(req, b, db);
    await audit(req, {
      action: 'approve', module: 'academics',
      description: batches.length ? `Released report cards to parents: ${batches.map((b) => b.label).join(', ')}` : 'Release requested — no report cards were awaiting release',
      entityType: 'report_card_batch', metadata: { batches: batches.map((b) => b.id), notified },
    }, db);
    return { released: batches.length, classes: batches.map((b) => b.label), notified };
  });
}

export async function reviewComment(req: Request, commentId: string, input: { action: 'approve' | 'reject' | 'regenerate'; comment?: string }) {
  const user = req.user!;
  return tx(async (db) => {
    const rc = await one<{ id: string; batch_id: string; student_id: string; comment: string; status: string }>(
      'SELECT id, batch_id, student_id, comment, status FROM report_card_comments WHERE id = $1 FOR UPDATE', [commentId], db,
    );
    if (!rc) throw notFound('Comment not found');
    const b = await loadBatch(user, rc.batch_id, db);
    if (b.stage >= 4) throw conflict('Comments are locked once the class is sent for approval', 'BATCH_LOCKED');
    if (b.stage < 2) throw conflict('Comments are drafted at the "AI draft comments" stage', 'INVALID_TRANSITION');
    const st = await one<{ full_name: string }>('SELECT full_name FROM students WHERE id = $1', [rc.student_id], db);
    let text = rc.comment;
    let status = rc.status;
    let aiDrafted: boolean | null = null;
    if (input.action === 'regenerate') {
      text = await draftFor(rc.student_id, b.academic_year_id, db);
      status = 'Draft';
      aiDrafted = true;
    } else if (input.action === 'approve') {
      if (input.comment && input.comment !== rc.comment) {
        text = input.comment;
        aiDrafted = false;
      }
      status = 'Approved';
    } else {
      status = 'Rejected';
    }
    await query(
      `UPDATE report_card_comments SET comment = $2, status = $3, ai_drafted = COALESCE($4, ai_drafted),
              reviewed_by = CASE WHEN $3 = 'Draft' THEN NULL ELSE $5::uuid END
        WHERE id = $1`,
      [commentId, text, status, aiDrafted, user.id], db,
    );
    await audit(req, {
      action: input.action === 'approve' ? 'approve' : 'update', module: 'academics',
      description: `Report comment for ${st?.full_name} (${b.label}): ${input.action === 'regenerate' ? 'new AI draft generated' : `${status.toLowerCase()} by ${user.fullName}`}${aiDrafted === false ? ' (edited)' : ''}`,
      entityType: 'report_card_comment', entityId: commentId,
    }, db);
    return { id: commentId, status, comment: text };
  });
}

// =============================================================================
// Academic performance (from student_academic_records)
// =============================================================================
async function termOrders(yearCond = '(SELECT id FROM academic_years WHERE is_current)') {
  const t = await many<{ term: string; term_order: number }>(
    `SELECT DISTINCT term, term_order FROM student_academic_records WHERE academic_year_id = ${yearCond} ORDER BY term_order`,
  );
  const cur = t[t.length - 1];
  const prev = t[t.length - 2];
  return { terms: t, cur: cur?.term_order ?? 0, prev: prev?.term_order ?? 0, curLabel: cur?.term ?? null, prevLabel: prev?.term ?? null };
}

/**
 * Expectation bands on the term average, aligned to the Cambridge IGCSE scale
 * (services/grading.service.ts): above expectation = grade B or better,
 * at expectation = grade C, below expectation = under C. With the default
 * boundaries that is 70+, 60–69 and under 60.
 */
function band(avg: number, e: { above: number; at: number }) {
  return avg >= e.above ? 'above' : avg >= e.at ? 'at' : 'below';
}

export async function performanceOverview(user: AuthUser, f: { campusId?: string; grade?: number }) {
  const { terms, cur, prev, curLabel, prevLabel } = await termOrders();
  const EXPECTATION = await expectationBands();
  const w = new Where().add(`s.deleted_at IS NULL AND s.status = 'active'`);
  w.addIf(f.campusId, 's.campus_id = ?');
  w.addIf(f.grade, 'cl.grade_level = ?');
  studentScope(user, w);
  const c = w.param(cur);
  const p = w.param(prev);
  const rows = await many<{ student_id: string; grade: string; grade_level: number; subject: string; term_order: number; score: number; target: number | null }>(
    `SELECT r.student_id, cl.name AS grade, cl.grade_level, sub.name AS subject, r.term_order, r.score::float AS score, r.target_score::float AS target
       FROM student_academic_records r
       JOIN students s ON s.id = r.student_id
       JOIN sections sec ON sec.id = s.section_id JOIN classes cl ON cl.id = sec.class_id
       JOIN subjects sub ON sub.id = r.subject_id
       ${w.sql} AND r.academic_year_id = (SELECT id FROM academic_years WHERE is_current) AND r.term_order IN (${c}::int, ${p}::int)`,
    w.params,
  );
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null);
  const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
  const curRows = rows.filter((r) => r.term_order === cur);
  const prevRows = rows.filter((r) => r.term_order === prev);

  const bands = (rs: typeof rows) => {
    const by = new Map<string, { s: number[]; t: number[] }>();
    for (const r of rs) {
      const e = by.get(r.student_id) ?? { s: [], t: [] };
      e.s.push(r.score);
      if (r.target != null) e.t.push(r.target);
      by.set(r.student_id, e);
    }
    const out = { above: 0, at: 0, below: 0, total: by.size };
    for (const e of by.values()) out[band(avg(e.s)!, EXPECTATION) as 'above' | 'at' | 'below']++;
    return out;
  };
  const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);
  const bc = bands(curRows);
  const bp = bands(prevRows);

  const subjects = [...new Set(curRows.map((r) => r.subject))].sort();
  const subjectAverages = subjects.map((s) => ({
    subject: s,
    current: Math.round(avg(curRows.filter((r) => r.subject === s).map((r) => r.score)) ?? 0),
    previous: Math.round(avg(prevRows.filter((r) => r.subject === s).map((r) => r.score)) ?? 0),
  }));

  const groups = new Map<string, { grade: string; level: number; subject: string; c: number[]; p: number[]; students: Set<string> }>();
  for (const r of rows) {
    const k = `${r.grade}|${r.subject}`;
    const g = groups.get(k) ?? { grade: r.grade, level: r.grade_level, subject: r.subject, c: [], p: [], students: new Set() };
    (r.term_order === cur ? g.c : g.p).push(r.score);
    g.students.add(r.student_id);
    groups.set(k, g);
  }
  const movers = [...groups.values()]
    .filter((g) => g.c.length && g.p.length)
    .map((g) => {
      const now = avg(g.c)!;
      const before = avg(g.p)!;
      return { title: `${g.grade} ${g.subject}`, grade: g.grade, gradeLevel: g.level, subject: g.subject, delta: round1(now - before)!, current: round1(now), previous: round1(before), students: g.students.size };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 4);

  const schoolAvg = round1(avg(curRows.map((r) => r.score)));
  const prevAvg = round1(avg(prevRows.map((r) => r.score)));
  return {
    terms: terms.map((t) => t.term),
    currentTerm: curLabel,
    previousTerm: prevLabel,
    kpis: {
      average: schoolAvg,
      averageDelta: schoolAvg != null && prevAvg != null ? round1(schoolAvg - prevAvg) : null,
      students: bc.total,
      abovePct: pct(bc.above, bc.total),
      aboveDelta: pct(bc.above, bc.total) - pct(bp.above, bp.total),
      atPct: pct(bc.at, bc.total),
      atDelta: pct(bc.at, bc.total) - pct(bp.at, bp.total),
      belowPct: pct(bc.below, bc.total),
      belowDelta: pct(bc.below, bc.total) - pct(bp.below, bp.total),
    },
    expectation: EXPECTATION,
    subjectAverages,
    movers,
  };
}

const PERF_SORTS: Record<string, string> = {
  name: 'x."fullName"', average: 'x.average', trend: 'x.trend', target: 'x.target', gap: '(x.average - x.target)', grade: 'x."gradeLevel", x.section',
};

export async function performanceStudents(user: AuthUser, f: Pagination & { campusId?: string; grade?: number; band?: string; subjectId?: string }) {
  const { cur, prev } = await termOrders();
  const EXPECTATION = await expectationBands();
  const w = new Where().add(`s.deleted_at IS NULL AND s.status = 'active'`);
  w.addIf(f.campusId, 's.campus_id = ?');
  w.addIf(f.grade, 'cl.grade_level = ?');
  if (f.q) w.add('(s.full_name ILIKE ? OR s.admission_no ILIKE ?)', likeTerm(f.q), likeTerm(f.q));
  studentScope(user, w);
  const c = w.param(cur);
  const p = w.param(prev);
  const sub = w.param(f.subjectId ?? null);
  const bandPh = w.param(f.band ?? null);
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `WITH x AS (
       SELECT s.id, s.admission_no AS "admissionNo", s.full_name AS "fullName", cl.name AS grade, cl.grade_level AS "gradeLevel", sec.name AS section,
              s.risk_level AS risk,
              round(avg(r.score) FILTER (WHERE r.term_order = ${c}::int), 1)::float AS average,
              round(avg(r.target_score) FILTER (WHERE r.term_order = ${c}::int), 1)::float AS target,
              round(avg(r.score) FILTER (WHERE r.term_order = ${c}::int) - avg(r.score) FILTER (WHERE r.term_order = ${p}::int), 1)::float AS trend,
              (array_agg(sb.name ORDER BY r.score) FILTER (WHERE r.term_order = ${c}::int))[1] AS weakest,
              (array_agg(sb.name ORDER BY r.score DESC) FILTER (WHERE r.term_order = ${c}::int))[1] AS strongest
         FROM students s
         JOIN sections sec ON sec.id = s.section_id JOIN classes cl ON cl.id = sec.class_id
         JOIN student_academic_records r ON r.student_id = s.id AND r.academic_year_id = (SELECT id FROM academic_years WHERE is_current)
              AND (${sub}::uuid IS NULL OR r.subject_id = ${sub}::uuid)
         JOIN subjects sb ON sb.id = r.subject_id
         ${w.sql}
        GROUP BY s.id, cl.name, cl.grade_level, sec.name),
     y AS (
       SELECT x.*, CASE WHEN x.average >= ${w.param(EXPECTATION.above)}::numeric THEN 'above' WHEN x.average >= ${w.param(EXPECTATION.at)}::numeric THEN 'at' ELSE 'below' END AS band
         FROM x WHERE x.average IS NOT NULL)
     SELECT x.*, count(*) OVER() AS total FROM y x
      WHERE (${bandPh}::text IS NULL OR x.band = ${bandPh}::text)
      ORDER BY ${orderBy(f.sort, f.dir, PERF_SORTS, 'average')}, x."fullName"
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}
