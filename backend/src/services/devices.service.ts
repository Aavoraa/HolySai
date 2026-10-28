import crypto from 'node:crypto';
import type { Request } from 'express';
import { many, one, query, tx, type Queryable } from '../config/db.js';
import { env } from '../config/env.js';
import { Where } from '../utils/sql.js';
import { likeTerm, limitOffset, orderBy, type Pagination } from '../utils/pagination.js';
import { AppError, conflict, forbidden, notFound, unauthorized } from '../utils/errors.js';
import { nextCode } from '../utils/codes.js';
import { resolveStudentId } from './access.service.js';
import { audit, clientIp } from './audit.service.js';
import { checkRecordedAt, gpsStatusSql, haversineMetres, storeLocation, trackingAllowed, type GpsStatus } from './tracking.service.js';

// ---------------------------------------------------------------------------
// Device tokens
// ---------------------------------------------------------------------------
// A token is 256 random bits, so a plain SHA-256 is enough to store it safely:
// there is nothing to brute-force. Only the hash is kept; the token is shown once.
const TOKEN_PREFIX = 'hsd_';

export function newDeviceToken() {
  return TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
}

export function hashDeviceToken(token: string) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function sameHash(a: string, b: string) {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEVICE_SQL = `
  SELECT d.id, d.device_code AS "deviceCode", d.imei, d.serial_number AS "serialNumber", d.device_type AS "deviceType",
         d.firmware_version AS "firmwareVersion", d.campus_id AS "campusId", cp.short_name AS "campusName",
         d.status, d.last_seen_at AS "lastSeenAt", d.last_battery_pct AS "batteryPct", d.notes,
         d.token_hash IS NOT NULL AS "hasToken", d.token_issued_at AS "tokenIssuedAt", d.is_sample_data AS "isSampleData",
         d.created_at AS "createdAt",
         ${gpsStatusSql('d.last_seen_at')} AS "gpsStatus",
         da.id AS "assignmentId", da.assigned_at AS "assignedAt",
         s.id AS "studentId", s.admission_no AS "admissionNo", s.full_name AS "studentName",
         c.name AS grade, sec.name AS section
    FROM gps_devices d
    LEFT JOIN campuses cp ON cp.id = d.campus_id
    LEFT JOIN device_assignments da ON da.device_id = d.id AND da.status = 'active'
    LEFT JOIN students s ON s.id = da.student_id
    LEFT JOIN sections sec ON sec.id = s.section_id
    LEFT JOIN classes c ON c.id = sec.class_id`;

export interface DeviceFilters extends Pagination {
  status?: string;
  deviceType?: string;
  gpsStatus?: GpsStatus;
  campusId?: string;
}

const DEVICE_SORTS: Record<string, string> = {
  code: 'd.device_code',
  type: 'd.device_type',
  status: 'd.status',
  student: 's.full_name',
  seen: 'd.last_seen_at',
  battery: 'd.last_battery_pct',
};

export async function listDevices(f: DeviceFilters) {
  const w = new Where();
  w.addIf(f.status, 'd.status = ?');
  w.addIf(f.deviceType, 'd.device_type = ?');
  w.addIf(f.campusId, 'd.campus_id = ?');
  if (f.gpsStatus) w.add(`${gpsStatusSql('d.last_seen_at')} = ?`, f.gpsStatus);
  if (f.q) {
    const t = likeTerm(f.q);
    w.add('(d.device_code ILIKE ? OR d.imei ILIKE ? OR d.serial_number ILIKE ? OR s.full_name ILIKE ? OR s.admission_no ILIKE ?)', t, t, t, t, t);
  }
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT q.*, count(*) OVER() AS total FROM (${DEVICE_SQL} ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, DEVICE_SORTS, 'code')}, d.device_code) q
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

async function resolveDevice(idOrCode: string, db?: Queryable, lock = false) {
  const col = UUID_RE.test(idOrCode) ? 'id' : 'device_code';
  const row = await one<{ id: string; device_code: string; status: string }>(
    `SELECT id, device_code, status FROM gps_devices WHERE ${col} = $1 ${lock ? 'FOR UPDATE' : ''}`,
    [col === 'device_code' ? idOrCode.toUpperCase() : idOrCode], db,
  );
  if (!row) throw notFound('Device not found', 'DEVICE_NOT_FOUND');
  return row;
}

export async function getDevice(idOrCode: string) {
  const d = await resolveDevice(idOrCode);
  const device = await one(`${DEVICE_SQL} WHERE d.id = $1`, [d.id]);
  const history = await many(
    `SELECT da.id, da.status, da.assigned_at AS "assignedAt", da.unassigned_at AS "unassignedAt",
            da.unassign_reason AS "unassignReason", da.notes,
            s.id AS "studentId", s.admission_no AS "admissionNo", s.full_name AS "studentName",
            ab.full_name AS "assignedBy", ub.full_name AS "unassignedBy",
            (SELECT count(*)::int FROM student_locations l
              WHERE l.device_id = da.device_id AND l.student_id = da.student_id) AS "locationCount"
       FROM device_assignments da
       JOIN students s ON s.id = da.student_id
       LEFT JOIN users ab ON ab.id = da.assigned_by
       LEFT JOIN users ub ON ub.id = da.unassigned_by
      WHERE da.device_id = $1
      ORDER BY da.assigned_at DESC, da.created_at DESC`,
    [d.id],
  );
  return { ...device, assignments: history };
}

/**
 * What a scanned QR (or a typed box) refers to. Matches the device code
 * first, then the IMEI or serial number, so a manufacturer's own label works too.
 */
export async function lookupDevice(raw: string) {
  const code = parseScannedCode(raw);
  const row = await one(
    `${DEVICE_SQL}
      WHERE d.device_code = upper($1) OR d.imei = $1 OR d.serial_number = $1
      ORDER BY (d.device_code = upper($1)) DESC LIMIT 1`,
    [code],
  );
  if (!row) throw notFound(`No registered device matches "${code}"`, 'DEVICE_NOT_FOUND');
  return row;
}

/** QR labels may carry a bare code, a `HSDEV:` prefix or a URL ending in the code. */
export function parseScannedCode(raw: string) {
  let s = raw.trim();
  const prefixed = /^HSDEV:(.+)$/i.exec(s);
  if (prefixed) s = prefixed[1];
  else if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      s = u.searchParams.get('device') ?? u.pathname.split('/').filter(Boolean).pop() ?? s;
    } catch { /* not a URL after all */ }
  }
  return s.trim().slice(0, 100);
}

// ---------------------------------------------------------------------------
// Registration and maintenance
// ---------------------------------------------------------------------------
export interface DeviceInput {
  deviceCode?: string;
  imei?: string | null;
  serialNumber?: string | null;
  deviceType?: string;
  firmwareVersion?: string | null;
  campusId?: string | null;
  notes?: string | null;
}

export async function registerDevice(req: Request, input: DeviceInput) {
  const token = newDeviceToken();
  const device = await tx(async (db) => {
    const code = input.deviceCode ?? (await nextCode('gps_devices', 'device_code', 'GPS', db, 6));
    const exists = await one('SELECT 1 FROM gps_devices WHERE device_code = $1', [code], db);
    if (exists) throw conflict(`Device ${code} is already registered`, 'DEVICE_EXISTS');
    const row = await one<{ id: string }>(
      `INSERT INTO gps_devices (device_code, imei, serial_number, device_type, firmware_version, campus_id, notes,
                                token_hash, token_issued_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now(), $9) RETURNING id`,
      [code, input.imei ?? null, input.serialNumber ?? null, input.deviceType ?? 'gps_tracker', input.firmwareVersion ?? null,
        input.campusId ?? req.user?.campusId ?? null, input.notes ?? null, hashDeviceToken(token), req.user!.id],
      db,
    );
    await audit(req, {
      action: 'create', module: 'devices', description: `Registered GPS device ${code}`,
      entityType: 'gps_device', entityId: row!.id, metadata: { deviceType: input.deviceType, imei: input.imei ?? null },
    }, db);
    return row!;
  });
  return { device: await one(`${DEVICE_SQL} WHERE d.id = $1`, [device.id]), token };
}

/** Issues a new token; the old one stops working immediately. */
export async function regenerateToken(req: Request, idOrCode: string) {
  const d = await resolveDevice(idOrCode);
  const token = newDeviceToken();
  await query('UPDATE gps_devices SET token_hash = $2, token_issued_at = now() WHERE id = $1', [d.id, hashDeviceToken(token)]);
  await audit(req, {
    action: 'update', module: 'devices', description: `Issued a new token for device ${d.device_code}`,
    entityType: 'gps_device', entityId: d.id,
  });
  return { deviceId: d.id, deviceCode: d.device_code, token };
}

export async function updateDevice(req: Request, idOrCode: string, input: DeviceInput & { status?: string; reason?: string }) {
  return tx(async (db) => {
    const d = await resolveDevice(idOrCode, db, true);
    const sets: string[] = [];
    const params: unknown[] = [d.id];
    const set = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (input.imei !== undefined) set('imei', input.imei);
    if (input.serialNumber !== undefined) set('serial_number', input.serialNumber || null);
    if (input.deviceType !== undefined) set('device_type', input.deviceType);
    if (input.firmwareVersion !== undefined) set('firmware_version', input.firmwareVersion || null);
    if (input.campusId !== undefined) set('campus_id', input.campusId);
    if (input.notes !== undefined) set('notes', input.notes || null);

    if (input.status && input.status !== d.status) {
      const active = await one<{ id: string }>(
        `SELECT id FROM device_assignments WHERE device_id = $1 AND status = 'active'`, [d.id], db,
      );
      if (input.status === 'available' && active) {
        throw conflict('Unassign the device before marking it available', 'DEVICE_ASSIGNED');
      }
      // A device taken out of service (inactive, maintenance, lost) leaves the student.
      if (active) await closeAssignment(req, db, active.id, `Device marked ${input.status}${input.reason ? ` — ${input.reason}` : ''}`);
      set('status', input.status);
    }
    if (sets.length) await query(`UPDATE gps_devices SET ${sets.join(', ')} WHERE id = $1`, params, db);
    await audit(req, {
      action: 'update', module: 'devices',
      description: input.status && input.status !== d.status ? `Marked device ${d.device_code} ${input.status}` : `Updated device ${d.device_code}`,
      entityType: 'gps_device', entityId: d.id, metadata: { ...input },
    }, db);
    return d.id;
  }).then((id) => one(`${DEVICE_SQL} WHERE d.id = $1`, [id]));
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------
async function closeAssignment(req: Request, db: Queryable, assignmentId: string, reason?: string) {
  const row = await one<{ device_id: string }>(
    `UPDATE device_assignments SET status = 'inactive', unassigned_at = now(), unassigned_by = $2, unassign_reason = $3
      WHERE id = $1 AND status = 'active' RETURNING device_id`,
    [assignmentId, req.user?.id ?? null, reason ?? null], db,
  );
  if (row) {
    await query(`UPDATE gps_devices SET status = 'available' WHERE id = $1 AND status = 'assigned'`, [row.device_id], db);
  }
  return row;
}

export interface AssignInput {
  studentId: string;
  deviceId: string;
  notes?: string;
  reassign?: boolean;
}

/**
 * Links a device to a student. A device that is with someone else, or a
 * student who already has a device, needs `reassign: true` — the API answers
 * 409 with who currently holds it so the UI can ask first.
 */
export async function assignDevice(req: Request, input: AssignInput) {
  const studentId = await resolveStudentId(input.studentId);
  const result = await tx(async (db) => {
    const device = await resolveDevice(input.deviceId, db, true);
    if (!['available', 'assigned'].includes(device.status)) {
      throw conflict(`Device ${device.device_code} is ${device.status} and cannot be assigned`, 'DEVICE_NOT_AVAILABLE');
    }
    const student = await one<{ full_name: string; admission_no: string; status: string }>(
      'SELECT full_name, admission_no, status FROM students WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [studentId], db,
    );
    if (!student) throw notFound('Student not found', 'STUDENT_NOT_FOUND');
    if (student.status !== 'active') throw conflict(`${student.full_name} is not an active student`, 'STUDENT_INACTIVE');

    const onDevice = await one<{ id: string; student_id: string; full_name: string; admission_no: string }>(
      `SELECT da.id, da.student_id, s.full_name, s.admission_no FROM device_assignments da JOIN students s ON s.id = da.student_id
        WHERE da.device_id = $1 AND da.status = 'active'`, [device.id], db,
    );
    if (onDevice?.student_id === studentId) {
      throw conflict(`${device.device_code} is already assigned to ${student.full_name}`, 'ALREADY_ASSIGNED');
    }
    const studentHas = await one<{ id: string; device_code: string }>(
      `SELECT da.id, d.device_code FROM device_assignments da JOIN gps_devices d ON d.id = da.device_id
        WHERE da.student_id = $1 AND da.status = 'active'`, [studentId], db,
    );
    if ((onDevice || studentHas) && !input.reassign) {
      const parts = [
        onDevice ? `${device.device_code} is assigned to ${onDevice.full_name} (${onDevice.admission_no})` : null,
        studentHas ? `${student.full_name} already has device ${studentHas.device_code}` : null,
      ].filter(Boolean);
      throw new AppError(409, 'REASSIGN_REQUIRED', `${parts.join('. ')}. Confirm to reassign.`, {
        device: onDevice ? { assignedTo: onDevice.full_name, admissionNo: onDevice.admission_no } : null,
        student: studentHas ? { currentDevice: studentHas.device_code } : null,
      });
    }
    if (onDevice) await closeAssignment(req, db, onDevice.id, `Reassigned to ${student.admission_no}`);
    if (studentHas) await closeAssignment(req, db, studentHas.id, `Replaced by ${device.device_code}`);

    const row = await one<{ id: string }>(
      `INSERT INTO device_assignments (student_id, device_id, assigned_by, notes) VALUES ($1,$2,$3,$4) RETURNING id`,
      [studentId, device.id, req.user!.id, input.notes ?? null], db,
    );
    await query(`UPDATE gps_devices SET status = 'assigned' WHERE id = $1`, [device.id], db);
    // Carrying a device means the student is tracked; an existing profile keeps its
    // consent and enabled/disabled choice, only the device type follows the device.
    await query(
      `INSERT INTO student_tracking_profiles (student_id, tracking_enabled, tracking_status, device_type)
       SELECT $1, true, 'active', CASE d.device_type WHEN 'gps_tracker' THEN 'gps_tracker' ELSE d.device_type END
         FROM gps_devices d WHERE d.id = $2
       ON CONFLICT (student_id) DO UPDATE SET device_type = EXCLUDED.device_type`,
      [studentId, device.id], db,
    );
    await audit(req, {
      action: 'create', module: 'devices',
      description: `Assigned device ${device.device_code} to ${student.full_name} (${student.admission_no})`,
      entityType: 'student', entityId: studentId,
      metadata: { assignmentId: row!.id, deviceCode: device.device_code, reassignedFrom: onDevice?.admission_no ?? null, replacedDevice: studentHas?.device_code ?? null },
    }, db);
    return row!.id;
  });
  return getAssignment(result);
}

export async function unassignDevice(req: Request, assignmentId: string, reason?: string) {
  await tx(async (db) => {
    const a = await one<{ status: string; device_code: string; full_name: string; admission_no: string; student_id: string }>(
      `SELECT da.status, d.device_code, s.full_name, s.admission_no, s.id AS student_id
         FROM device_assignments da JOIN gps_devices d ON d.id = da.device_id JOIN students s ON s.id = da.student_id
        WHERE da.id = $1 FOR UPDATE OF da`, [assignmentId], db,
    );
    if (!a) throw notFound('Assignment not found', 'ASSIGNMENT_NOT_FOUND');
    if (a.status !== 'active') throw conflict('This assignment has already ended', 'ASSIGNMENT_INACTIVE');
    await closeAssignment(req, db, assignmentId, reason ?? 'Unassigned');
    await audit(req, {
      action: 'update', module: 'devices',
      description: `Unassigned device ${a.device_code} from ${a.full_name} (${a.admission_no})`,
      entityType: 'student', entityId: a.student_id, metadata: { assignmentId, reason: reason ?? null },
    }, db);
  });
  return getAssignment(assignmentId);
}

const ASSIGNMENT_SQL = `
  SELECT da.id, da.status, da.assigned_at AS "assignedAt", da.unassigned_at AS "unassignedAt",
         da.unassign_reason AS "unassignReason", da.notes,
         s.id AS "studentId", s.admission_no AS "admissionNo", s.full_name AS "studentName",
         c.name AS grade, sec.name AS section,
         d.id AS "deviceId", d.device_code AS "deviceCode", d.device_type AS "deviceType", d.status AS "deviceStatus",
         d.last_seen_at AS "lastSeenAt", ${gpsStatusSql('d.last_seen_at')} AS "gpsStatus",
         ab.full_name AS "assignedBy", ub.full_name AS "unassignedBy"
    FROM device_assignments da
    JOIN students s ON s.id = da.student_id
    JOIN gps_devices d ON d.id = da.device_id
    LEFT JOIN sections sec ON sec.id = s.section_id
    LEFT JOIN classes c ON c.id = sec.class_id
    LEFT JOIN users ab ON ab.id = da.assigned_by
    LEFT JOIN users ub ON ub.id = da.unassigned_by`;

export async function getAssignment(id: string) {
  const row = await one(`${ASSIGNMENT_SQL} WHERE da.id = $1`, [id]);
  if (!row) throw notFound('Assignment not found', 'ASSIGNMENT_NOT_FOUND');
  return row;
}

export interface AssignmentFilters extends Pagination {
  status?: 'active' | 'inactive';
  studentId?: string;
  deviceId?: string;
}

const ASSIGNMENT_SORTS: Record<string, string> = {
  assigned: 'da.assigned_at',
  unassigned: 'da.unassigned_at',
  student: 's.full_name',
  device: 'd.device_code',
};

export async function listAssignments(f: AssignmentFilters) {
  const w = new Where();
  w.addIf(f.status, 'da.status = ?');
  if (f.studentId) w.add('da.student_id = ?', await resolveStudentId(f.studentId));
  if (f.deviceId) w.add('da.device_id = ?', (await resolveDevice(f.deviceId)).id);
  if (f.q) {
    const t = likeTerm(f.q);
    w.add('(s.full_name ILIKE ? OR s.admission_no ILIKE ? OR d.device_code ILIKE ?)', t, t, t);
  }
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT q.*, count(*) OVER() AS total FROM (${ASSIGNMENT_SQL} ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, ASSIGNMENT_SORTS, 'assigned')}, da.created_at DESC) q
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

/** Dashboard figures: device inventory and connectivity. */
export async function deviceSummary(campusId?: string) {
  const row = await one(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status = 'assigned')::int AS assigned,
            count(*) FILTER (WHERE status = 'available')::int AS available,
            count(*) FILTER (WHERE status IN ('inactive', 'maintenance', 'lost'))::int AS "outOfService",
            count(*) FILTER (WHERE status = 'maintenance')::int AS maintenance,
            count(*) FILTER (WHERE status = 'lost')::int AS lost,
            count(*) FILTER (WHERE status = 'assigned' AND ${gpsStatusSql('last_seen_at')} = 'online')::int AS online,
            count(*) FILTER (WHERE status = 'assigned' AND ${gpsStatusSql('last_seen_at')} = 'stale')::int AS stale,
            count(*) FILTER (WHERE status = 'assigned' AND ${gpsStatusSql('last_seen_at')} IN ('offline', 'never'))::int AS offline,
            count(*) FILTER (WHERE status = 'assigned' AND last_battery_pct < 20)::int AS "lowBattery"
       FROM gps_devices ${campusId ? 'WHERE campus_id = $1' : ''}`,
    campusId ? [campusId] : [],
  );
  return {
    ...row,
    thresholds: { onlineSeconds: env.ONLINE_THRESHOLD_SECONDS, offlineSeconds: env.OFFLINE_THRESHOLD_SECONDS },
    intervalSeconds: env.LOCATION_INTERVAL_SECONDS,
  };
}

// ---------------------------------------------------------------------------
// Device location ingest — POST /api/v1/location
// ---------------------------------------------------------------------------
export interface DeviceLocationBody {
  device_id: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  altitude?: number;
  speed?: number;
  heading?: number;
  battery_level?: number;
  recorded_at?: string;
}

async function authFailed(req: Request, deviceCode: string | undefined, why: string): Promise<never> {
  await audit(req, {
    action: 'device_auth_failed', module: 'devices', description: `Device authentication failed (${why})`,
    entityType: 'gps_device', metadata: { deviceCode: deviceCode ?? null },
  }, undefined, { id: null, name: deviceCode ? `Device ${deviceCode}` : 'Unknown device', role: 'device' });
  // Same answer for an unknown device and a wrong token, so neither can be probed.
  throw unauthorized('Invalid device credentials', 'DEVICE_AUTH_FAILED');
}

/**
 * Authenticates the device, resolves the student from the ACTIVE assignment,
 * validates and stores the point, and records the device's last contact.
 */
export async function ingestLocation(req: Request, body: DeviceLocationBody) {
  // 1. Token
  const header = req.get('authorization') || '';
  const [kind, token] = header.split(' ');
  if (kind !== 'Bearer' || !token || !token.startsWith(TOKEN_PREFIX) || token.length > 200) {
    return authFailed(req, body.device_id, 'missing or malformed token');
  }
  // 2. Device, and the token must belong to it
  const device = await one<{ id: string; device_code: string; status: string; token_hash: string | null }>(
    'SELECT id, device_code, status, token_hash FROM gps_devices WHERE device_code = $1', [body.device_id],
  );
  if (!device || !device.token_hash || !sameHash(device.token_hash, hashDeviceToken(token))) {
    return authFailed(req, body.device_id, device ? 'token does not match' : 'unknown device');
  }
  // 3. Device must be in service
  if (!['assigned', 'available'].includes(device.status)) {
    throw forbidden(`Device ${device.device_code} is ${device.status}`, 'DEVICE_INACTIVE');
  }
  // Contact is recorded even if the point is then refused, so admins can see the device is alive.
  await query(
    `UPDATE gps_devices SET last_seen_at = now(), last_ip = $2, last_battery_pct = COALESCE($3, last_battery_pct) WHERE id = $1`,
    [device.id, clientIp(req), body.battery_level != null ? Math.round(body.battery_level) : null],
  );
  const recordedAt = body.recorded_at ? new Date(body.recorded_at) : new Date();
  checkRecordedAt(recordedAt);

  return tx(async (db) => {
    // 4–5. Active assignment → student
    const a = await one<{ student_id: string; admission_no: string }>(
      `SELECT da.student_id, s.admission_no FROM device_assignments da JOIN students s ON s.id = da.student_id
        WHERE da.device_id = $1 AND da.status = 'active' AND s.deleted_at IS NULL`, [device.id], db,
    );
    if (!a) throw conflict('Device is not assigned to a student', 'DEVICE_NOT_ASSIGNED');
    if (!(await trackingAllowed(a.student_id, db))) throw conflict('Tracking is disabled for the assigned student', 'TRACKING_DISABLED');
    // 6–8. Coordinates are range-checked by the schema; store history + latest location (trigger).
    const point = await storeLocation(db, a.student_id, {
      deviceId: device.id,
      latitude: body.latitude,
      longitude: body.longitude,
      accuracy: body.accuracy,
      altitude: body.altitude,
      speed: body.speed,
      heading: body.heading,
      batteryPct: body.battery_level,
      source: 'device',
    }, recordedAt);
    return {
      device_id: device.device_code,
      student_id: a.admission_no,
      location_id: point.id,
      recorded_at: point.recordedAt,
      next_interval_seconds: env.LOCATION_INTERVAL_SECONDS,
    };
  });
}

/** Most recent point a device sent, with the student it was recorded against. */
export async function latestForDevice(deviceId: string) {
  return one(
    `SELECT l.id AS "locationId", l.latitude, l.longitude, l.accuracy, l.altitude, l.speed, l.heading,
            l.battery_pct AS "batteryPct", l.recorded_at AS "recordedAt", l.created_at AS "receivedAt",
            s.id AS "studentId", s.admission_no AS "admissionNo", s.full_name AS "studentName"
       FROM student_locations l JOIN students s ON s.id = l.student_id
      WHERE l.device_id = $1
      ORDER BY l.recorded_at DESC, l.id DESC LIMIT 1`,
    [deviceId],
  );
}

/**
 * What the tracker phone shows about itself, as the server sees it: its
 * assigned student, today's points and distance, and its last contact.
 * Authenticated by the device token alone (only its hash is stored).
 */
export async function deviceSelfStatus(req: Request) {
  const [kind, token] = (req.get('authorization') || '').split(' ');
  if (kind !== 'Bearer' || !token || !token.startsWith(TOKEN_PREFIX) || token.length > 200) {
    return authFailed(req, undefined, 'missing or malformed token');
  }
  const d = await one(
    `${DEVICE_SQL} WHERE d.token_hash = $1`, [hashDeviceToken(token)],
  );
  if (!d) return authFailed(req, undefined, 'status: token does not match');

  const tracking = d.studentId
    ? await one<{ tracking_enabled: boolean; tracking_status: string }>(
      'SELECT tracking_enabled, tracking_status FROM student_tracking_profiles WHERE student_id = $1', [d.studentId])
    : null;
  // Points this device recorded for its current student today (school timezone).
  const today = d.studentId
    ? await many<{ latitude: number; longitude: number; recorded_at: Date }>(
      `SELECT latitude, longitude, recorded_at FROM student_locations
        WHERE device_id = $1 AND student_id = $2
          AND recorded_at >= (now() AT TIME ZONE 'Asia/Kolkata')::date::timestamp AT TIME ZONE 'Asia/Kolkata'
        ORDER BY recorded_at, id`,
      [d.id, d.studentId])
    : [];
  let metres = 0;
  for (let i = 1; i < today.length; i++) {
    metres += haversineMetres(today[i - 1].latitude, today[i - 1].longitude, today[i].latitude, today[i].longitude);
  }
  const total = d.assignmentId
    ? await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM student_locations WHERE device_id = $1 AND student_id = $2 AND recorded_at >= $3`,
      [d.id, d.studentId, d.assignedAt])
    : null;

  return {
    device: {
      deviceCode: d.deviceCode, deviceType: d.deviceType, status: d.status, gpsStatus: d.gpsStatus,
      lastSeenAt: d.lastSeenAt, batteryPct: d.batteryPct,
    },
    student: d.studentId ? {
      admissionNo: d.admissionNo, fullName: d.studentName, grade: d.grade, section: d.section, assignedAt: d.assignedAt,
      trackingEnabled: !!tracking?.tracking_enabled && tracking.tracking_status !== 'disabled',
      trackingStatus: tracking?.tracking_status ?? 'disabled',
    } : null,
    today: {
      points: today.length,
      distanceKm: Math.round(metres / 10) / 100,
      firstAt: today[0]?.recorded_at ?? null,
      lastAt: today[today.length - 1]?.recorded_at ?? null,
    },
    assignmentPoints: total?.n ?? 0,
    intervalSeconds: env.LOCATION_INTERVAL_SECONDS,
    thresholds: { onlineSeconds: env.ONLINE_THRESHOLD_SECONDS, offlineSeconds: env.OFFLINE_THRESHOLD_SECONDS },
    serverTime: new Date().toISOString(),
  };
}
