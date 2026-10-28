import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { many, one, query, tx } from '../config/db.js';
import { env } from '../config/env.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { nextCode } from '../utils/codes.js';
import { likeTerm, limitOffset, orderBy, type Pagination } from '../utils/pagination.js';
import { Where } from '../utils/sql.js';
import { audit } from './audit.service.js';
import { isGuardianOf, resolveStudentId } from './access.service.js';
import { notifyGuardians, notifyRoles } from './notification.service.js';
import {
  authorizeSafetyStudent, hhmm, localDate, PARENT_ROUTE, pct, safetyStudentScope,
  studentBrief, TODAY, tooMany,
} from './safety-common.service.js';
import type { AuthUser } from '../types.js';

export const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_PER_30_MIN = 5;

// =============================================================================
// Listing
// =============================================================================
const AUTH_SELECT = `
  SELECT pa.id, pa.student_id AS "studentId", s.full_name AS "studentName", s.admission_no AS "admissionNo",
         c.name AS grade, sec.name AS section,
         pa.person_name AS "personName", pa.relation, pa.phone, pa.method, pa.status,
         pa.last_pickup_at AS "lastPickupAt", pa.created_at AS "createdAt", pa.updated_at AS "updatedAt",
         pa.approved_by_parent IS NOT NULL AS "parentApproved", p.full_name AS "approvedByName",
         (SELECT o.expires_at FROM pickup_otp_challenges o
           WHERE o.authorisation_id = pa.id AND o.consumed_at IS NULL AND o.expires_at > now()
           ORDER BY o.created_at DESC LIMIT 1) AS "otpExpiresAt"
    FROM pickup_authorisations pa
    JOIN students s ON s.id = pa.student_id
    LEFT JOIN sections sec ON sec.id = s.section_id
    LEFT JOIN classes c ON c.id = sec.class_id
    LEFT JOIN parents p ON p.id = pa.approved_by_parent`;

const AUTH_SORTS: Record<string, string> = {
  student: 'x."studentName"', person: 'x."personName"', status: 'x.status', last: 'x."lastPickupAt"', created: 'x."createdAt"',
};

export interface PickupFilters extends Pagination {
  campusId?: string;
  studentId?: string;
  status?: 'Pending' | 'Verified' | 'Revoked';
}

export async function listAuthorisations(req: Request, f: PickupFilters) {
  const user = req.user!;
  const w = new Where();
  w.add('s.deleted_at IS NULL');
  safetyStudentScope(user, w);
  w.addIf(f.campusId, 's.campus_id = ?');
  w.addIf(f.status, 'pa.status = ?');
  if (f.studentId) w.add('pa.student_id = ?', await authorizeSafetyStudent(req, f.studentId));
  if (f.q) w.add('(pa.person_name ILIKE ? OR s.full_name ILIKE ? OR s.admission_no ILIKE ?)', likeTerm(f.q), likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT x.*, count(*) OVER() AS total FROM (${AUTH_SELECT} ${w.sql}) x
      ORDER BY ${orderBy(f.sort, f.dir, AUTH_SORTS, 'student')}, CASE x.status WHEN 'Verified' THEN 0 WHEN 'Pending' THEN 1 ELSE 2 END, x."createdAt"
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export async function pickupSummary(user: AuthUser, campusId?: string) {
  const w = new Where();
  w.add('s.deleted_at IS NULL');
  safetyStudentScope(user, w);
  w.addIf(campusId, 's.campus_id = ?');
  const a = await one<{ active: number; students: number; qr: number; verified: number; pending: number }>(
    `SELECT count(*) FILTER (WHERE pa.status <> 'Revoked')::int AS active,
            count(DISTINCT pa.student_id) FILTER (WHERE pa.status <> 'Revoked')::int AS students,
            count(*) FILTER (WHERE pa.status = 'Verified' AND pa.method ILIKE '%QR%')::int AS qr,
            count(*) FILTER (WHERE pa.status = 'Verified')::int AS verified,
            count(*) FILTER (WHERE pa.status = 'Pending')::int AS pending
       FROM pickup_authorisations pa JOIN students s ON s.id = pa.student_id ${w.sql}`,
    w.params,
  );
  const otp = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM pickup_otp_challenges o
       JOIN pickup_authorisations pa ON pa.id = o.authorisation_id JOIN students s ON s.id = pa.student_id
      ${w.sql} AND o.verified AND ${localDate('o.consumed_at')} = ${TODAY}`,
    w.params,
  );
  const events = await many(
    `SELECT pe.id, pe.occurred_at AS "occurredAt", pe.outcome, pe.person_name AS "personName", pe.gate, pe.method, pe.notes,
            s.id AS "studentId", s.full_name AS "studentName", i.code AS "incidentCode",
            EXISTS (SELECT 1 FROM pickup_events c WHERE c.student_id = pe.student_id AND c.outcome = 'collected' AND c.occurred_at > pe.occurred_at) AS resolved
       FROM pickup_events pe JOIN students s ON s.id = pe.student_id LEFT JOIN incidents i ON i.id = pe.incident_id
      ${w.sql} AND ${localDate('pe.occurred_at')} = ${TODAY}
      ORDER BY pe.occurred_at DESC LIMIT 20`,
    w.params,
  );
  const held = events.filter((e) => e.outcome === 'held');
  return {
    authorisedPersons: a!.active,
    studentsCovered: a!.students,
    averagePerStudent: a!.students ? Math.round((a!.active / a!.students) * 10) / 10 : 0,
    verifiedByQrPct: pct(a!.qr, a!.verified),
    pendingConfirmation: a!.pending,
    otpVerificationsToday: otp!.n,
    collectedToday: events.filter((e) => e.outcome === 'collected').length,
    heldToday: held.length,
    heldResolved: held.filter((e) => e.resolved).length,
    recentEvents: events,
  };
}

async function loadAuthorisation(id: string, db?: import('../config/db.js').Queryable) {
  const row = await one<{ id: string; student_id: string; person_name: string; relation: string; method: string; status: string; approved_by_parent: string | null }>(
    'SELECT id, student_id, person_name, relation, method, status, approved_by_parent FROM pickup_authorisations WHERE id = $1',
    [id], db,
  );
  if (!row) throw notFound('Pickup authorisation not found', 'PICKUP_NOT_FOUND');
  return row;
}

/** Loads an authorisation the staff user may act on (scope via the student). */
async function staffAuthorisation(req: Request, id: string) {
  const row = await loadAuthorisation(id);
  await authorizeSafetyStudent(req, row.student_id);
  return row;
}

/** Loads an authorisation belonging to one of the parent's own children. */
async function familyAuthorisation(req: Request, studentRef: string, id: string) {
  const studentId = await familyChild(req, studentRef);
  const row = await loadAuthorisation(id);
  if (row.student_id !== studentId) throw notFound('Pickup authorisation not found', 'PICKUP_NOT_FOUND');
  return row;
}

export async function familyChild(req: Request, studentRef: string) {
  const u = req.user!;
  let id: string;
  try {
    id = await resolveStudentId(studentRef);
  } catch {
    throw notFound('Student not found', 'STUDENT_NOT_FOUND');
  }
  if (!u.parentId || !(await isGuardianOf(u.parentId, id))) throw notFound('Student not found', 'STUDENT_NOT_FOUND');
  return id;
}

async function getAuthorisation(id: string) {
  return one(`${AUTH_SELECT} WHERE pa.id = $1`, [id]);
}

// =============================================================================
// Create / confirm / revoke
// =============================================================================
export interface PickupInput {
  personName: string;
  relation: string;
  phone?: string;
  method: string;
}

async function createAuthorisation(req: Request, studentId: string, input: PickupInput, parentId: string | null) {
  const id = await tx(async (db) => {
    const s = await studentBrief(studentId, db);
    const dup = await one(
      `SELECT 1 FROM pickup_authorisations WHERE student_id = $1 AND lower(person_name) = lower($2) AND status <> 'Revoked'`,
      [studentId, input.personName], db,
    );
    if (dup) throw conflict(`${input.personName} is already on ${s.full_name}'s pickup list`, 'PICKUP_DUPLICATE');
    const row = await one<{ id: string }>(
      `INSERT INTO pickup_authorisations (student_id, person_name, relation, phone, method, status, approved_by_parent)
       VALUES ($1,$2,$3,$4,$5,'Pending',$6) RETURNING id`,
      [studentId, input.personName, input.relation, input.phone ?? null, input.method, parentId], db,
    );
    if (parentId) {
      await notifyRoles(['office'], {
        category: 'Attention', icon: 'key', topic: 'safety',
        title: `New pickup person for ${s.full_name}: ${input.personName}`,
        body: `${input.relation} · ${input.method} · added by a parent, verify at the front office`,
        route: '/pickup', entityType: 'pickup_authorisation', entityId: row!.id,
      }, db);
    } else {
      await notifyGuardians(studentId, {
        category: 'Attention', icon: 'key', topic: 'safety',
        title: `Please confirm ${input.personName} as a pickup person for ${s.full_name}`,
        body: `${input.relation} · added by the school front office`,
        route: PARENT_ROUTE, entityType: 'pickup_authorisation', entityId: row!.id,
      }, db);
    }
    await audit(req, {
      action: 'create', module: 'safety',
      description: `Added pickup person ${input.personName} (${input.relation}) for ${s.full_name}${parentId ? ' — by parent' : ''}`,
      entityType: 'pickup_authorisation', entityId: row!.id, metadata: { studentId, method: input.method },
    }, db);
    return row!.id;
  });
  return getAuthorisation(id);
}

export async function staffCreate(req: Request, input: PickupInput & { studentId: string }) {
  const studentId = await authorizeSafetyStudent(req, input.studentId);
  return createAuthorisation(req, studentId, input, null);
}

export async function familyCreate(req: Request, studentRef: string, input: PickupInput) {
  const studentId = await familyChild(req, studentRef);
  return createAuthorisation(req, studentId, input, req.user!.parentId);
}

async function setStatus(req: Request, row: { id: string; student_id: string; person_name: string; status: string }, status: 'Verified' | 'Revoked', how: string, parentId?: string | null) {
  if (row.status === 'Revoked') throw conflict('This authorisation has been revoked. Add the person again if needed.', 'PICKUP_REVOKED');
  if (row.status === status) throw conflict(`Already ${status.toLowerCase()}`, 'PICKUP_UNCHANGED');
  await tx(async (db) => {
    await query(
      `UPDATE pickup_authorisations SET status = $2, approved_by_parent = COALESCE($3, approved_by_parent) WHERE id = $1`,
      [row.id, status, parentId ?? null], db,
    );
    if (status === 'Revoked') {
      await query(`UPDATE pickup_otp_challenges SET consumed_at = now() WHERE authorisation_id = $1 AND consumed_at IS NULL`, [row.id], db);
    }
    const s = await studentBrief(row.student_id, db);
    if (status === 'Revoked' && !parentId) {
      await notifyGuardians(row.student_id, {
        category: 'Information', icon: 'key', topic: 'safety',
        title: `${row.person_name} was removed from ${s.full_name}'s pickup list`, route: PARENT_ROUTE,
        entityType: 'pickup_authorisation', entityId: row.id,
      }, db);
    }
    if (parentId) {
      await notifyRoles(['office'], {
        category: 'Information', icon: 'key', topic: 'safety',
        title: `Parent ${status === 'Verified' ? 'confirmed' : 'revoked'} ${row.person_name} for ${s.full_name}`,
        route: '/pickup', entityType: 'pickup_authorisation', entityId: row.id,
      }, db);
    }
    await audit(req, {
      action: status === 'Verified' ? 'approve' : 'update', module: 'safety',
      description: `${status === 'Verified' ? 'Verified' : 'Revoked'} pickup person ${row.person_name} for ${s.full_name} (${how})`,
      entityType: 'pickup_authorisation', entityId: row.id,
    }, db);
  });
  return getAuthorisation(row.id);
}

export async function staffRevoke(req: Request, id: string) {
  return setStatus(req, await staffAuthorisation(req, id), 'Revoked', 'staff');
}

export async function familyConfirm(req: Request, studentRef: string, id: string) {
  return setStatus(req, await familyAuthorisation(req, studentRef, id), 'Verified', 'parent confirmation', req.user!.parentId);
}

export async function familyRevoke(req: Request, studentRef: string, id: string) {
  return setStatus(req, await familyAuthorisation(req, studentRef, id), 'Revoked', 'parent', req.user!.parentId);
}

// =============================================================================
// One-time passwords
// =============================================================================
function hashCode(authorisationId: string, code: string) {
  return createHmac('sha256', env.JWT_SECRET).update(`pickup-otp:${authorisationId}:${code}`).digest('hex');
}

/** Generates a 6-digit code, stores only its hash and sends it to the registered guardians. */
export async function sendOtp(req: Request, id: string) {
  const row = await staffAuthorisation(req, id);
  if (row.status === 'Revoked') throw conflict('This authorisation has been revoked', 'PICKUP_REVOKED');
  const recent = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM pickup_otp_challenges WHERE authorisation_id = $1 AND created_at > now() - interval '30 minutes'`,
    [id],
  );
  if (recent!.n >= OTP_MAX_PER_30_MIN) throw tooMany('Too many codes sent for this person. Try again in 30 minutes.');

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const result = await tx(async (db) => {
    await query(`UPDATE pickup_otp_challenges SET consumed_at = now() WHERE authorisation_id = $1 AND consumed_at IS NULL`, [id], db);
    const ch = await one<{ id: string; expires_at: Date }>(
      `INSERT INTO pickup_otp_challenges (authorisation_id, code_hash, expires_at, created_by)
       VALUES ($1, $2, now() + make_interval(mins => ${OTP_TTL_MINUTES}), $3) RETURNING id, expires_at`,
      [id, hashCode(id, code), req.user!.id], db,
    );
    const s = await studentBrief(row.student_id, db);
    const sent = await notifyGuardians(row.student_id, {
      category: 'Attention', icon: 'key', topic: 'safety',
      title: `Pickup code for ${s.full_name}: ${code}`,
      body: `Share this code with the gate only if you sent ${row.person_name} (${row.relation}). It expires in ${OTP_TTL_MINUTES} minutes.`,
      route: PARENT_ROUTE, entityType: 'pickup_authorisation', entityId: id, channels: ['sms', 'whatsapp', 'push'],
    }, db);
    await audit(req, {
      action: 'create', module: 'safety', description: `Sent pickup OTP to guardians of ${s.full_name} for ${row.person_name}`,
      entityType: 'pickup_authorisation', entityId: id, metadata: { challengeId: ch!.id, recipients: sent.length },
    }, db);
    return { expiresAt: ch!.expires_at, recipients: sent.length };
  });
  return {
    authorisationId: id,
    expiresAt: result.expiresAt,
    sentTo: result.recipients,
    // Development convenience only: no SMS provider is configured locally.
    ...(env.isProd ? {} : { devCode: code }),
  };
}

export async function verifyOtp(req: Request, id: string, code: string) {
  const row = await staffAuthorisation(req, id);
  if (row.status === 'Revoked') throw conflict('This authorisation has been revoked', 'PICKUP_REVOKED');
  // The challenge row is locked for the whole check, so parallel guesses are counted
  // one at a time and cannot get past the attempt limit (or succeed after it).
  // Failures are committed before the error is thrown, hence the result object.
  const outcome = await tx(async (db) => {
    // Authorisation first, then challenge: the same lock order as a revoke.
    const pa = await one<{ status: string }>('SELECT status FROM pickup_authorisations WHERE id = $1 FOR UPDATE', [id], db);
    if (pa?.status === 'Revoked') return { error: 'revoked' as const };
    const ch = await one<{ id: string; code_hash: string; attempts: number }>(
      `SELECT id, code_hash, attempts FROM pickup_otp_challenges
        WHERE authorisation_id = $1 AND consumed_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [id], db,
    );
    if (!ch) return { error: 'expired' as const };
    if (ch.attempts >= OTP_MAX_ATTEMPTS) {
      await query('UPDATE pickup_otp_challenges SET consumed_at = now() WHERE id = $1', [ch.id], db);
      return { error: 'locked' as const };
    }
    const expected = Buffer.from(ch.code_hash, 'hex');
    const given = Buffer.from(hashCode(id, code), 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      await query(
        `UPDATE pickup_otp_challenges SET attempts = attempts + 1, consumed_at = CASE WHEN attempts + 1 >= $2 THEN now() END WHERE id = $1`,
        [ch.id, OTP_MAX_ATTEMPTS], db,
      );
      await audit(req, { action: 'verify_failed', module: 'safety', description: `Wrong pickup OTP entered for ${row.person_name}`, entityType: 'pickup_authorisation', entityId: id }, db);
      return { error: 'invalid' as const, left: OTP_MAX_ATTEMPTS - ch.attempts - 1 };
    }
    await query('UPDATE pickup_otp_challenges SET consumed_at = now(), verified = true WHERE id = $1', [ch.id], db);
    await query(`UPDATE pickup_authorisations SET status = 'Verified' WHERE id = $1`, [id], db);
    const s = await studentBrief(row.student_id, db);
    await audit(req, {
      action: 'approve', module: 'safety', description: `Verified pickup person ${row.person_name} for ${s.full_name} by OTP`,
      entityType: 'pickup_authorisation', entityId: id,
    }, db);
    return { error: null };
  });
  if (outcome.error === 'expired') throw badRequest('No active code. The code may have expired — send a new one.', 'OTP_EXPIRED');
  if (outcome.error === 'locked') throw badRequest('Too many wrong attempts. Send a new code.', 'OTP_LOCKED');
  if (outcome.error === 'revoked') throw conflict('This authorisation has been revoked', 'PICKUP_REVOKED');
  if (outcome.error === 'invalid') {
    const { left } = outcome;
    throw badRequest(left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Incorrect code. Send a new code.', 'OTP_INVALID', [{ field: 'code', message: 'Incorrect code' }]);
  }
  return getAuthorisation(id);
}

// =============================================================================
// Collections at the gate
// =============================================================================
const gateMethod = (m: string) => (/QR/.test(m) ? 'QR' : /Face/.test(m) ? 'Face' : 'Manual');

export async function recordCollection(req: Request, id: string, input: { gate: string; notes?: string }) {
  const row = await staffAuthorisation(req, id);
  if (row.status !== 'Verified') {
    throw conflict(`${row.person_name} is not verified yet. Verify by OTP before releasing the child.`, 'PICKUP_NOT_VERIFIED');
  }
  return tx(async (db) => {
    const s = await studentBrief(row.student_id, db);
    const ev = await one(
      `INSERT INTO pickup_events (student_id, campus_id, authorisation_id, person_name, outcome, method, gate, notes, recorded_by)
       VALUES ($1,$2,$3,$4,'collected',$5,$6,$7,$8) RETURNING id, occurred_at AS "occurredAt"`,
      [s.id, s.campus_id, row.id, row.person_name, row.method, input.gate, input.notes ?? null, req.user!.id], db,
    );
    await query('UPDATE pickup_authorisations SET last_pickup_at = $2 WHERE id = $1', [row.id, ev.occurredAt], db);
    // Same lock as a manual gate scan, so the two cannot both record an exit.
    await query('SELECT pg_advisory_xact_lock(hashtext($1))', [`gate:${s.id}`], db);
    const last = await one<{ direction: string }>(
      `SELECT direction FROM gate_events WHERE student_id = $1 AND ${localDate('occurred_at')} = ${TODAY} ORDER BY occurred_at DESC LIMIT 1`,
      [s.id], db,
    );
    if (last?.direction !== 'out') {
      await query(
        `INSERT INTO gate_events (student_id, campus_id, gate, direction, method, occurred_at, parent_notified_at) VALUES ($1,$2,$3,'out',$4,$5,$5)`,
        [s.id, s.campus_id, input.gate, gateMethod(row.method), ev.occurredAt], db,
      );
    }
    await notifyGuardians(s.id, {
      category: 'Completed', icon: 'userCheck', topic: 'safety',
      title: `${s.full_name} was collected by ${row.person_name}`,
      body: `${input.gate} · ${hhmm(ev.occurredAt)} · verified (${row.method})`,
      route: PARENT_ROUTE, entityType: 'student', entityId: s.id,
    }, db);
    await audit(req, {
      action: 'create', module: 'safety', description: `Released ${s.full_name} to ${row.person_name} at ${input.gate}`,
      entityType: 'pickup_authorisation', entityId: row.id, metadata: { eventId: ev.id },
    }, db);
    return { id: ev.id, occurredAt: ev.occurredAt, studentId: s.id, personName: row.person_name, outcome: 'collected' };
  });
}

/** Someone not on the list tried to collect a child: hold, log an incident, alert. */
export async function reportUnauthorised(req: Request, input: { studentId: string; personName: string; gate: string; notes?: string }) {
  const studentId = await authorizeSafetyStudent(req, input.studentId);
  return tx(async (db) => {
    const s = await studentBrief(studentId, db);
    const code = await nextCode('incidents', 'code', 'INC-', db);
    const inc = await one<{ id: string }>(
      `INSERT INTO incidents (code, campus_id, incident_type, summary, details, severity, status, student_id, owner_id, occurred_on, created_by)
       VALUES ($1,$2,'Safeguarding',$3,$4,'Attention','Open',$5,$6,${TODAY},$7) RETURNING id`,
      [code, s.campus_id, `Unauthorised pickup attempt — ${input.gate}`,
        `${input.personName} attempted to collect ${s.full_name} and is not on the authorised list. Collection held.${input.notes ? ` Notes: ${input.notes}` : ''}`,
        studentId, req.user!.employeeId, req.user!.id], db,
    );
    const ev = await one(
      `INSERT INTO pickup_events (student_id, campus_id, person_name, outcome, gate, incident_id, notes, recorded_by)
       VALUES ($1,$2,$3,'held',$4,$5,$6,$7) RETURNING id, occurred_at AS "occurredAt"`,
      [studentId, s.campus_id, input.personName, input.gate, inc!.id, input.notes ?? null, req.user!.id], db,
    );
    await notifyRoles(['principal', 'office'], {
      category: 'Critical', icon: 'alert', topic: 'safety',
      title: `Unauthorised pickup attempt — ${s.full_name}`,
      body: `${input.personName} at ${input.gate} · ${hhmm(ev.occurredAt)} · collection held (${code})`,
      route: '/safeguarding', entityType: 'incident', entityId: inc!.id, channels: ['push'],
    }, db);
    await notifyGuardians(studentId, {
      category: 'Critical', icon: 'alert', topic: 'safety',
      title: `Collection held for ${s.full_name}`,
      body: `${input.personName} asked to collect your child at ${input.gate} but is not on your authorised list. Your child is safe at school. Please call the front office.`,
      route: PARENT_ROUTE, entityType: 'student', entityId: studentId, channels: ['sms', 'whatsapp', 'push'],
    }, db);
    await audit(req, {
      action: 'create', module: 'safety', description: `Held collection of ${s.full_name}: ${input.personName} not authorised (${code})`,
      entityType: 'incident', entityId: inc!.id, metadata: { gate: input.gate, eventId: ev.id },
    }, db);
    return { id: ev.id, occurredAt: ev.occurredAt, incidentId: inc!.id, incidentCode: code, outcome: 'held' };
  });
}

// =============================================================================
// Family view helper
// =============================================================================
export async function familyPickupList(studentId: string) {
  return many(
    `SELECT pa.id, pa.person_name AS "personName", pa.relation, pa.method, pa.status, pa.last_pickup_at AS "lastPickupAt"
       FROM pickup_authorisations pa WHERE pa.student_id = $1
      ORDER BY CASE pa.status WHEN 'Verified' THEN 0 WHEN 'Pending' THEN 1 ELSE 2 END, pa.created_at`,
    [studentId],
  );
}

