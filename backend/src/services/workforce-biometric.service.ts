import crypto from 'node:crypto';
import type { Request } from 'express';
import { many, one, query, tx, type Queryable } from '../config/db.js';
import { badRequest, forbidden, notFound, unauthorized } from '../utils/errors.js';
import { readCsvRecords, type ImportRowResult } from '../utils/csv.js';
import { nextCode } from '../utils/codes.js';
import { audit, clientIp } from './audit.service.js';

/**
 * Biometric staff attendance.
 *  - Machines post punches to POST /api/v1/attendance/punches with their own token
 *    (a bridge such as the vendor's ADMS/push software or a small script relays them).
 *  - Or HR uploads the machine's attendance log as CSV.
 * Each punch is stored once; the day's check-in is the first punch and check-out the
 * last, and arrival more than 15 minutes after the shift start is Late (as for mobile check-in).
 */
const TOKEN_PREFIX = 'hsb_';
const TZ = 'Asia/Kolkata';
const hash = (t: string) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
const newToken = () => TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');

// ---------------------------------------------------------------------------
// Device registry (HR)
// ---------------------------------------------------------------------------
export async function listDevices(campusId?: string) {
  return many(
    `SELECT d.id, d.device_code AS "deviceCode", d.name, d.location, d.status, cp.short_name AS campus, d.campus_id AS "campusId",
            d.last_seen_at AS "lastSeenAt", d.token_issued_at AS "tokenIssuedAt", (d.token_hash IS NOT NULL) AS "hasToken",
            (SELECT count(*) FROM staff_attendance_punches p WHERE p.device_id = d.id AND p.punched_at > now() - interval '1 day')::int AS "punchesToday"
       FROM biometric_devices d LEFT JOIN campuses cp ON cp.id = d.campus_id
      WHERE ($1::uuid IS NULL OR d.campus_id = $1) ORDER BY d.device_code`, [campusId ?? null]);
}

export async function registerDevice(req: Request, b: { name: string; campusId?: string | null; location?: string | null }) {
  const token = newToken();
  const d = await tx(async (db) => {
    const code = await nextCode('biometric_devices', 'device_code', 'BIO-', db);
    const row = await one<{ id: string; device_code: string }>(
      `INSERT INTO biometric_devices (device_code, name, campus_id, location, token_hash, token_issued_at, created_by)
       VALUES ($1, $2, $3, $4, $5, now(), $6) RETURNING id, device_code`,
      [code, b.name, b.campusId ?? null, b.location ?? null, hash(token), req.user!.id], db);
    await audit(req, { action: 'create', module: 'workforce', description: `Registered biometric device ${code} (${b.name})`, entityType: 'biometric_device', entityId: row!.id }, db);
    return row!;
  });
  return { id: d.id, deviceCode: d.device_code, token };
}

export async function regenerateDeviceToken(req: Request, id: string) {
  const token = newToken();
  const d = await one<{ device_code: string }>(
    `UPDATE biometric_devices SET token_hash = $2, token_issued_at = now() WHERE id = $1 RETURNING device_code`, [id, hash(token)]);
  if (!d) throw notFound('Device not found');
  await audit(req, { action: 'update', module: 'workforce', description: `Issued a new token for biometric device ${d.device_code}`, entityType: 'biometric_device', entityId: id });
  return { deviceCode: d.device_code, token };
}

export async function setDeviceStatus(req: Request, id: string, status: 'active' | 'inactive') {
  const d = await one<{ device_code: string }>(`UPDATE biometric_devices SET status = $2 WHERE id = $1 RETURNING device_code`, [id, status]);
  if (!d) throw notFound('Device not found');
  await audit(req, { action: 'update', module: 'workforce', description: `Biometric device ${d.device_code} set ${status}`, entityType: 'biometric_device', entityId: id });
  return { status };
}

// ---------------------------------------------------------------------------
// Punches → day record
// ---------------------------------------------------------------------------
/** Re-derives one employee-day from its punches. Days on approved leave are left alone. */
async function rebuildDay(db: Queryable, employeeId: string, date: string) {
  await query(
    `WITH p AS (
       SELECT min((punched_at AT TIME ZONE '${TZ}')::time(0)) AS first_t, max((punched_at AT TIME ZONE '${TZ}')::time(0)) AS last_t, count(*) AS n
         FROM staff_attendance_punches WHERE employee_id = $1 AND (punched_at AT TIME ZONE '${TZ}')::date = $2::date)
     INSERT INTO staff_attendance (employee_id, attendance_date, status, check_in, check_out, source)
     SELECT e.id, $2::date,
            CASE WHEN s.starts_at IS NOT NULL AND p.first_t > s.starts_at + interval '15 minutes'
                  AND p.first_t < COALESCE(s.split_starts_at, '23:59'::time) THEN 'Late' ELSE 'Present' END,
            p.first_t, CASE WHEN p.n > 1 THEN p.last_t END, 'biometric'
       FROM employees e LEFT JOIN shifts s ON s.name = e.shift_name CROSS JOIN p
      WHERE e.id = $1 AND p.n > 0
     ON CONFLICT (employee_id, attendance_date) DO UPDATE
       SET check_in = EXCLUDED.check_in, check_out = EXCLUDED.check_out, source = 'biometric',
           status = CASE WHEN staff_attendance.status = 'Half Day' THEN staff_attendance.status ELSE EXCLUDED.status END
     WHERE staff_attendance.status <> 'On Leave'`,
    [employeeId, date], db);
}

interface Punch { employeeId: string; at: Date; direction: 'in' | 'out' | 'auto' }

/** Stores punches (duplicates ignored) and rebuilds each affected day. Returns how many were new. */
async function storePunches(db: Queryable, punches: Punch[], source: 'device' | 'import', deviceId: string | null, userId: string | null) {
  let added = 0;
  const days = new Set<string>();
  for (const p of punches) {
    const r = await query(
      `INSERT INTO staff_attendance_punches (employee_id, punched_at, direction, source, device_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (employee_id, punched_at) DO NOTHING`,
      [p.employeeId, p.at.toISOString(), p.direction, source, deviceId, userId], db);
    added += r.rowCount ?? 0;
    days.add(`${p.employeeId}|${p.at.toLocaleDateString('en-CA', { timeZone: TZ })}`);
  }
  for (const d of days) {
    const [emp, date] = d.split('|');
    await rebuildDay(db, emp, date);
  }
  return { added, days: days.size };
}

/** "2026-11-03T08:12:00+05:30", "2026-11-03 08:12[:ss]" (school time), or epoch seconds. */
export function parsePunchTime(s: string): Date | null {
  const t = s.trim();
  if (/^\d{9,10}$/.test(t)) return new Date(Number(t) * 1000);
  const local = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (local) {
    const [, y, mo, d, h, mi, se] = local;
    const dt = new Date(`${y}-${mo}-${d}T${h.padStart(2, '0')}:${mi}:${se ?? '00'}+05:30`);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(t)) {
    const dt = new Date(t);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  return null;
}

/** Punches more than 5 minutes in the future or older than 45 days are refused. */
function punchTimeError(at: Date) {
  const now = Date.now();
  if (at.getTime() > now + 5 * 60_000) return 'Punch time is in the future — check the machine clock';
  if (at.getTime() < now - 45 * 86_400_000) return 'Punch is older than 45 days';
  return null;
}

// ---------------------------------------------------------------------------
// POST /api/v1/attendance/punches — machine (or its bridge) with a device token
// ---------------------------------------------------------------------------
export interface PunchBody { device_id: string; punches: { employee_code: string; punched_at: string; direction?: 'in' | 'out' | 'auto' }[] }

export async function ingestPunches(req: Request, body: PunchBody) {
  const [kind, token] = (req.get('authorization') || '').split(' ');
  const device = kind === 'Bearer' && token?.startsWith(TOKEN_PREFIX) && token.length < 200
    ? await one<{ id: string; device_code: string; status: string; token_hash: string | null; campus_id: string | null }>(
      'SELECT id, device_code, status, token_hash, campus_id FROM biometric_devices WHERE device_code = $1', [body.device_id])
    : null;
  const ok = !!device?.token_hash && crypto.timingSafeEqual(Buffer.from(device.token_hash, 'hex'), Buffer.from(hash(token!), 'hex'));
  if (!device || !ok) {
    await audit(req, { action: 'device_auth_failed', module: 'workforce', description: 'Biometric device authentication failed', entityType: 'biometric_device', metadata: { deviceCode: body.device_id } },
      undefined, { id: null, name: `Device ${body.device_id}`, role: 'device' });
    // Same answer for an unknown device and a wrong token, so neither can be probed.
    throw unauthorized('Invalid device credentials', 'DEVICE_AUTH_FAILED');
  }
  if (device.status !== 'active') throw forbidden(`Device ${device.device_code} is inactive`, 'DEVICE_INACTIVE');
  await query('UPDATE biometric_devices SET last_seen_at = now(), last_ip = $2 WHERE id = $1', [device.id, clientIp(req)]);

  const codes = [...new Set(body.punches.map((p) => p.employee_code.trim().toUpperCase()))];
  const emps = await many<{ id: string; code: string }>(
    `SELECT id, upper(employee_code) AS code FROM employees WHERE upper(employee_code) = ANY($1) AND deleted_at IS NULL`, [codes]);
  const byCode = new Map(emps.map((e) => [e.code, e.id]));
  const rejected: { index: number; employee_code: string; reason: string }[] = [];
  const good: Punch[] = [];
  body.punches.forEach((p, i) => {
    const employeeId = byCode.get(p.employee_code.trim().toUpperCase());
    const at = parsePunchTime(p.punched_at);
    const why = !employeeId ? 'Unknown employee code' : !at ? 'Unreadable punched_at' : punchTimeError(at);
    if (why) rejected.push({ index: i, employee_code: p.employee_code, reason: why });
    else good.push({ employeeId: employeeId!, at: at!, direction: p.direction ?? 'auto' });
  });
  const out = good.length ? await tx((db) => storePunches(db, good, 'device', device.id, null)) : { added: 0, days: 0 };
  return { device_id: device.device_code, received: body.punches.length, stored: out.added, duplicates: good.length - out.added, rejected };
}

// ---------------------------------------------------------------------------
// CSV import of a machine's attendance log (HR)
// ---------------------------------------------------------------------------
export const PUNCH_COLUMNS = ['employeeCode', 'date', 'time', 'direction'] as const;
export const PUNCH_EXAMPLE = [
  { employeeCode: 'EMP-1001', date: '2026-11-03', time: '08:05', direction: 'in' },
  { employeeCode: 'EMP-1001', date: '2026-11-03', time: '16:32', direction: 'out' },
  { employeeCode: 'EMP-1002', date: '03/11/2026', time: '08:41' },
];

export async function importPunches(req: Request, file: Express.Multer.File | undefined, opts: { dryRun: boolean }) {
  const records = readCsvRecords(file, { columns: PUNCH_COLUMNS, required: ['employeeCode', 'date', 'time'], maxRows: 5000, what: 'punch' });
  const emps = await many<{ id: string; code: string; name: string }>(
    `SELECT id, upper(employee_code) AS code, full_name AS name FROM employees WHERE deleted_at IS NULL`);
  const byCode = new Map(emps.map((e) => [e.code, e]));
  const results: ImportRowResult[] = [];
  const punches: Punch[] = [];
  for (const { row, rec } of records) {
    const errors: { field: string; message: string }[] = [];
    const emp = byCode.get((rec.employeeCode ?? '').toUpperCase());
    if (!emp) errors.push({ field: 'employeeCode', message: `No staff member with code "${rec.employeeCode}"` });
    let date = rec.date ?? '';
    const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(date);
    if (dmy) date = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    const at = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{1,2}:\d{2}(:\d{2})?$/.test(rec.time ?? '') ? parsePunchTime(`${date} ${rec.time}`) : null;
    if (!at) errors.push({ field: 'date', message: 'Use date 2026-11-03 or 03/11/2026 and time 08:05' });
    else { const why = punchTimeError(at); if (why) errors.push({ field: 'date', message: why }); }
    const direction = (rec.direction || 'auto').toLowerCase();
    if (!['in', 'out', 'auto'].includes(direction)) errors.push({ field: 'direction', message: 'Use in, out or leave blank' });
    const label = emp ? `${emp.name} · ${rec.date} ${rec.time}` : `${rec.employeeCode ?? ''}`;
    if (errors.length) { results.push({ row, label, ok: false, errors }); continue; }
    punches.push({ employeeId: emp!.id, at: at!, direction: direction as Punch['direction'] });
    results.push({ row, label, ok: true });
  }
  const failed = results.filter((r) => !r.ok).length;
  if (opts.dryRun || failed) return { dryRun: opts.dryRun, rows: records.length, valid: records.length - failed, failed, imported: 0, duplicates: 0, days: 0, results };
  const out = await tx(async (db) => {
    const r = await storePunches(db, punches, 'import', null, req.user!.id);
    await audit(req, { action: 'create', module: 'workforce', description: `Imported ${r.added} biometric punch${r.added === 1 ? '' : 'es'} (${r.days} staff-days) from ${(file!.originalname).replace(/[^\w.\- ]/g, '')}`, metadata: { rows: records.length, ...r } }, db);
    return r;
  });
  return { dryRun: false, rows: records.length, valid: records.length, failed: 0, imported: out.added, duplicates: punches.length - out.added, days: out.days, results };
}

/** The raw punches behind one staff member's day (for HR to check a disputed record). */
export async function dayPunches(employeeId: string, date: string) {
  const e = await one('SELECT 1 FROM employees WHERE id = $1', [employeeId]);
  if (!e) throw notFound('Employee not found');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('Use YYYY-MM-DD');
  return many(
    `SELECT p.id, to_char(p.punched_at AT TIME ZONE '${TZ}', 'HH24:MI:SS') AS time, p.direction, p.source, d.device_code AS device
       FROM staff_attendance_punches p LEFT JOIN biometric_devices d ON d.id = p.device_id
      WHERE p.employee_id = $1 AND (p.punched_at AT TIME ZONE '${TZ}')::date = $2::date ORDER BY p.punched_at`, [employeeId, date]);
}
