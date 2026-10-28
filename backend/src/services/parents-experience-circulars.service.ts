/**
 * Parent experience — circulars (Draft → Under Review → Released),
 * acknowledgement tracking and reminders, and the school events calendar.
 */
import type { Request } from 'express';
import type { AuthUser } from '../types.js';
import { many, one, query, tx } from '../config/db.js';
import { Where } from '../utils/sql.js';
import { likeTerm, limitOffset, orderBy, type Pagination } from '../utils/pagination.js';
import { conflict, notFound } from '../utils/errors.js';
import { audit } from './audit.service.js';
import { schoolToday } from './academics.service.js';
import { notifyRoles, notifyUsers } from './notification.service.js';
import type { Audience } from '../validators/parents-experience.validators.js';
import {
  addParentScope, audienceLabel, audienceParentSql, countAudience, normalizeAudience, notifyAudience, selfParentId,
} from './parents-experience.service.js';

const total = <T extends { total?: unknown }>(rows: T[]) => Number(rows[0]?.total ?? 0);
const strip = <T extends { total?: unknown }>(rows: T[]) => rows.map(({ total: _t, ...r }) => r);

// =============================================================================
// Circulars
// =============================================================================
const CIRC_SORTS: Record<string, string> = {
  issued: 'COALESCE(c.published_at, c.created_at)', title: 'c.title', status: 'c.status',
  ack: `(SELECT count(*) FROM circular_acknowledgements a WHERE a.circular_id = c.id)::numeric / NULLIF(c.target_count, 0)`,
};

const CIRC_SELECT = (extra = '') => `
  SELECT${extra} c.id, c.title, c.body, c.audience, c.audience_filter AS "audienceFilter", c.campus_id AS "campusId", cp.short_name AS campus,
         c.requires_ack AS "requiresAck", c.status, c.channels, c.published_at AS "publishedAt", c.created_at AS "createdAt",
         c.submitted_at AS "submittedAt", c.last_reminded_at AS "lastRemindedAt", c.reminder_count AS "reminderCount",
         c.target_count AS "targetCount",
         (SELECT count(*)::int FROM circular_acknowledgements a WHERE a.circular_id = c.id) AS "ackCount",
         cu.full_name AS "createdBy", su.full_name AS "submittedBy", ru.full_name AS "releasedBy"
    FROM circulars c
    LEFT JOIN campuses cp ON cp.id = c.campus_id
    LEFT JOIN users cu ON cu.id = c.created_by
    LEFT JOIN users su ON su.id = c.submitted_by
    LEFT JOIN users ru ON ru.id = c.released_by`;

export async function listCirculars(f: Pagination & { status?: string; campusId?: string }) {
  const w = new Where();
  w.addIf(f.status, 'c.status = ?');
  if (f.campusId) w.add('(c.campus_id IS NULL OR c.campus_id = ?)', f.campusId);
  if (f.q) w.add('(c.title ILIKE ? OR c.audience ILIKE ?)', likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `${CIRC_SELECT(' count(*) OVER() AS total,')} ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, CIRC_SORTS, 'issued')}, c.id
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows: strip(rows), total: total(rows) };
}

export async function getCircular(id: string) {
  const c = await one(`${CIRC_SELECT()} WHERE c.id = $1`, [id]);
  if (!c) throw notFound('Circular not found', 'CIRCULAR_NOT_FOUND');
  return c;
}

export async function acknowledgementSummary(campusId?: string) {
  const s = await one(
    `SELECT count(*)::int AS circulars,
            COALESCE(sum(t.target_count), 0)::int AS targeted,
            COALESCE(sum(LEAST(t.ack, t.target_count)), 0)::int AS acknowledged,
            COALESCE(sum(GREATEST(t.target_count - t.ack, 0)), 0)::int AS outstanding
       FROM (SELECT c.target_count, (SELECT count(*) FROM circular_acknowledgements a WHERE a.circular_id = c.id)::int AS ack
               FROM circulars c
              WHERE c.status = 'Released' AND c.requires_ack AND ($1::uuid IS NULL OR c.campus_id IS NULL OR c.campus_id = $1::uuid)) t`,
    [campusId ?? null]);
  const never = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM parents p
      WHERE p.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM circulars c WHERE c.status = 'Released' AND c.requires_ack
                      AND ($1::uuid IS NULL OR c.campus_id IS NULL OR c.campus_id = $1::uuid)
                      AND ${audienceParentSql('c.audience_filter', 'c.campus_id', 'p.id')})
        AND NOT EXISTS (SELECT 1 FROM circular_acknowledgements a JOIN circulars c ON c.id = a.circular_id
                         WHERE a.parent_id = p.id AND c.status = 'Released')`,
    [campusId ?? null]);
  const drafts = await one<{ draft: number; review: number }>(
    `SELECT count(*) FILTER (WHERE status = 'Draft')::int AS draft, count(*) FILTER (WHERE status = 'Under Review')::int AS review
       FROM circulars WHERE ($1::uuid IS NULL OR campus_id IS NULL OR campus_id = $1::uuid)`, [campusId ?? null]);
  const rate = s && s.targeted ? Math.round((s.acknowledged / s.targeted) * 100) : null;
  return { ...s, rate, neverAcknowledged: never?.n ?? 0, drafts: drafts?.draft ?? 0, underReview: drafts?.review ?? 0 };
}

/** Families in the circular's audience with their acknowledgement state. */
export async function listAcknowledgements(user: AuthUser, id: string, f: Pagination & { state: 'pending' | 'acknowledged' }) {
  await getCircular(id);
  const w = new Where();
  const cid = w.param(id);
  w.add('p.deleted_at IS NULL');
  addParentScope(user, w); // teachers: only the families of their own classes
  w.add(audienceParentSql('c.audience_filter', 'c.campus_id', 'p.id'));
  w.add(f.state === 'acknowledged' ? 'a.parent_id IS NOT NULL' : 'a.parent_id IS NULL');
  if (f.q) w.add('(p.full_name ILIKE ? OR p.phone ILIKE ?)', likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT p.id AS "parentId", p.full_name AS "parentName", p.phone, p.engagement_score AS engagement,
            (p.user_id IS NOT NULL) AS "hasAppAccount", a.acknowledged_at AS "acknowledgedAt",
            COALESCE((SELECT json_agg(json_build_object('id', s.id, 'fullName', s.full_name, 'grade', cl.name || sec.name) ORDER BY s.full_name)
                        FROM student_guardians sg JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL
                        LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes cl ON cl.id = sec.class_id
                       WHERE sg.parent_id = p.id), '[]') AS children,
            count(*) OVER() AS total
       FROM circulars c
       JOIN parents p ON true
       LEFT JOIN circular_acknowledgements a ON a.circular_id = c.id AND a.parent_id = p.id
      WHERE c.id = ${cid} ${w.and}
      ORDER BY ${orderBy(f.sort, f.dir, { name: 'p.full_name', acknowledgedAt: 'a.acknowledged_at', engagement: 'p.engagement_score' }, 'name')}, p.id
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params);
  return { rows: strip(rows), total: total(rows) };
}

interface CircularInput {
  title: string; body: string; audience: Audience; campusId?: string | null; requiresAck: boolean; channels: string[];
}

export async function createCircular(req: Request, b: CircularInput) {
  const aud = normalizeAudience(b.audience);
  const requiresAck = aud.kind === 'staff' ? false : b.requiresAck;
  const target = await countAudience(aud, b.campusId);
  const r = await one<{ id: string }>(
    `INSERT INTO circulars (campus_id, title, body, audience, audience_filter, requires_ack, status, target_count, channels, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'Draft',$7,$8,$9) RETURNING id`,
    [b.campusId ?? null, b.title, b.body, audienceLabel(aud), JSON.stringify(aud), requiresAck, target, b.channels, req.user!.id]);
  await audit(req, { action: 'create', module: 'communication', entityType: 'circular', entityId: r!.id, description: `Drafted circular "${b.title}" for ${audienceLabel(aud)}` });
  return getCircular(r!.id);
}

export async function updateCircular(req: Request, id: string, b: Partial<CircularInput>) {
  const c = await getCircular(id);
  if (!['Draft', 'Under Review'].includes(c.status)) throw conflict('Released circulars cannot be edited. Withdraw it and issue a new one.', 'CIRCULAR_LOCKED');
  const aud = b.audience ? normalizeAudience(b.audience) : normalizeAudience(c.audienceFilter);
  const campusId = b.campusId !== undefined ? b.campusId : c.campusId;
  const target = await countAudience(aud, campusId);
  await query(
    `UPDATE circulars SET title = COALESCE($2, title), body = COALESCE($3, body), audience = $4, audience_filter = $5,
            campus_id = $6, requires_ack = $7, channels = COALESCE($8, channels), target_count = $9
      WHERE id = $1`,
    [id, b.title ?? null, b.body ?? null, audienceLabel(aud), JSON.stringify(aud), campusId ?? null,
      aud.kind === 'staff' ? false : b.requiresAck ?? c.requiresAck, b.channels ?? null, target]);
  await audit(req, { action: 'update', module: 'communication', entityType: 'circular', entityId: id, description: `Edited circular "${b.title ?? c.title}"`, metadata: { fields: Object.keys(b) } });
  return getCircular(id);
}

export async function submitCircular(req: Request, id: string) {
  const c = await getCircular(id);
  if (c.status !== 'Draft') throw conflict(`Only drafts can be sent for approval (this circular is ${c.status})`, 'INVALID_TRANSITION');
  await tx(async (db) => {
    // Conditional on the status read above, so a double-submit cannot notify approvers twice.
    const r = await query(`UPDATE circulars SET status = 'Under Review', submitted_by = $2, submitted_at = now() WHERE id = $1 AND status = 'Draft'`, [id, req.user!.id], db);
    if (!r.rowCount) throw conflict('This circular has already been sent for approval', 'INVALID_TRANSITION');
    await notifyRoles(['principal', 'school_admin', 'super_admin'], {
      category: 'Attention', topic: 'circulars', icon: 'megaphone', title: 'Circular awaiting approval',
      body: `${c.title} · ${c.audience} · submitted by ${req.user!.fullName}`, route: '/circulars', entityType: 'circular', entityId: id,
    }, db);
    await audit(req, { action: 'submit', module: 'communication', entityType: 'circular', entityId: id, description: `Sent circular "${c.title}" for approval` }, db);
  });
  return getCircular(id);
}

export async function returnCircular(req: Request, id: string) {
  const c = await getCircular(id);
  if (c.status !== 'Under Review') throw conflict('Only circulars under review can be returned', 'INVALID_TRANSITION');
  await query(`UPDATE circulars SET status = 'Draft' WHERE id = $1`, [id]);
  const creator = await one<{ created_by: string | null }>('SELECT created_by FROM circulars WHERE id = $1', [id]);
  if (creator?.created_by && creator.created_by !== req.user!.id) {
    await notifyUsers([creator.created_by], {
      category: 'Attention', topic: 'circulars', icon: 'megaphone', title: 'Circular returned for changes', body: c.title, route: '/circulars', entityType: 'circular', entityId: id,
    });
  }
  await audit(req, { action: 'reject', module: 'communication', entityType: 'circular', entityId: id, description: `Returned circular "${c.title}" to draft` });
  return getCircular(id);
}

export async function releaseCircular(req: Request, id: string) {
  const c = await getCircular(id);
  if (c.status !== 'Under Review') throw conflict('A circular must be under review before it is released', 'INVALID_TRANSITION');
  const aud = normalizeAudience(c.audienceFilter);
  const notified = await tx(async (db) => {
    const target = await countAudience(aud, c.campusId, db);
    // Conditional on the status read above, so two approvals racing release (and notify) once.
    const r = await query(
      `UPDATE circulars SET status = 'Released', published_at = now(), released_by = $2, target_count = $3 WHERE id = $1 AND status = 'Under Review'`,
      [id, req.user!.id, target], db);
    if (!r.rowCount) throw conflict('This circular has already been released or returned', 'INVALID_TRANSITION');
    const n = await notifyAudience(aud, c.campusId, {
      category: c.requiresAck ? 'Attention' : 'Information', topic: 'circulars', icon: 'megaphone',
      title: c.requiresAck ? 'Circular needs your acknowledgement' : 'New circular from school',
      body: c.title, route: aud.kind === 'staff' ? '/op-circulars' : '/parent-360?tab=more',
      entityType: 'circular', entityId: id, channels: c.channels,
    }, db);
    await query(
      `INSERT INTO communications (channel, direction, counterpart, subject, body, status, recipients, sent_by)
       VALUES ('In-app','outbound',$1,$2,$3,'Delivered',$4,$5)`,
      [c.audience, `Circular: ${c.title}`, c.body, target, req.user!.id], db);
    const creator = await one<{ created_by: string | null }>('SELECT created_by FROM circulars WHERE id = $1', [id], db);
    if (creator?.created_by && creator.created_by !== req.user!.id) {
      await notifyUsers([creator.created_by], {
        category: 'Completed', topic: 'circulars', icon: 'megaphone', title: 'Circular released', body: `${c.title} · ${target} recipients`, route: '/circulars', entityType: 'circular', entityId: id,
      }, db);
    }
    await audit(req, { action: 'approve', module: 'communication', entityType: 'circular', entityId: id, description: `Released circular "${c.title}" to ${c.audience} (${target})`, metadata: { notified: n } }, db);
    return n;
  });
  return { ...(await getCircular(id)), notified };
}

export async function withdrawCircular(req: Request, id: string) {
  const c = await getCircular(id);
  if (c.status !== 'Released') throw conflict('Only released circulars can be withdrawn', 'INVALID_TRANSITION');
  await query(`UPDATE circulars SET status = 'Withdrawn' WHERE id = $1`, [id]);
  await audit(req, { action: 'update', module: 'communication', entityType: 'circular', entityId: id, description: `Withdrew circular "${c.title}"` });
  return getCircular(id);
}

/** Notifies families in the audience who have not acknowledged yet. */
export async function remindCircular(req: Request, id: string) {
  const c = await getCircular(id);
  if (c.status !== 'Released' || !c.requiresAck) throw conflict('Reminders are only sent for released circulars that need acknowledgement', 'INVALID_TRANSITION');
  return tx(async (db) => {
    const pending = await many<{ user_id: string | null }>(
      `SELECT p.user_id FROM circulars c JOIN parents p ON p.deleted_at IS NULL
        WHERE c.id = $1 AND ${audienceParentSql('c.audience_filter', 'c.campus_id', 'p.id')}
          AND NOT EXISTS (SELECT 1 FROM circular_acknowledgements a WHERE a.circular_id = c.id AND a.parent_id = p.id)`,
      [id], db);
    const users = pending.map((p) => p.user_id).filter((u): u is string => !!u);
    const sent = await notifyUsers(users, {
      category: 'Attention', topic: 'circulars', icon: 'megaphone', title: 'Reminder: please acknowledge this circular',
      body: c.title, route: '/parent-360?tab=more', entityType: 'circular', entityId: id, channels: c.channels,
    }, db);
    await query('UPDATE circulars SET last_reminded_at = now(), reminder_count = reminder_count + 1 WHERE id = $1', [id], db);
    if (pending.length) {
      await query(
        `INSERT INTO communications (channel, direction, counterpart, subject, status, recipients, sent_by)
         VALUES ('WhatsApp','outbound',$1,$2,'Queued',$3,$4)`,
        [`${c.audience} — not acknowledged`, `Reminder: ${c.title}`, pending.length, req.user!.id], db);
    }
    await audit(req, { action: 'create', module: 'communication', entityType: 'circular', entityId: id, description: `Sent acknowledgement reminder for "${c.title}" to ${pending.length} families` }, db);
    return { pending: pending.length, reminded: sent.length, withoutApp: pending.length - users.length };
  });
}

// ---- Family ---------------------------------------------------------------------
export async function familyCirculars(user: AuthUser) {
  const parentId = selfParentId(user);
  return many(
    `SELECT c.id, c.title, c.body, c.audience, c.published_at AS "publishedAt", c.requires_ack AS "requiresAck",
            (a.parent_id IS NOT NULL) AS acknowledged, a.acknowledged_at AS "acknowledgedAt"
       FROM circulars c
       LEFT JOIN circular_acknowledgements a ON a.circular_id = c.id AND a.parent_id = $1
      WHERE c.status = 'Released' AND ${audienceParentSql('c.audience_filter', 'c.campus_id', '$1::uuid')}
      ORDER BY (c.requires_ack AND a.parent_id IS NULL) DESC, c.published_at DESC`,
    [parentId]);
}

export async function acknowledgeCircular(req: Request, id: string) {
  const parentId = selfParentId(req.user!);
  const c = await one<{ title: string; requires_ack: boolean }>(
    `SELECT c.title, c.requires_ack FROM circulars c
      WHERE c.id = $1 AND c.status = 'Released' AND ${audienceParentSql('c.audience_filter', 'c.campus_id', '$2::uuid')}`,
    [id, parentId]);
  if (!c) throw notFound('Circular not found', 'CIRCULAR_NOT_FOUND');
  const r = await query(
    `INSERT INTO circular_acknowledgements (circular_id, parent_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, parentId]);
  if (r.rowCount) {
    await query('UPDATE parents SET engagement_score = LEAST(100, engagement_score + 1) WHERE id = $1', [parentId]);
    await audit(req, { action: 'create', module: 'communication', entityType: 'circular', entityId: id, description: `Parent acknowledged circular "${c.title}"` });
  }
  const a = await one(`SELECT acknowledged_at AS "acknowledgedAt" FROM circular_acknowledgements WHERE circular_id = $1 AND parent_id = $2`, [id, parentId]);
  return { id, acknowledged: true, acknowledgedAt: a?.acknowledgedAt, alreadyAcknowledged: !r.rowCount };
}

// =============================================================================
// Events
// =============================================================================
const EVENT_SELECT = (extra = '') => `
  SELECT${extra} e.id, e.title, e.description, e.event_type AS "eventType", e.starts_on AS "startsOn", e.ends_on AS "endsOn",
         to_char(e.starts_at, 'HH24:MI') AS "startsAt", e.venue, e.audience, e.audience_filter AS "audienceFilter",
         e.campus_id AS "campusId", cp.short_name AS campus, e.status, e.notified_at AS "notifiedAt",
         e.created_at AS "createdAt", u.full_name AS "createdBy"
    FROM events e
    LEFT JOIN campuses cp ON cp.id = e.campus_id
    LEFT JOIN users u ON u.id = e.created_by`;

export async function listEvents(f: Pagination & { when: 'upcoming' | 'past' | 'all'; from?: string; to?: string; status?: string; type?: string; campusId?: string }) {
  const w = new Where();
  if (f.when === 'upcoming') w.add('COALESCE(e.ends_on, e.starts_on) >= current_date');
  if (f.when === 'past') w.add('COALESCE(e.ends_on, e.starts_on) < current_date');
  w.addIf(f.from, 'COALESCE(e.ends_on, e.starts_on) >= ?::date');
  w.addIf(f.to, 'e.starts_on <= ?::date');
  w.addIf(f.status, 'e.status = ?');
  w.addIf(f.type, 'e.event_type = ?');
  if (f.campusId) w.add('(e.campus_id IS NULL OR e.campus_id = ?)', f.campusId);
  if (f.q) w.add('(e.title ILIKE ? OR e.venue ILIKE ? OR e.audience ILIKE ?)', likeTerm(f.q), likeTerm(f.q), likeTerm(f.q));
  const dir = f.sort ? f.dir : f.when === 'past' ? 'desc' : 'asc';
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `${EVENT_SELECT(' count(*) OVER() AS total,')} ${w.sql}
      ORDER BY ${orderBy(f.sort, dir, { date: 'e.starts_on', title: 'e.title', type: 'e.event_type' }, 'date')}, e.starts_at NULLS FIRST, e.id
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params);
  return { rows: strip(rows), total: total(rows) };
}

export async function eventSummary(campusId?: string) {
  return one(
    `SELECT count(*) FILTER (WHERE status = 'Published' AND COALESCE(ends_on, starts_on) >= current_date)::int AS upcoming,
            count(*) FILTER (WHERE status = 'Published' AND starts_on BETWEEN current_date AND current_date + 30)::int AS "next30Days",
            count(*) FILTER (WHERE status = 'Draft')::int AS drafts,
            count(*) FILTER (WHERE status = 'Cancelled' AND COALESCE(ends_on, starts_on) >= current_date)::int AS cancelled
       FROM events WHERE ($1::uuid IS NULL OR campus_id IS NULL OR campus_id = $1::uuid)`, [campusId ?? null]);
}

export async function getEvent(id: string) {
  const e = await one(`${EVENT_SELECT()} WHERE e.id = $1`, [id]);
  if (!e) throw notFound('Event not found', 'EVENT_NOT_FOUND');
  return e;
}

interface EventInput {
  title: string; description?: string | null; eventType: string; startsOn: string; endsOn?: string | null; startsAt?: string | null;
  venue?: string | null; audience: Audience; campusId?: string | null; status: 'Draft' | 'Published';
}

export async function createEvent(req: Request, b: EventInput) {
  const aud = normalizeAudience(b.audience);
  const r = await one<{ id: string }>(
    `INSERT INTO events (campus_id, title, description, event_type, starts_on, ends_on, starts_at, venue, audience, audience_filter, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [b.campusId ?? null, b.title, b.description ?? null, b.eventType, b.startsOn, b.endsOn ?? null, b.startsAt ?? null, b.venue ?? null,
      audienceLabel(aud), JSON.stringify(aud), b.status, req.user!.id]);
  await audit(req, { action: 'create', module: 'communication', entityType: 'event', entityId: r!.id, description: `Created event "${b.title}" on ${b.startsOn} (${b.status})` });
  return getEvent(r!.id);
}

const EVENT_COLS: Record<string, string> = {
  title: 'title', description: 'description', eventType: 'event_type', startsOn: 'starts_on', endsOn: 'ends_on',
  startsAt: 'starts_at', venue: 'venue', campusId: 'campus_id', status: 'status',
};

export async function updateEvent(req: Request, id: string, b: Partial<EventInput>) {
  const e = await getEvent(id);
  if (e.status === 'Cancelled') throw conflict('Cancelled events cannot be edited', 'EVENT_CANCELLED');
  const startsOn = b.startsOn ?? e.startsOn;
  const endsOn = b.endsOn !== undefined ? b.endsOn : e.endsOn;
  if (endsOn && endsOn < startsOn) throw conflict('End date must be on or after the start date', 'INVALID_DATES');
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [k, val] of Object.entries(b)) {
    if (!EVENT_COLS[k] || val === undefined) continue;
    params.push(val);
    sets.push(`${EVENT_COLS[k]} = $${params.length}`);
  }
  if (b.audience) {
    const aud = normalizeAudience(b.audience);
    params.push(audienceLabel(aud), JSON.stringify(aud));
    sets.push(`audience = $${params.length - 1}`, `audience_filter = $${params.length}`);
  }
  if (sets.length) await query(`UPDATE events SET ${sets.join(', ')} WHERE id = $1`, params);
  await audit(req, { action: 'update', module: 'communication', entityType: 'event', entityId: id, description: `Updated event "${b.title ?? e.title}"`, metadata: { fields: Object.keys(b) } });
  return getEvent(id);
}

export async function cancelEvent(req: Request, id: string) {
  const e = await getEvent(id);
  if (e.status === 'Cancelled') throw conflict('This event is already cancelled', 'EVENT_CANCELLED');
  const notified = await tx(async (db) => {
    await query(`UPDATE events SET status = 'Cancelled' WHERE id = $1`, [id], db);
    let n = 0;
    if (e.status === 'Published' && (e.endsOn ?? e.startsOn) >= schoolToday()) {
      n = await notifyAudience(normalizeAudience(e.audienceFilter), e.campusId, {
        category: 'Attention', topic: 'events', icon: 'calendar', title: `Event cancelled: ${e.title}`,
        body: `Originally scheduled for ${e.startsOn}${e.venue ? ` at ${e.venue}` : ''}.`, route: '/parent-360?tab=more',
        entityType: 'event', entityId: id, channels: ['push', 'whatsapp'],
      }, db);
    }
    await audit(req, { action: 'update', module: 'communication', entityType: 'event', entityId: id, description: `Cancelled event "${e.title}"`, metadata: { notified: n } }, db);
    return n;
  });
  return { ...(await getEvent(id)), notified };
}

export async function notifyEvent(req: Request, id: string) {
  const e = await getEvent(id);
  if (e.status !== 'Published') throw conflict('Publish the event before notifying families', 'EVENT_NOT_PUBLISHED');
  const aud = normalizeAudience(e.audienceFilter);
  const notified = await tx(async (db) => {
    const n = await notifyAudience(aud, e.campusId, {
      category: 'Information', topic: 'events', icon: 'calendar', title: e.title,
      body: `${e.startsOn}${e.endsOn && e.endsOn !== e.startsOn ? ` to ${e.endsOn}` : ''}${e.venue ? ` · ${e.venue}` : ''}`,
      route: '/parent-360?tab=more', entityType: 'event', entityId: id, channels: ['push', 'whatsapp'],
    }, db);
    const target = await countAudience(aud, e.campusId, db);
    await query('UPDATE events SET notified_at = now() WHERE id = $1', [id], db);
    await query(
      `INSERT INTO communications (channel, direction, counterpart, subject, status, recipients, sent_by)
       VALUES ('WhatsApp','outbound',$1,$2,'Queued',$3,$4)`,
      [e.audience, `Event: ${e.title}`, target, req.user!.id], db);
    await audit(req, { action: 'create', module: 'communication', entityType: 'event', entityId: id, description: `Notified ${e.audience} about "${e.title}" (${n} app users)` }, db);
    return n;
  });
  return { ...(await getEvent(id)), notified };
}

export async function familyEvents(user: AuthUser) {
  const parentId = selfParentId(user);
  return many(
    `${EVENT_SELECT()}
      WHERE e.status = 'Published' AND COALESCE(e.ends_on, e.starts_on) >= current_date
        AND ${audienceParentSql('e.audience_filter', 'e.campus_id', '$1::uuid')}
      ORDER BY e.starts_on, e.starts_at NULLS FIRST
      LIMIT 50`,
    [parentId]);
}
