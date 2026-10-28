/**
 * Parent experience — shared helpers: data scope for families, audience
 * targeting for circulars/events, and audience notifications.
 */
import type { AuthUser } from '../types.js';
import { many, one, type Queryable } from '../config/db.js';
import { Where } from '../utils/sql.js';
import { notFound } from '../utils/errors.js';
import { studentScope } from './access.service.js';
import { notifyUsers, type NotifyInput } from './notification.service.js';
import type { Audience } from '../validators/parents-experience.validators.js';

/**
 * The shared student scope rule (access.service#studentScope) as a `?`
 * fragment that can be nested inside EXISTS sub-queries. Empty for
 * school-wide users.
 */
export function scopeFragment(user: AuthUser, alias = 's') {
  const sw = new Where();
  studentScope(user, sw, alias);
  return { sql: sw.and.replace(/\$\d+/g, '?'), params: [...sw.params] };
}

/** True when the user only sees the families of their own classes (teachers). */
export function isClassScoped(user: AuthUser) {
  return scopeFragment(user).sql !== '';
}

/** Adds "parent (alias.id) has at least one child the user may see". */
export function addParentScope(user: AuthUser, w: Where, parentExpr = 'p.id') {
  const sc = scopeFragment(user, 'sx');
  if (!sc.sql) return w;
  return w.add(
    `EXISTS (SELECT 1 FROM student_guardians sgx JOIN students sx ON sx.id = sgx.student_id AND sx.deleted_at IS NULL
              WHERE sgx.parent_id = ${parentExpr} ${sc.sql})`,
    ...sc.params,
  );
}

/** Loads a parent the user may address, or 404. */
export async function visibleParent(user: AuthUser, parentId: string, db?: Queryable) {
  const w = new Where().add('p.id = ?', parentId).add('p.deleted_at IS NULL');
  addParentScope(user, w);
  const row = await one<{ id: string; fullName: string; userId: string | null; phone: string; preferredChannel: string }>(
    `SELECT p.id, p.full_name AS "fullName", p.user_id AS "userId", p.phone, p.preferred_channel AS "preferredChannel"
       FROM parents p ${w.sql}`,
    w.params,
    db,
  );
  if (!row) throw notFound('Parent not found', 'PARENT_NOT_FOUND');
  return row;
}

/** The signed-in parent's id, or 404 when the account is not linked to a family. */
export function selfParentId(user: AuthUser) {
  if (!user.parentId) throw notFound('No parent record is linked to this account', 'PARENT_NOT_LINKED');
  return user.parentId;
}

// ---------------------------------------------------------------------------
// Audience targeting
// ---------------------------------------------------------------------------
export const STAFF_ROLES = ['super_admin', 'school_admin', 'management', 'principal', 'teacher', 'hr', 'finance', 'office', 'staff'];

export function normalizeAudience(raw: unknown): Audience {
  const f = (raw ?? {}) as { kind?: string; grades?: number[] };
  const kind = (['all', 'grades', 'transport', 'staff'].includes(f.kind ?? '') ? f.kind : f.grades?.length ? 'grades' : 'all') as Audience['kind'];
  return kind === 'grades' ? { kind, grades: [...new Set((f.grades ?? []).map(Number))].sort((a, b) => a - b) } : { kind };
}

export function audienceLabel(a: Audience) {
  if (a.kind === 'staff') return 'All staff';
  if (a.kind === 'transport') return 'Transport users';
  if (a.kind === 'grades') {
    const g = [...new Set(a.grades ?? [])].sort((x, y) => x - y);
    if (g.length === 1) return `Grade ${g[0]} parents`;
    const contiguous = g.every((v, i) => i === 0 || v === g[i - 1] + 1);
    return contiguous ? `Grades ${g[0]}–${g[g.length - 1]}` : `Grades ${g.join(', ')}`;
  }
  return 'All parents';
}

/**
 * SQL predicate: the parent (`parentExpr`) belongs to the audience stored in
 * `audExpr` (jsonb) for campus `campusExpr` (uuid, NULL = every campus).
 * Only trusted SQL expressions are interpolated; values travel as params.
 */
export function audienceParentSql(audExpr: string, campusExpr: string, parentExpr: string) {
  return `(COALESCE(${audExpr}->>'kind', 'all') <> 'staff' AND EXISTS (
    SELECT 1 FROM student_guardians ag
      JOIN students ast ON ast.id = ag.student_id AND ast.deleted_at IS NULL AND ast.status = 'active'
      LEFT JOIN sections asec ON asec.id = ast.section_id
      LEFT JOIN classes acl ON acl.id = asec.class_id
     WHERE ag.parent_id = ${parentExpr}
       AND (${campusExpr} IS NULL OR ast.campus_id = ${campusExpr})
       AND (COALESCE(${audExpr}->>'kind', 'all') <> 'grades'
            OR acl.grade_level IN (SELECT jsonb_array_elements_text(COALESCE(${audExpr}->'grades', '[]'::jsonb))::int))
       AND (COALESCE(${audExpr}->>'kind', 'all') <> 'transport'
            OR EXISTS (SELECT 1 FROM student_transport ats WHERE ats.student_id = ast.id))))`;
}

/** How many families (or staff accounts) an audience reaches. */
export async function countAudience(a: Audience, campusId: string | null | undefined, db?: Queryable) {
  if (a.kind === 'staff') {
    const r = await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM users u JOIN roles r ON r.id = u.role_id
        WHERE r.key = ANY($1) AND u.status = 'active' AND u.deleted_at IS NULL AND ($2::uuid IS NULL OR u.campus_id = $2::uuid)`,
      [STAFF_ROLES, campusId ?? null], db);
    return r?.n ?? 0;
  }
  const r = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM parents p
      WHERE p.deleted_at IS NULL AND ${audienceParentSql('$1::jsonb', '$2::uuid', 'p.id')}`,
    [JSON.stringify(a), campusId ?? null], db);
  return r?.n ?? 0;
}

/** Notifies everyone in an audience who has an app account; returns the number notified. */
export async function notifyAudience(a: Audience, campusId: string | null | undefined, n: NotifyInput, db?: Queryable) {
  if (a.kind === 'staff') {
    // Same staff accounts countAudience counts: a campus circular reaches that campus only.
    const staff = await many<{ id: string }>(
      `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
        WHERE r.key = ANY($1) AND u.status = 'active' AND u.deleted_at IS NULL AND ($2::uuid IS NULL OR u.campus_id = $2::uuid)`,
      [STAFF_ROLES, campusId ?? null], db);
    return (await notifyUsers(staff.map((u) => u.id), { ...n, route: n.route?.startsWith('/parent-360') ? undefined : n.route }, db)).length;
  }
  const users = await many<{ user_id: string }>(
    `SELECT p.user_id FROM parents p
      WHERE p.deleted_at IS NULL AND p.user_id IS NOT NULL AND ${audienceParentSql('$1::jsonb', '$2::uuid', 'p.id')}`,
    [JSON.stringify(a), campusId ?? null], db);
  return (await notifyUsers(users.map((u) => u.user_id), n, db)).length;
}

/** External channels for a communications channel label. */
export function channelsFor(channel: string): ('whatsapp' | 'sms' | 'email' | 'push')[] {
  switch (channel) {
    case 'WhatsApp': return ['whatsapp'];
    case 'Email': return ['email'];
    case 'SMS': return ['sms'];
    default: return ['push'];
  }
}

/** Grade label ("Grade 5A") SQL for a student alias with sec/cl joins. */
export const GRADE_SQL = (cl = 'cl', sec = 'sec') => `CASE WHEN ${cl}.name IS NULL THEN NULL ELSE ${cl}.name || ${sec}.name END`;
