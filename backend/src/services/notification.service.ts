import { many, query, type Queryable } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export type Category = 'Critical' | 'Attention' | 'Information' | 'Completed';
export type Tone = 'critical' | 'warning' | 'caution' | 'info' | 'success' | 'neutral';
export type Channel = 'whatsapp' | 'sms' | 'email' | 'push';

export interface NotifyInput {
  category: Category;
  tone?: Tone;
  icon?: string;
  topic: string;          // attendance | tracking | fees | admissions | safety | system …
  title: string;
  body?: string;
  route?: string;
  entityType?: string;
  entityId?: string;
  channels?: Channel[];   // external channels to queue in addition to in-app
}

const TONE_FOR: Record<Category, Tone> = { Critical: 'critical', Attention: 'warning', Information: 'info', Completed: 'success' };

/**
 * In-app notification + outbox rows for external channels. External
 * deliveries are only queued here; a dispatcher sends them when provider
 * credentials exist (see dispatchPending). Respects per-topic preferences.
 */
export async function notifyUsers(userIds: string[], n: NotifyInput, db?: Queryable) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return [];
  const prefs = await many<{ user_id: string; in_app: boolean; whatsapp: boolean; sms: boolean; email: boolean; push: boolean }>(
    'SELECT user_id, in_app, whatsapp, sms, email, push FROM notification_preferences WHERE topic = $1 AND user_id = ANY($2)',
    [n.topic, ids],
    db,
  );
  const prefBy = new Map(prefs.map((p) => [p.user_id, p]));
  const out: string[] = [];
  for (const uid of ids) {
    const pref = prefBy.get(uid);
    // Critical safety notifications are always delivered in-app.
    if (pref && !pref.in_app && n.category !== 'Critical') continue;
    const r = await query<{ id: string }>(
      `INSERT INTO notifications (user_id, category, tone, icon, topic, title, body, route, entity_type, entity_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [uid, n.category, n.tone ?? TONE_FOR[n.category], n.icon ?? 'bell', n.topic, n.title, n.body ?? null, n.route ?? null, n.entityType ?? null, n.entityId ?? null],
      db,
    );
    const nid = r.rows[0].id;
    out.push(nid);
    for (const ch of n.channels ?? []) {
      if (pref && pref[ch] === false) continue;
      await query(`INSERT INTO notification_deliveries (notification_id, channel, status) VALUES ($1, $2, 'pending')`, [nid, ch], db);
    }
  }
  return out;
}

/** Notifies every active user holding a role (e.g. all principals). */
export async function notifyRoles(roleKeys: string[], n: NotifyInput, db?: Queryable) {
  const users = await many<{ id: string }>(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
      WHERE r.key = ANY($1) AND u.status = 'active' AND u.deleted_at IS NULL`,
    [roleKeys],
    db,
  );
  return notifyUsers(users.map((u) => u.id), n, db);
}

/**
 * Notifies the guardians (with user accounts) of a student. Location alerts
 * (topic 'tracking') go only to guardians allowed to see the child's tracking.
 */
export async function notifyGuardians(studentId: string, n: NotifyInput, db?: Queryable) {
  const users = await many<{ user_id: string }>(
    `SELECT p.user_id FROM student_guardians sg JOIN parents p ON p.id = sg.parent_id
      WHERE sg.student_id = $1 AND p.user_id IS NOT NULL AND p.deleted_at IS NULL
        AND ($2::boolean = false OR sg.can_view_tracking)`,
    [studentId, n.topic === 'tracking'],
    db,
  );
  return notifyUsers(users.map((u) => u.user_id), { channels: ['whatsapp', 'push'], ...n }, db);
}

const PROVIDER_CONFIGURED: Record<Channel, () => boolean> = {
  whatsapp: () => !!(env.WHATSAPP_API_URL && env.WHATSAPP_API_TOKEN),
  sms: () => !!(env.SMS_API_URL && env.SMS_API_KEY),
  email: () => !!env.SMTP_URL,
  push: () => !!env.PUSH_FCM_SERVER_KEY,
};

/**
 * Outbox dispatcher. No external service is called unless its credentials are
 * configured; otherwise pending rows stay queued so nothing is lost when a
 * provider is added later. Provider adapters plug in at `send`.
 */
export async function dispatchPending(limit = 50) {
  const rows = await many<{ id: string; channel: Channel }>(
    `SELECT id, channel FROM notification_deliveries
      WHERE status = 'pending' AND next_attempt_at <= now()
      ORDER BY next_attempt_at LIMIT $1`,
    [limit],
  );
  for (const row of rows) {
    if (!PROVIDER_CONFIGURED[row.channel]()) continue;
    try {
      // Provider adapter goes here (WhatsApp Business API, SMS gateway, SMTP, FCM).
      logger.info({ delivery: row.id, channel: row.channel }, 'delivery adapter not implemented; leaving queued');
    } catch (err) {
      await query(
        `UPDATE notification_deliveries SET attempts = attempts + 1, last_error = $2,
                next_attempt_at = now() + (interval '1 minute' * power(2, attempts)) WHERE id = $1`,
        [row.id, (err as Error).message],
      );
    }
  }
  return rows.length;
}
