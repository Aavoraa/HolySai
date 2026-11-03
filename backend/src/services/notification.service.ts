import { many, query, type Queryable } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { sendWhatsApp, whatsappNumber } from './whatsapp.provider.js';

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

/** Adapters that actually send. Channels without one stay queued until an adapter is added. */
const ADAPTERS: Partial<Record<Channel, (d: OutboxRow) => Promise<string | null>>> = {
  whatsapp: (d) => sendWhatsApp({ to: d.destination, title: d.title, body: d.body, reference: d.id }),
};

interface OutboxRow { id: string; channel: Channel; attempts: number; destination: string; title: string; body: string | null }

const MAX_ATTEMPTS = 5;

/**
 * Outbox dispatcher. No external service is called unless its credentials are
 * configured and an adapter exists; otherwise pending rows stay queued so nothing
 * is lost when a provider is added later. Failures retry with backoff, then fail.
 */
export async function dispatchPending(limit = 50) {
  const ready = (Object.keys(ADAPTERS) as Channel[]).filter((c) => PROVIDER_CONFIGURED[c]());
  if (!ready.length) return 0;
  // Alerts are time-sensitive: anything queued over a day ago (e.g. the backlog from before a
  // provider was connected) is expired rather than sent late.
  await query(
    `UPDATE notification_deliveries SET status = 'skipped', last_error = 'Expired: queued more than 24 hours ago', updated_at = now()
      WHERE status = 'pending' AND channel = ANY($1) AND created_at < now() - interval '24 hours'`,
    [ready],
  );
  // The recipient's own number: a parent's or staff member's record first, then the login.
  const rows = await many<OutboxRow & { phone: string | null }>(
    `SELECT d.id, d.channel, d.attempts, n.title, n.body,
            COALESCE(NULLIF(d.destination, ''), p.phone, e.phone, u.phone) AS phone
       FROM notification_deliveries d
       JOIN notifications n ON n.id = d.notification_id
       JOIN users u ON u.id = n.user_id
       LEFT JOIN parents p ON p.user_id = u.id AND p.deleted_at IS NULL
       LEFT JOIN employees e ON e.user_id = u.id AND e.deleted_at IS NULL
      WHERE d.status = 'pending' AND d.next_attempt_at <= now() AND d.channel = ANY($2)
      ORDER BY d.next_attempt_at LIMIT $1`,
    [limit, ready],
  );
  for (const row of rows) {
    const to = row.channel === 'whatsapp' ? whatsappNumber(row.phone) : row.phone;
    if (!to) {
      await query(`UPDATE notification_deliveries SET status = 'skipped', last_error = 'No usable phone number for this user', updated_at = now() WHERE id = $1`, [row.id]);
      continue;
    }
    try {
      const ref = await ADAPTERS[row.channel]!({ ...row, destination: to });
      await query(
        `UPDATE notification_deliveries SET status = 'sent', destination = $2, provider = $3, provider_ref = $4,
                attempts = attempts + 1, last_error = NULL, updated_at = now() WHERE id = $1`,
        [row.id, to, row.channel === 'whatsapp' ? `whatsapp:${env.WHATSAPP_PROVIDER}` : row.channel, ref],
      );
    } catch (err) {
      const failed = row.attempts + 1 >= MAX_ATTEMPTS;
      await query(
        `UPDATE notification_deliveries SET attempts = attempts + 1, last_error = $2, destination = $3, updated_at = now(),
                status = CASE WHEN $4 THEN 'failed' ELSE status END,
                next_attempt_at = now() + (interval '1 minute' * power(2, attempts)) WHERE id = $1`,
        [row.id, (err as Error).message.slice(0, 500), to, failed],
      );
      logger.warn({ delivery: row.id, channel: row.channel, attempt: row.attempts + 1, err: (err as Error).message }, 'delivery failed');
    }
  }
  return rows.length;
}
