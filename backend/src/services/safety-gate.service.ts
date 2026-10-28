import type { Request } from 'express';
import { many, one, query, tx } from '../config/db.js';
import { conflict } from '../utils/errors.js';
import { likeTerm, limitOffset, orderBy, type Pagination } from '../utils/pagination.js';
import { Where } from '../utils/sql.js';
import { audit } from './audit.service.js';
import { notifyGuardians } from './notification.service.js';
import {
  authorizeSafetyStudent, hhmm, localDate, PARENT_ROUTE, safetyStudentScope,
  safetyStudentScopeNullable, studentBrief, TODAY,
} from './safety-common.service.js';
import type { AuthUser } from '../types.js';

// =============================================================================
// Smart Gate dashboard
// =============================================================================
function studentWhere(user: AuthUser, campusId?: string) {
  const w = new Where();
  w.add(`s.deleted_at IS NULL`);
  safetyStudentScope(user, w);
  w.addIf(campusId, 's.campus_id = ?');
  return w;
}

export async function gateSummary(user: AuthUser, campusId?: string) {
  const w = studentWhere(user, campusId);
  const counts = await one<{ arrived: number; inside: number; exited: number; expected: number }>(
    `WITH last AS (
       SELECT DISTINCT ON (g.student_id) g.student_id, g.direction
         FROM gate_events g JOIN students s ON s.id = g.student_id
        ${w.sql} ${w.sql ? 'AND' : 'WHERE'} ${localDate('g.occurred_at')} = ${TODAY}
        ORDER BY g.student_id, g.occurred_at DESC
     ), arrived AS (
       SELECT DISTINCT g.student_id FROM gate_events g JOIN students s ON s.id = g.student_id
        ${w.sql} ${w.sql ? 'AND' : 'WHERE'} ${localDate('g.occurred_at')} = ${TODAY} AND g.direction = 'in'
     )
     SELECT (SELECT count(*) FROM arrived)::int AS arrived,
            (SELECT count(*) FROM last WHERE direction = 'in')::int AS inside,
            (SELECT count(*) FROM last WHERE direction = 'out')::int AS exited,
            (SELECT count(*) FROM students s ${w.sql} AND s.status = 'active')::int AS expected`,
    w.params,
  );

  const vw = new Where();
  vw.addIf(campusId, 'v.campus_id = ?');
  const visitors = await one<{ inside: number; expected: number; today: number }>(
    `SELECT count(*) FILTER (WHERE v.status = 'Inside')::int AS inside,
            count(*) FILTER (WHERE v.status = 'Expected' AND ${localDate('v.checked_in_at')} = ${TODAY})::int AS expected,
            count(*) FILTER (WHERE ${localDate('v.checked_in_at')} = ${TODAY} AND v.status <> 'Denied')::int AS today
       FROM visitors v ${vw.sql}`,
    vw.params,
  );

  const pw = studentWhere(user, campusId);
  const pending = await one<{ n: number }>(
    `SELECT count(DISTINCT x.student_id)::int AS n FROM (
        SELECT iv.student_id FROM infirmary_visits iv
         WHERE ${localDate('iv.visited_at')} = ${TODAY} AND iv.outcome = 'Awaiting pickup'
        UNION
        SELECT pe.student_id FROM pickup_events pe
         WHERE ${localDate('pe.occurred_at')} = ${TODAY} AND pe.outcome = 'held'
           AND NOT EXISTS (SELECT 1 FROM pickup_events c WHERE c.student_id = pe.student_id AND c.outcome = 'collected' AND c.occurred_at > pe.occurred_at)
     ) x JOIN students s ON s.id = x.student_id ${pw.sql}`,
    pw.params,
  );

  const aw = studentWhere(user, campusId);
  const pendingAuth = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM pickup_authorisations pa JOIN students s ON s.id = pa.student_id ${aw.sql} AND pa.status = 'Pending'`,
    aw.params,
  );

  // Gate status: activity per gate today, plus the bus bay from route run status.
  const gw = studentWhere(user, campusId);
  const gates = await many<{ gate: string; ins: number; outs: number; last_at: Date | null }>(
    `SELECT g.gate, count(*) FILTER (WHERE g.direction = 'in')::int AS ins, count(*) FILTER (WHERE g.direction = 'out')::int AS outs,
            max(g.occurred_at) AS last_at
       FROM gate_events g JOIN students s ON s.id = g.student_id
      ${gw.sql} AND ${localDate('g.occurred_at')} = ${TODAY}
      GROUP BY g.gate`,
    gw.params,
  );
  const bw = new Where();
  bw.addIf(campusId, 'tr.campus_id = ?');
  const bay = await one<{ arrived: number; running: number; delayed: number }>(
    `SELECT count(*) FILTER (WHERE tr.run_status IN ('At campus', 'Completed'))::int AS arrived,
            count(*) FILTER (WHERE tr.run_status <> 'Maintenance')::int AS running,
            count(*) FILTER (WHERE tr.run_status = 'Delayed')::int AS delayed
       FROM transport_routes tr ${bw.sql}`,
    bw.params,
  );
  const gateRows = ['Main Gate', 'Rear Gate', 'Visitor Gate'].map((name) => {
    const g = gates.find((x) => x.gate === name);
    const visitorsHere = name === 'Visitor Gate' ? visitors!.today : 0;
    const scans = (g?.ins ?? 0) + (g?.outs ?? 0);
    return {
      gate: name,
      tone: scans || visitorsHere ? 'success' : 'neutral',
      detail: name === 'Visitor Gate'
        ? `${visitorsHere} visitor${visitorsHere === 1 ? '' : 's'} today · ${visitors!.inside} on site`
        : scans ? `${g!.ins} in · ${g!.outs} out · last scan ${hhmm(g!.last_at)}` : 'No scans yet today',
    };
  });
  gateRows.push({
    gate: 'Bus Bay',
    tone: bay!.delayed ? 'warning' : bay!.arrived === bay!.running && bay!.running ? 'success' : 'info',
    detail: `${bay!.arrived} of ${bay!.running} buses arrived${bay!.delayed ? ` · ${bay!.delayed} delayed` : ''}`,
  });

  // Cumulative arrivals by quarter hour (first entry per student).
  const cw = studentWhere(user, campusId);
  const buckets = await many<{ bucket: string; n: number }>(
    `SELECT to_char(date_trunc('hour', t) + floor(extract(minute FROM t) / 15) * interval '15 minutes', 'HH24:MI') AS bucket, count(*)::int AS n
       FROM (SELECT min(g.occurred_at AT TIME ZONE 'Asia/Kolkata') AS t
               FROM gate_events g JOIN students s ON s.id = g.student_id
              ${cw.sql} AND g.direction = 'in' AND ${localDate('g.occurred_at')} = ${TODAY}
              GROUP BY g.student_id) f
      GROUP BY 1 ORDER BY 1`,
    cw.params,
  );
  const labels: string[] = [];
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const first = Math.min(7 * 60 + 30, ...buckets.map((b) => toMin(b.bucket)));
  const last = Math.max(9 * 60, ...buckets.map((b) => toMin(b.bucket)));
  for (let m = first; m <= last; m += 15) labels.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  let running = 0;
  const values = labels.map((l) => (running += buckets.find((b) => b.bucket === l)?.n ?? 0));

  return {
    arrived: counts!.arrived,
    inside: counts!.inside,
    exited: counts!.exited,
    notArrived: Math.max(0, counts!.expected - counts!.arrived),
    expected: counts!.expected,
    visitorsOnSite: visitors!.inside,
    visitorsExpected: visitors!.expected,
    pendingPickup: pending!.n,
    pendingAuthorisations: pendingAuth!.n,
    gates: gateRows,
    arrivals: { labels, values },
    generatedAt: new Date().toISOString(),
  };
}

export interface FeedItem {
  id: string;
  at: Date;
  kind: string;
  icon: string;
  actor: string | null;
  studentId: string | null;
  text: string;
  meta: string | null;
  tone?: string;
}

/** Everything that happened at the gate today, newest first. */
export async function gateFeed(user: AuthUser, campusId?: string, limit = 30): Promise<FeedItem[]> {
  const gw = studentWhere(user, campusId);
  const gate = many(
    `SELECT g.id, g.occurred_at AS at, g.direction, g.gate, g.method, g.parent_notified_at, s.id AS student_id, s.full_name
       FROM gate_events g JOIN students s ON s.id = g.student_id
      ${gw.sql} AND ${localDate('g.occurred_at')} = ${TODAY}
      ORDER BY g.occurred_at DESC LIMIT ${gw.param(limit)}`,
    gw.params,
  );
  const vw = new Where();
  vw.addIf(campusId, 'v.campus_id = ?');
  const visitors = many(
    `SELECT v.id, v.badge_no, v.full_name, v.purpose, v.status, v.checked_in_at, v.checked_out_at, e.full_name AS host
       FROM visitors v LEFT JOIN employees e ON e.id = v.host_employee_id
      ${vw.sql} ${vw.sql ? 'AND' : 'WHERE'} v.status IN ('Inside', 'Completed')
        AND (${localDate('v.checked_in_at')} = ${TODAY} OR ${localDate('v.checked_out_at')} = ${TODAY})`,
    vw.params,
  );
  const bw = new Where();
  bw.addIf(campusId, 'tr.campus_id = ?');
  const buses = many(
    `SELECT tr.id, v.bus_no, date_trunc('minute', be.occurred_at) AS at, count(*)::int AS n, e.full_name AS attendant
       FROM boarding_events be JOIN transport_routes tr ON tr.id = be.route_id
       LEFT JOIN vehicles v ON v.id = tr.vehicle_id LEFT JOIN employees e ON e.id = tr.attendant_id
      ${bw.sql} ${bw.sql ? 'AND' : 'WHERE'} be.event_type = 'deboarded' AND ${localDate('be.occurred_at')} = ${TODAY}
      GROUP BY tr.id, v.bus_no, date_trunc('minute', be.occurred_at), e.full_name
      ORDER BY 3 DESC LIMIT 20`,
    bw.params,
  );
  const pw = studentWhere(user, campusId);
  const pickups = many(
    `SELECT pe.id, pe.occurred_at AS at, pe.outcome, pe.person_name, pe.gate, pe.method, s.id AS student_id, s.full_name, i.code
       FROM pickup_events pe JOIN students s ON s.id = pe.student_id LEFT JOIN incidents i ON i.id = pe.incident_id
      ${pw.sql} AND ${localDate('pe.occurred_at')} = ${TODAY}`,
    pw.params,
  );
  const iw = new Where();
  iw.add(`${localDate('i.created_at')} = ${TODAY}`);
  iw.addIf(campusId, 'i.campus_id = ?');
  if (!user.permissions.has('students.sensitive')) iw.add('NOT i.is_confidential');
  safetyStudentScopeNullable(user, iw, 'i.student_id');
  const incidents = many(
    `SELECT i.id, i.created_at AS at, i.code, i.summary, i.severity, i.status FROM incidents i ${iw.sql}`,
    iw.params,
  );
  const ew = new Where();
  ew.add(`${localDate('b.sent_at')} = ${TODAY}`);
  if (campusId) ew.add('(b.campus_id IS NULL OR b.campus_id = ?)', campusId);
  const broadcasts = many(
    `SELECT b.id, b.sent_at AS at, b.alert_type, b.message, b.recipients FROM emergency_broadcasts b ${ew.sql}`,
    ew.params,
  );

  const [g, v, b, p, inc, eb] = await Promise.all([gate, visitors, buses, pickups, incidents, broadcasts]);
  const items: FeedItem[] = [];
  for (const r of g) {
    items.push({
      id: `g-${r.id}`, at: r.at, kind: 'gate', icon: r.direction === 'in' ? 'door' : 'logout', actor: r.full_name, studentId: r.student_id,
      text: `${r.direction === 'in' ? 'entered' : 'left'} — ${r.gate} (${r.method})`,
      meta: r.parent_notified_at ? `Parent notified · ${hhmm(r.parent_notified_at)}` : 'No parent notification (already sent today)',
    });
  }
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const isToday = (d: Date | null) => !!d && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(d)) === todayKey;
  for (const r of v) {
    if (isToday(r.checked_in_at)) {
      items.push({
        id: `vi-${r.id}`, at: r.checked_in_at, kind: 'visitor', icon: 'idCard', actor: r.full_name, studentId: null,
        text: `checked in as a visitor — badge ${r.badge_no}`, meta: `Purpose: ${r.purpose}${r.host ? ` · Host: ${r.host}` : ''}`,
      });
    }
    if (r.checked_out_at && isToday(r.checked_out_at)) {
      items.push({
        id: `vo-${r.id}`, at: r.checked_out_at, kind: 'visitor', icon: 'logout', actor: r.full_name, studentId: null,
        text: `checked out — badge ${r.badge_no} returned`, meta: r.host ? `Host: ${r.host}` : null,
      });
    }
  }
  for (const r of b) {
    items.push({
      id: `b-${r.id}-${new Date(r.at).getTime()}`, at: r.at, kind: 'bus', icon: 'bus', actor: null, studentId: null,
      text: `${r.bus_no ?? 'Bus'} arrived at campus — ${r.n} student${r.n === 1 ? '' : 's'} de-boarded`,
      meta: r.attendant ? `Attendant: ${r.attendant}` : null,
    });
  }
  for (const r of p) {
    items.push({
      id: `p-${r.id}`, at: r.at, kind: 'pickup', icon: r.outcome === 'held' ? 'alert' : 'userCheck', actor: r.full_name, studentId: r.student_id,
      text: r.outcome === 'held' ? `— collection held at ${r.gate}: ${r.person_name} is not authorised` : `collected by ${r.person_name} at ${r.gate}`,
      meta: r.outcome === 'held' ? `Incident ${r.code ?? ''} · front office and parents alerted` : `Verified${r.method ? ` · ${r.method}` : ''}`,
      tone: r.outcome === 'held' ? 'critical' : undefined,
    });
  }
  for (const r of inc) {
    items.push({
      id: `i-${r.id}`, at: r.at, kind: 'incident', icon: 'shield', actor: null, studentId: null,
      text: `Incident ${r.code} logged — ${r.summary}`, meta: `${r.severity} · ${r.status}`, tone: r.severity === 'Critical' ? 'critical' : undefined,
    });
  }
  for (const r of eb) {
    items.push({
      id: `e-${r.id}`, at: r.at, kind: 'broadcast', icon: 'megaphone', actor: null, studentId: null,
      text: `${r.alert_type} broadcast sent — ${r.message}`, meta: `Reached ${r.recipients} people`, tone: 'critical',
    });
  }
  return items.sort((a, c) => new Date(c.at).getTime() - new Date(a.at).getTime()).slice(0, limit);
}

// =============================================================================
// Gate log
// =============================================================================
export interface GateLogFilters extends Pagination {
  campusId?: string;
  date?: string;
  classId?: string;
  sectionId?: string;
  status?: 'Inside' | 'Exited' | 'Not arrived';
}

const LOG_SORTS: Record<string, string> = {
  name: 'q."fullName"',
  grade: 'q."gradeLevel", q.section',
  entry: 'q."firstIn"',
  exit: 'q."lastOut"',
  status: 'q.status',
};

/** One row per student for a day: first entry, last exit, current status. */
export async function gateLog(user: AuthUser, f: GateLogFilters) {
  const w = new Where();
  const day = w.param(f.date ?? null);
  w.add(`s.deleted_at IS NULL AND s.status = 'active'`);
  safetyStudentScope(user, w);
  w.addIf(f.campusId, 's.campus_id = ?');
  w.addIf(f.sectionId, 's.section_id = ?');
  w.addIf(f.classId, 'sec.class_id = ?');
  if (f.q) w.add('(s.full_name ILIKE ? OR s.admission_no ILIKE ?)', likeTerm(f.q), likeTerm(f.q));
  const statusFilter = f.status ? `WHERE q.status = ${w.param(f.status)}` : '';
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT q.*, count(*) OVER() AS total FROM (
       SELECT s.id, s.admission_no AS "admissionNo", s.full_name AS "fullName", c.name AS grade, c.grade_level AS "gradeLevel",
              sec.name AS section, cp.short_name AS "campusName",
              d.first_in AS "firstIn", d.last_out AS "lastOut", d.in_method AS "entryMethod", d.out_gate AS "exitGate",
              COALESCE(d.notified_in, false) AS "arrivalNotified", COALESCE(d.notified_out, false) AS "exitNotified",
              COALESCE(d.scans, 0)::int AS scans,
              CASE WHEN d.last_dir IS NULL THEN 'Not arrived' WHEN d.last_dir = 'in' THEN 'Inside' ELSE 'Exited' END AS status,
              tr.code AS "routeCode"
         FROM students s
         JOIN campuses cp ON cp.id = s.campus_id
         LEFT JOIN sections sec ON sec.id = s.section_id
         LEFT JOIN classes c ON c.id = sec.class_id
         LEFT JOIN student_transport st ON st.student_id = s.id
         LEFT JOIN transport_routes tr ON tr.id = st.route_id
         LEFT JOIN LATERAL (
           SELECT min(g.occurred_at) FILTER (WHERE g.direction = 'in') AS first_in,
                  max(g.occurred_at) FILTER (WHERE g.direction = 'out') AS last_out,
                  (array_agg(g.direction ORDER BY g.occurred_at DESC))[1] AS last_dir,
                  (array_agg(g.method ORDER BY g.occurred_at) FILTER (WHERE g.direction = 'in'))[1] AS in_method,
                  (array_agg(g.gate ORDER BY g.occurred_at DESC) FILTER (WHERE g.direction = 'out'))[1] AS out_gate,
                  bool_or(g.parent_notified_at IS NOT NULL) FILTER (WHERE g.direction = 'in') AS notified_in,
                  bool_or(g.parent_notified_at IS NOT NULL) FILTER (WHERE g.direction = 'out') AS notified_out,
                  count(*) AS scans
             FROM gate_events g
            WHERE g.student_id = s.id AND ${localDate('g.occurred_at')} = COALESCE(${day}::date, ${TODAY})
         ) d ON true
        ${w.sql}
     ) q ${statusFilter}
     ORDER BY ${orderBy(f.sort, f.dir, LOG_SORTS, 'name')}, q."fullName"
     LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows: rows.map(({ total: _t, gradeLevel: _g, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export interface GateEventFilters extends Pagination {
  campusId?: string;
  date?: string;
  direction?: 'in' | 'out';
  gate?: string;
  method?: string;
}

const EVENT_SORTS: Record<string, string> = { time: 'x."occurredAt"', name: 'x."fullName"', gate: 'x.gate', method: 'x.method' };

function eventsWhere(user: AuthUser, f: Partial<GateEventFilters>) {
  const w = new Where();
  w.add(`${localDate('g.occurred_at')} = COALESCE(?::date, ${TODAY})`, f.date ?? null);
  safetyStudentScope(user, w);
  w.addIf(f.campusId, 'g.campus_id = ?');
  w.addIf(f.direction, 'g.direction = ?');
  w.addIf(f.gate, 'g.gate = ?');
  w.addIf(f.method, 'g.method = ?');
  if (f.q) w.add('(s.full_name ILIKE ? OR s.admission_no ILIKE ?)', likeTerm(f.q), likeTerm(f.q));
  return w;
}

const EVENT_SELECT = `
  SELECT g.id, g.occurred_at AS "occurredAt", g.direction, g.gate, g.method, g.parent_notified_at AS "parentNotifiedAt",
         s.id AS "studentId", s.admission_no AS "admissionNo", s.full_name AS "fullName", c.name AS grade, sec.name AS section,
         cp.short_name AS "campusName"
    FROM gate_events g
    JOIN students s ON s.id = g.student_id
    JOIN campuses cp ON cp.id = g.campus_id
    LEFT JOIN sections sec ON sec.id = s.section_id
    LEFT JOIN classes c ON c.id = sec.class_id`;

/** Every raw scan for a day. */
export async function gateEvents(user: AuthUser, f: GateEventFilters) {
  const w = eventsWhere(user, f);
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT x.*, count(*) OVER() AS total FROM (${EVENT_SELECT} ${w.sql}) x
      ORDER BY ${orderBy(f.sort, f.dir, EVENT_SORTS, 'time')}, x.id
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; // neutralise spreadsheet formulas
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function gateEventsCsv(user: AuthUser, f: Partial<GateEventFilters>) {
  const w = eventsWhere(user, f);
  const rows = await many(`${EVENT_SELECT} ${w.sql} ORDER BY g.occurred_at LIMIT 10000`, w.params);
  const head = ['Time', 'Admission no', 'Student', 'Grade', 'Direction', 'Gate', 'Method', 'Parent notified', 'Campus'];
  const lines = rows.map((r) => [
    new Date(r.occurredAt).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata' }), r.admissionNo, r.fullName,
    r.grade ? `${r.grade}${r.section ?? ''}` : '', r.direction === 'in' ? 'Entry' : 'Exit', r.gate, r.method,
    r.parentNotifiedAt ? hhmm(r.parentNotifiedAt) : '', r.campusName,
  ].map(csvCell).join(','));
  return [head.join(','), ...lines].join('\r\n');
}

// =============================================================================
// Manual gate entry / exit
// =============================================================================
/**
 * Records a gate scan. Guardians hear about the first arrival and the first
 * departure of each day only, so repeated scans do not spam them.
 */
export async function recordGateEvent(req: Request, input: { studentId: string; direction: 'in' | 'out'; gate: string; method: string }) {
  const studentId = await authorizeSafetyStudent(req, input.studentId);
  return tx(async (db) => {
    const s = await studentBrief(studentId, db);
    // Serialise scans for the same child so a double tap cannot record two entries.
    await query('SELECT pg_advisory_xact_lock(hashtext($1))', [`gate:${studentId}`], db);
    const last = await one<{ direction: string }>(
      `SELECT direction FROM gate_events WHERE student_id = $1 AND ${localDate('occurred_at')} = ${TODAY} ORDER BY occurred_at DESC LIMIT 1`,
      [studentId], db,
    );
    if (last?.direction === input.direction) {
      throw conflict(input.direction === 'in' ? `${s.full_name} is already marked inside the campus` : `${s.full_name} has already been marked as exited`, 'GATE_DUPLICATE');
    }
    const notified = await one(
      `SELECT 1 FROM gate_events WHERE student_id = $1 AND direction = $2 AND ${localDate('occurred_at')} = ${TODAY} AND parent_notified_at IS NOT NULL`,
      [studentId, input.direction], db,
    );
    const notify = !notified;
    const row = await one(
      `INSERT INTO gate_events (student_id, campus_id, gate, direction, method, occurred_at, parent_notified_at)
       VALUES ($1,$2,$3,$4,$5, now(), CASE WHEN $6::boolean THEN now() END)
       RETURNING id, occurred_at AS "occurredAt", direction, gate, method, parent_notified_at AS "parentNotifiedAt"`,
      [studentId, s.campus_id, input.gate, input.direction, input.method, notify], db,
    );
    if (notify) {
      const arrived = input.direction === 'in';
      await notifyGuardians(studentId, {
        category: arrived ? 'Completed' : 'Information',
        icon: arrived ? 'shieldCheck' : 'door',
        topic: 'safety',
        title: arrived ? `${s.full_name} arrived safely at school` : `${s.full_name} has left the campus`,
        body: `${input.gate} · ${hhmm(row.occurredAt)}`,
        route: PARENT_ROUTE,
        entityType: 'student',
        entityId: studentId,
      }, db);
    }
    await audit(req, {
      action: 'create', module: 'safety',
      description: `Recorded ${input.direction === 'in' ? 'entry' : 'exit'} for ${s.full_name} at ${input.gate} (${input.method})`,
      entityType: 'student', entityId: studentId, metadata: { gate: input.gate, method: input.method, parentNotified: notify },
    }, db);
    return { ...row, studentId, fullName: s.full_name, parentNotified: notify };
  });
}


/** Today's gate scans for one child (family view; caller has authorised the parent). */
export async function familyGateToday(studentId: string) {
  return many(
    `SELECT g.id, g.direction, g.gate, g.method, g.occurred_at AS "occurredAt", g.parent_notified_at AS "parentNotifiedAt"
       FROM gate_events g WHERE g.student_id = $1 AND ${localDate('g.occurred_at')} = ${TODAY} ORDER BY g.occurred_at`,
    [studentId],
  );
}
