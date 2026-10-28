import type { Request } from 'express';
import { many, one, query, tx, type Queryable } from '../config/db.js';
import { Where } from '../utils/sql.js';
import { likeTerm, limitOffset, orderBy } from '../utils/pagination.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { nextCode } from '../utils/codes.js';
import type { AuthUser } from '../types.js';
import { audit } from './audit.service.js';
import { canAccessStudent, studentScope } from './access.service.js';
import { notifyUsers } from './notification.service.js';
import { STUDENT_ROW_SQL, getStudentRow } from './students.service.js';
import { INTERVENTION_SQL, RISK_ORDER, STAGES, earlyWarningThresholds, riskRank, schoolToday } from './intelligence-common.service.js';

/**
 * Early Warning: Signal → Teacher Review → Intervention → Action → Follow-up → Closed.
 * A signal only becomes an intervention after a named person accepts it.
 * Every query is restricted to the students the user may see.
 */

const TERM_START_SQL = `GREATEST((SELECT starts_on FROM academic_years WHERE is_current), (date_trunc('month', now()) - interval '2 months')::date)`;

export async function summary(user: AuthUser, campusId?: string) {
  const w = new Where().add("s.deleted_at IS NULL AND s.status = 'active'");
  studentScope(user, w);
  w.addIf(campusId, 's.campus_id = ?');
  const [bands, stages, thresholds] = await Promise.all([
    one(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE s.risk_level = 'At Risk')::int AS "atRisk",
              count(*) FILTER (WHERE s.risk_level = 'Developing Risk')::int AS developing,
              count(*) FILTER (WHERE s.risk_level = 'Watch')::int AS watch,
              count(*) FILTER (WHERE s.risk_level = 'On Track')::int AS "onTrack"
         FROM students s ${w.sql}`, w.params),
    one(
      `SELECT count(*) FILTER (WHERE e.closed_at IS NULL AND e.review_decision IS NULL AND e.stage = 0)::int AS s0,
              count(*) FILTER (WHERE e.closed_at IS NULL AND e.review_decision IS NULL AND e.stage = 1)::int AS s1,
              count(*) FILTER (WHERE e.closed_at IS NULL AND e.review_decision = 'accepted' AND e.stage = 2)::int AS s2,
              count(*) FILTER (WHERE e.closed_at IS NULL AND e.review_decision = 'accepted' AND e.stage = 3)::int AS s3,
              count(*) FILTER (WHERE e.closed_at IS NULL AND e.review_decision = 'accepted' AND e.stage = 4)::int AS s4,
              count(*) FILTER (WHERE e.stage = 5 AND e.closed_at >= ${TERM_START_SQL})::int AS "closedThisTerm",
              count(*) FILTER (WHERE e.reviewed_at >= ${TERM_START_SQL})::int AS reviewed,
              count(*) FILTER (WHERE e.review_decision = 'dismissed' AND e.reviewed_at >= ${TERM_START_SQL})::int AS dismissed,
              count(*) FILTER (WHERE e.closed_at IS NULL AND e.review_decision = 'accepted')::int AS "openInterventions",
              count(*) FILTER (WHERE e.closed_at IS NULL AND e.review_decision IS NULL)::int AS "awaitingReview",
              count(*) FILTER (WHERE e.closed_at IS NULL AND e.review_decision = 'accepted' AND e.next_review_on < current_date)::int AS "overdueReviews",
              ${TERM_START_SQL} AS "termStart"
         FROM early_warning_signals e JOIN students s ON s.id = e.student_id ${w.sql}`, w.params),
    earlyWarningThresholds(),
  ]);
  const counts = [stages.s0, stages.s1, stages.s2, stages.s3, stages.s4, stages.closedThisTerm];
  return {
    bands,
    stages: STAGES.map((label, i) => ({ stage: i, label, count: counts[i] })),
    closedThisTerm: stages.closedThisTerm,
    reviewed: stages.reviewed,
    dismissed: stages.dismissed,
    openInterventions: stages.openInterventions,
    awaitingReview: stages.awaitingReview,
    overdueReviews: stages.overdueReviews,
    termStart: stages.termStart,
    thresholds,
  };
}

const STUDENT_SORTS: Record<string, string> = {
  name: 'q."fullName"',
  grade: 'q."gradeLevel", q.section',
  attendance: 'q.attendance',
  trend: 'q.trend',
  average: 'q.average',
  risk: `array_position(ARRAY['At Risk','Developing Risk','Watch','On Track'], q.risk)`,
  intervention: 'q.intervention',
  owner: 'q.owner',
};

export interface EwStudentFilters {
  page: number; pageSize: number; q?: string; sort?: string; dir: 'asc' | 'desc';
  campusId?: string; grade?: string; risk?: string; intervention?: string; includeOnTrack?: boolean;
}

/** Students in the Early Warning working view (On Track students are hidden unless asked for). */
export async function listStudents(user: AuthUser, f: EwStudentFilters) {
  const w = new Where().add("s.deleted_at IS NULL AND s.status = 'active'");
  studentScope(user, w);
  w.addIf(f.campusId, 's.campus_id = ?');
  w.addIf(f.grade, 'c.name = ?');
  if (f.risk) w.add('s.risk_level = ?', f.risk);
  else if (!f.includeOnTrack) w.add("(s.risk_level <> 'On Track' OR EXISTS (SELECT 1 FROM early_warning_signals x WHERE x.student_id = s.id AND x.closed_at IS NULL))");
  if (f.q) w.add('(s.full_name ILIKE ? OR s.admission_no ILIKE ?)', likeTerm(f.q), likeTerm(f.q));

  const outer: string[] = [];
  const params = [...w.params];
  if (f.intervention) {
    params.push(f.intervention);
    outer.push(`q.intervention = $${params.length}`);
  }
  const { limit, offset } = limitOffset(f);
  params.push(limit, offset);
  const rows = await many(
    `SELECT q.*, count(*) OVER() AS total FROM (
       SELECT r.*, ${INTERVENTION_SQL('r."interventionStage"', 'r."signalCode"')} AS intervention,
              (SELECT e.id FROM early_warning_signals e WHERE e.code = r."signalCode") AS "signalId",
              (SELECT e.review_decision FROM early_warning_signals e WHERE e.code = r."signalCode") AS "signalDecision"
         FROM (${STUDENT_ROW_SQL} ${w.sql}) r) q
      ${outer.length ? 'WHERE ' + outer.join(' AND ') : ''}
      ORDER BY ${orderBy(f.sort, f.dir, STUDENT_SORTS, 'attendance')}, q."fullName"
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

const SIGNAL_SELECT = `
  SELECT e.id, e.code, e.signal, e.signal_type AS "signalType", e.stage, e.raised_on AS "raisedOn",
         e.review_decision AS decision, e.action_plan AS "actionPlan", e.next_review_on AS "nextReviewOn",
         e.reviewed_at AS "reviewedAt", e.closed_at AS "closedAt", e.created_at AS "createdAt",
         o.id AS "ownerId", o.full_name AS owner, ru.full_name AS "reviewedBy",
         s.id AS "studentId", s.full_name AS "studentName", s.admission_no AS "admissionNo",
         c.name AS grade, c.grade_level AS "gradeLevel", sec.name AS section, s.risk_level AS risk, s.campus_id AS "campusId"
    FROM early_warning_signals e
    JOIN students s ON s.id = e.student_id
    LEFT JOIN sections sec ON sec.id = s.section_id
    LEFT JOIN classes c ON c.id = sec.class_id
    LEFT JOIN employees o ON o.id = e.owner_id
    LEFT JOIN users ru ON ru.id = e.reviewed_by`;

// Applied to the wrapped query (alias x).
const SIGNAL_SORTS: Record<string, string> = {
  raised: 'x."raisedOn"', code: 'x.code', stage: 'x.stage', student: 'x."studentName"', owner: 'x.owner', next: 'x."nextReviewOn"',
};

export async function listSignals(user: AuthUser, f: {
  page: number; pageSize: number; q?: string; sort?: string; dir: 'asc' | 'desc';
  campusId?: string; status: string; type?: string; stage?: number;
}) {
  const w = new Where().add('s.deleted_at IS NULL');
  studentScope(user, w);
  w.addIf(f.campusId, 's.campus_id = ?');
  w.addIf(f.type, 'e.signal_type = ?');
  if (f.stage !== undefined) w.add('e.stage = ?', f.stage);
  if (f.status === 'awaiting') w.add('e.closed_at IS NULL AND e.review_decision IS NULL');
  else if (f.status === 'open') w.add('e.closed_at IS NULL');
  else if (f.status === 'closed') w.add('e.stage = 5');
  else if (f.status === 'dismissed') w.add("e.review_decision = 'dismissed'");
  if (f.q) w.add('(s.full_name ILIKE ? OR e.code ILIKE ? OR e.signal ILIKE ?)', likeTerm(f.q), likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT x.*, count(*) OVER() AS total FROM (${SIGNAL_SELECT} ${w.sql}) x
      ORDER BY ${orderBy(f.sort, f.dir, SIGNAL_SORTS, 'raised')}, x.code
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

async function loadSignal(user: AuthUser, id: string, db?: Queryable, lock = false) {
  const sig = await one(`${SIGNAL_SELECT} WHERE e.id = $1 ${lock ? 'FOR UPDATE OF e' : ''}`, [id], db);
  if (!sig || !(await canAccessStudent(user, sig.studentId))) throw notFound('Signal not found', 'SIGNAL_NOT_FOUND');
  return sig;
}

/** Everything a reviewer needs: what the signal is, the evidence behind it, and its history. */
export async function getSignal(user: AuthUser, id: string) {
  const sig = await loadSignal(user, id);
  const [student, thresholds, participation, behaviour, observations, history] = await Promise.all([
    getStudentRow(sig.studentId),
    earlyWarningThresholds(),
    one(`SELECT (SELECT count(*) FROM student_activities sa WHERE sa.student_id = $1 AND sa.status = 'active')::int AS activities,
                (SELECT count(*) FROM behaviour_records b WHERE b.student_id = $1 AND b.record_type IN ('Concern', 'Incident') AND b.recorded_on > current_date - 60)::int AS concerns,
                (SELECT count(*) FROM behaviour_records b WHERE b.student_id = $1 AND b.record_type = 'Positive' AND b.recorded_on > current_date - 60)::int AS positives,
                (SELECT count(*) FROM attendance_records a WHERE a.student_id = $1 AND a.status = 'absent' AND a.attendance_date > current_date - 30)::int AS "absent30",
                (SELECT count(*) FROM attendance_records a WHERE a.student_id = $1 AND a.status = 'late' AND a.attendance_date > current_date - 30)::int AS "late30"`,
      [sig.studentId]),
    many(`SELECT b.recorded_on AS date, b.record_type AS type, b.note, e.full_name AS "by"
            FROM behaviour_records b LEFT JOIN employees e ON e.id = b.recorded_by
           WHERE b.student_id = $1 ORDER BY b.recorded_on DESC LIMIT 5`, [sig.studentId]),
    many(`SELECT o.observed_on AS date, o.observation AS text, e.full_name AS "by"
            FROM teacher_observations o JOIN employees e ON e.id = o.employee_id
           WHERE o.student_id = $1 ORDER BY o.observed_on DESC, o.created_at DESC LIMIT 5`, [sig.studentId]),
    many(`SELECT created_at AS at, user_name AS "by", action, description, metadata
            FROM audit_logs WHERE entity_type = 'early_warning_signal' AND entity_id = $1
           ORDER BY created_at DESC LIMIT 20`, [id]),
  ]);
  return {
    ...sig,
    stageLabel: STAGES[sig.stage],
    student: student && {
      attendance: student.attendance, average: student.average, trend: student.trend,
      classTeacherSection: `${student.grade ?? ''}${student.section ?? ''}`,
    },
    participation,
    behaviour,
    observations,
    history,
    thresholds,
  };
}

async function addObservation(user: AuthUser, studentId: string, text: string | undefined, db: Queryable) {
  if (!text || !user.employeeId) return;
  await query(
    `INSERT INTO teacher_observations (student_id, employee_id, observed_on, observation) VALUES ($1, $2, current_date, $3)`,
    [studentId, user.employeeId, text], db,
  );
}

async function setRisk(req: Request, studentId: string, admissionNo: string, from: string, to: string, reason: string, db: Queryable) {
  if (from === to) return;
  await query('UPDATE students SET risk_level = $1, updated_by = $2 WHERE id = $3', [to, req.user!.id, studentId], db);
  await audit(req, {
    action: 'update', module: 'earlywarning', entityType: 'student', entityId: studentId,
    description: `Risk level for ${admissionNo} changed from ${from} to ${to} (${reason})`,
    metadata: { from, to, reason },
  }, db);
}

export async function review(req: Request, id: string, input:
  | { decision: 'accept'; actionPlan: string; ownerId: string; nextReviewOn: string; riskLevel?: string; context?: string }
  | { decision: 'dismiss'; reason: string; context?: string }) {
  const user = req.user!;
  return tx(async (db) => {
    const sig = await loadSignal(user, id, db, true);
    if (sig.closedAt || sig.decision) throw conflict(`Signal ${sig.code} has already been reviewed`, 'SIGNAL_ALREADY_REVIEWED');
    if (sig.stage > 1) throw conflict(`Signal ${sig.code} is past the review stage`, 'SIGNAL_STAGE');
    await addObservation(user, sig.studentId, input.context ? `[${sig.code} · review] ${input.context}` : undefined, db);

    if (input.decision === 'dismiss') {
      await query(
        `UPDATE early_warning_signals SET review_decision = 'dismissed', reviewed_by = $1, reviewed_at = now(), closed_at = now(),
                action_plan = $2 WHERE id = $3`,
        [user.id, `Dismissed: ${input.reason}`, id], db,
      );
      await audit(req, {
        action: 'dismiss', module: 'earlywarning', entityType: 'early_warning_signal', entityId: id,
        description: `Dismissed Early Warning signal ${sig.code} for ${sig.admissionNo}: ${input.reason}`,
        metadata: { reason: input.reason, signalType: sig.signalType },
      }, db);
      return { id, code: sig.code, decision: 'dismissed' };
    }

    if (input.nextReviewOn < schoolToday()) throw badRequest('Next review date cannot be in the past', 'VALIDATION_ERROR', [{ field: 'nextReviewOn', message: 'Choose today or a later date' }]);
    const owner = await one<{ id: string; full_name: string; user_id: string | null }>(
      `SELECT id, full_name, user_id FROM employees WHERE id = $1 AND deleted_at IS NULL AND employment_status = 'active'`, [input.ownerId], db);
    if (!owner) throw badRequest('Owner must be an active member of staff', 'VALIDATION_ERROR', [{ field: 'ownerId', message: 'Choose an active member of staff' }]);

    await query(
      `UPDATE early_warning_signals SET review_decision = 'accepted', reviewed_by = $1, reviewed_at = now(), stage = 2,
              owner_id = $2, action_plan = $3, next_review_on = $4 WHERE id = $5`,
      [user.id, owner.id, input.actionPlan, input.nextReviewOn, id], db,
    );
    await audit(req, {
      action: 'approve', module: 'earlywarning', entityType: 'early_warning_signal', entityId: id,
      description: `Accepted Early Warning signal ${sig.code} for ${sig.admissionNo} — intervention opened, owner ${owner.full_name}`,
      metadata: { ownerId: owner.id, nextReviewOn: input.nextReviewOn, actionPlan: input.actionPlan },
    }, db);

    // Risk level: the reviewer's explicit choice wins; otherwise raise (never lower) by the number of indicators.
    let target = input.riskLevel;
    if (!target) {
      const [row, t] = await Promise.all([getStudentRow(sig.studentId), earlyWarningThresholds(db)]);
      const indicators = Number((row?.attendance ?? 100) < t.attendance) + Number((row?.trend ?? 0) <= -t.scoreDrop)
        + Number(['behaviour', 'wellbeing'].includes(sig.signalType));
      const suggested = indicators >= 2 ? 'At Risk' : 'Developing Risk';
      target = riskRank(suggested) > riskRank(sig.risk) ? suggested : sig.risk;
    }
    if (!(RISK_ORDER as readonly string[]).includes(target!)) target = sig.risk;
    await setRisk(req, sig.studentId, sig.admissionNo, sig.risk, target!, `signal ${sig.code} accepted`, db);

    if (owner.user_id) {
      await notifyUsers([owner.user_id], {
        category: 'Attention', topic: 'earlywarning', icon: 'flag',
        title: `You own the intervention for ${sig.studentName}`,
        body: `${sig.code}: ${input.actionPlan}. Next review ${input.nextReviewOn}.`,
        route: '/early-warning', entityType: 'early_warning_signal', entityId: id,
      }, db);
    }
    return { id, code: sig.code, decision: 'accepted', riskLevel: target };
  });
}

export async function advance(req: Request, id: string, input: { note: string; nextReviewOn?: string }) {
  const user = req.user!;
  return tx(async (db) => {
    const sig = await loadSignal(user, id, db, true);
    if (sig.decision !== 'accepted' || sig.closedAt) throw conflict('Only open, accepted interventions can move forward', 'SIGNAL_STAGE');
    if (sig.stage < 2 || sig.stage > 3) throw conflict(sig.stage === 4 ? 'This intervention is in follow-up — close it with an outcome' : 'Signal is not in an intervention stage', 'SIGNAL_STAGE');
    const stage = sig.stage + 1;
    await query('UPDATE early_warning_signals SET stage = $1, next_review_on = COALESCE($2::date, next_review_on) WHERE id = $3', [stage, input.nextReviewOn ?? null, id], db);
    await addObservation(user, sig.studentId, `[${sig.code} · ${STAGES[stage]}] ${input.note}`, db);
    await audit(req, {
      action: 'update', module: 'earlywarning', entityType: 'early_warning_signal', entityId: id,
      description: `Moved ${sig.code} to ${STAGES[stage]}: ${input.note}`,
      metadata: { from: sig.stage, to: stage, note: input.note, nextReviewOn: input.nextReviewOn },
    }, db);
    return { id, code: sig.code, stage, stageLabel: STAGES[stage] };
  });
}

export async function close(req: Request, id: string, input: { outcome: string; riskLevel?: string }) {
  const user = req.user!;
  return tx(async (db) => {
    const sig = await loadSignal(user, id, db, true);
    if (sig.decision !== 'accepted' || sig.closedAt) throw conflict('Only open, accepted interventions can be closed', 'SIGNAL_STAGE');
    await query(`UPDATE early_warning_signals SET stage = 5, closed_at = now(), next_review_on = NULL WHERE id = $1`, [id], db);
    await addObservation(user, sig.studentId, `[${sig.code} · Closed] ${input.outcome}`, db);
    await audit(req, {
      action: 'update', module: 'earlywarning', entityType: 'early_warning_signal', entityId: id,
      description: `Closed intervention ${sig.code} for ${sig.admissionNo}: ${input.outcome}`,
      metadata: { outcome: input.outcome, fromStage: sig.stage },
    }, db);
    if (input.riskLevel) await setRisk(req, sig.studentId, sig.admissionNo, sig.risk, input.riskLevel, `intervention ${sig.code} closed`, db);
    return { id, code: sig.code, stage: 5 };
  });
}

/**
 * Deterministic signal check. Two transparent rules, both read from system settings:
 *   A. attendance this academic year below `early_warning.attendance_threshold` (≥ 10 marked days)
 *   B. latest-term average dropped by ≥ `early_warning.score_drop_threshold` points against the previous term
 * A Stage-0 signal is created only when the student has no open signal of that type and no
 * signal of that type dismissed in the last 30 days (so a dismissed cause is not re-raised).
 */
export async function runCheck(req: Request, campusId?: string) {
  const user = req.user!;
  return tx(async (db) => {
    // One check at a time: a second run waits, then sees the first run's signals as open.
    await query('SELECT pg_advisory_xact_lock(hashtext($1))', ['early_warning:run_check'], db);
    const t = await earlyWarningThresholds(db);
    const w = new Where().add("s.deleted_at IS NULL AND s.status = 'active'");
    studentScope(user, w);
    w.addIf(campusId, 's.campus_id = ?');
    const rows = await many(
      `WITH att AS (
         SELECT a.student_id, count(*)::int AS marked,
                round(100.0 * count(*) FILTER (WHERE a.status IN ('present', 'late')) / count(*))::int AS pct
           FROM attendance_records a JOIN academic_years ay ON ay.is_current AND a.attendance_date BETWEEN ay.starts_on AND ay.ends_on
          GROUP BY a.student_id),
       terms AS (
         SELECT r.student_id, r.term_order, r.term, avg(r.score) AS avg,
                row_number() OVER (PARTITION BY r.student_id ORDER BY r.term_order DESC) AS rn
           FROM student_academic_records r JOIN academic_years ay ON ay.id = r.academic_year_id AND ay.is_current
          GROUP BY r.student_id, r.term_order, r.term),
       perf AS (
         SELECT cur.student_id, cur.term AS "curTerm", prev.term AS "prevTerm",
                round(cur.avg, 1)::float AS "curAvg", round(prev.avg, 1)::float AS "prevAvg", round(cur.avg - prev.avg, 1)::float AS delta
           FROM terms cur JOIN terms prev ON prev.student_id = cur.student_id AND prev.rn = 2
          WHERE cur.rn = 1)
       SELECT s.id, s.full_name AS "fullName", s.admission_no AS "admissionNo", sec.class_teacher_id AS "classTeacherId",
              ct.user_id AS "classTeacherUserId", att.pct, att.marked, perf.*,
              EXISTS (SELECT 1 FROM early_warning_signals e WHERE e.student_id = s.id AND e.signal_type = 'attendance'
                        AND ((e.closed_at IS NULL) OR (e.review_decision = 'dismissed' AND e.reviewed_at > now() - interval '30 days'))) AS "blockAttendance",
              EXISTS (SELECT 1 FROM early_warning_signals e WHERE e.student_id = s.id AND e.signal_type = 'academic'
                        AND ((e.closed_at IS NULL) OR (e.review_decision = 'dismissed' AND e.reviewed_at > now() - interval '30 days'))) AS "blockAcademic"
         FROM students s
         LEFT JOIN sections sec ON sec.id = s.section_id
         LEFT JOIN classes c ON c.id = sec.class_id
         LEFT JOIN employees ct ON ct.id = sec.class_teacher_id
         LEFT JOIN att ON att.student_id = s.id
         LEFT JOIN perf ON perf.student_id = s.id
         ${w.sql}
         ORDER BY s.admission_no`,
      w.params, db,
    );

    const created: { id: string; code: string; studentId: string; studentName: string; admissionNo: string; rule: string; signal: string }[] = [];
    let skipped = 0;
    let matched = 0;
    const notify = new Map<string, string[]>();
    for (const s of rows) {
      const candidates: { type: string; rule: string; text: string; blocked: boolean }[] = [];
      if (s.marked >= 10 && s.pct !== null && s.pct < t.attendance) {
        candidates.push({ type: 'attendance', rule: 'A', blocked: s.blockAttendance, text: `Attendance at ${s.pct}% — below the ${t.attendance}% threshold (automatic check, rule A)` });
      }
      if (s.delta !== null && s.delta !== undefined && s.delta <= -t.scoreDrop) {
        candidates.push({ type: 'academic', rule: 'B', blocked: s.blockAcademic, text: `Average fell ${Math.abs(s.delta)} points from ${s.prevTerm} (${s.prevAvg}) to ${s.curTerm} (${s.curAvg}) — threshold ${t.scoreDrop} (automatic check, rule B)` });
      }
      for (const c of candidates) {
        matched++;
        if (c.blocked) { skipped++; continue; }
        const code = await nextCode('early_warning_signals', 'code', 'SIG-', db, 3);
        const ins = await one<{ id: string }>(
          `INSERT INTO early_warning_signals (code, student_id, signal, signal_type, stage, owner_id, raised_on)
           VALUES ($1, $2, $3, $4, 0, $5, current_date) RETURNING id`,
          [code, s.id, c.text, c.type, s.classTeacherId], db,
        );
        created.push({ id: ins!.id, code, studentId: s.id, studentName: s.fullName, admissionNo: s.admissionNo, rule: c.rule, signal: c.text });
        await audit(req, {
          action: 'create', module: 'earlywarning', entityType: 'early_warning_signal', entityId: ins!.id,
          description: `Signal check raised ${code} for ${s.admissionNo} (rule ${c.rule})`,
          metadata: { rule: c.rule, thresholds: t },
        }, db);
        if (s.classTeacherUserId) notify.set(s.classTeacherUserId, [...(notify.get(s.classTeacherUserId) ?? []), s.fullName]);
      }
    }
    for (const [uid, names] of notify) {
      await notifyUsers([uid], {
        category: 'Attention', topic: 'earlywarning', icon: 'alert',
        title: `${names.length} new Early Warning signal${names.length > 1 ? 's' : ''} to review`,
        body: names.slice(0, 5).join(', ') + (names.length > 5 ? ` and ${names.length - 5} more` : ''),
        route: '/early-warning',
      }, db);
    }
    await audit(req, {
      action: 'create', module: 'earlywarning',
      description: `Ran Early Warning signal check: ${rows.length} students checked, ${created.length} signals raised, ${skipped} skipped (already open or recently dismissed)`,
      metadata: { thresholds: t, checked: rows.length, created: created.map((c) => c.code), skipped, campusId: campusId ?? null },
    }, db);
    return {
      checked: rows.length,
      matched,
      skipped,
      created,
      rules: [
        { id: 'A', type: 'attendance', description: `Attendance this academic year below ${t.attendance}% (at least 10 marked days)` },
        { id: 'B', type: 'academic', description: `Latest-term average at least ${t.scoreDrop} points below the previous term` },
      ],
      thresholds: t,
    };
  });
}
