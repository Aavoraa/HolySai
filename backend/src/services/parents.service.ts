import type { Request } from 'express';
import { many, one, query } from '../config/db.js';
import { Where } from '../utils/sql.js';
import { likeTerm, limitOffset, orderBy, type Pagination } from '../utils/pagination.js';
import { notFound } from '../utils/errors.js';
import { nextCode } from '../utils/codes.js';
import { audit } from './audit.service.js';
import { STUDENT_ROW_SQL } from './students.service.js';
import { studentScope } from './access.service.js';
import { addParentScope, audienceParentSql } from './parents-experience.service.js';
import type { AuthUser } from '../types.js';

const SORTS: Record<string, string> = {
  name: 'p.full_name',
  engagement: 'p.engagement_score',
  lastContact: 'p.last_contact_at',
};

export async function listParents(user: AuthUser, f: Pagination & { campusId?: string }) {
  const w = new Where();
  w.add('p.deleted_at IS NULL');
  addParentScope(user, w);
  if (f.q) w.add('(p.full_name ILIKE ? OR p.phone ILIKE ? OR p.email::text ILIKE ?)', likeTerm(f.q), likeTerm(f.q), likeTerm(f.q));
  if (f.campusId) w.add('EXISTS (SELECT 1 FROM student_guardians sg JOIN students s ON s.id = sg.student_id WHERE sg.parent_id = p.id AND s.campus_id = ?)', f.campusId);
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT p.id, p.parent_code AS "parentCode", p.full_name AS "fullName", p.phone, p.email, p.occupation,
            p.preferred_channel AS "preferredChannel", p.engagement_score AS engagement,
            p.last_contact_at AS "lastContactAt", p.last_contact_channel AS "lastContactChannel",
            (p.user_id IS NOT NULL) AS "hasAppAccount",
            COALESCE((SELECT json_agg(json_build_object('id', s.id, 'fullName', s.full_name, 'admissionNo', s.admission_no,
                                                        'grade', c.name, 'section', sec.name) ORDER BY s.full_name)
                        FROM student_guardians sg JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL
                        LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
                       WHERE sg.parent_id = p.id), '[]') AS children,
            EXISTS (SELECT 1 FROM ptm_bookings b WHERE b.parent_id = p.id AND b.status = 'Booked') AS "ptmBooked",
            count(*) OVER() AS total
       FROM parents p ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, SORTS, 'name')}
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export async function getParent(id: string) {
  const p = await one(
    `SELECT id, parent_code AS "parentCode", full_name AS "fullName", phone, alt_phone AS "altPhone", email, occupation,
            address, preferred_channel AS "preferredChannel", engagement_score AS engagement,
            last_contact_at AS "lastContactAt", last_contact_channel AS "lastContactChannel", (user_id IS NOT NULL) AS "hasAppAccount"
       FROM parents WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (!p) throw notFound('Parent not found', 'PARENT_NOT_FOUND');
  return p;
}

/**
 * The parent's children with the same derived figures staff see. With `staff`,
 * only the children that staff member may see (teachers: their own sections).
 */
export async function getChildren(parentId: string, staff?: AuthUser) {
  const w = new Where().add('s.deleted_at IS NULL');
  if (staff) studentScope(staff, w);
  return many(
    `SELECT q.*, g.relationship, g.is_primary AS "isPrimary", g.can_view_tracking AS "canViewTracking",
            cl.location_status AS "locationStatus", cl.recorded_at AS "locationRecordedAt"
       FROM (${STUDENT_ROW_SQL} ${w.sql}) q
       JOIN student_guardians g ON g.student_id = q.id AND g.parent_id = ${w.param(parentId)}
       LEFT JOIN student_current_locations cl ON cl.student_id = q.id
      ORDER BY q."fullName"`,
    w.params,
  );
}

export async function createParent(req: Request, input: any) {
  const code = await nextCode('parents', 'parent_code', 'PAR-');
  const row = await one<{ id: string }>(
    `INSERT INTO parents (parent_code, full_name, phone, alt_phone, email, occupation, address, preferred_channel, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING id`,
    [code, input.fullName, input.phone, input.altPhone ?? null, input.email ?? null, input.occupation ?? null, input.address ?? null, input.preferredChannel ?? 'whatsapp', req.user!.id],
  );
  await audit(req, { action: 'create', module: 'parents', description: `Created parent ${input.fullName} (${code})`, entityType: 'parent', entityId: row!.id });
  return getParent(row!.id);
}

const COLS: Record<string, string> = {
  fullName: 'full_name', phone: 'phone', altPhone: 'alt_phone', email: 'email', occupation: 'occupation',
  address: 'address', preferredChannel: 'preferred_channel',
};

export async function updateParent(req: Request, id: string, input: Record<string, unknown>) {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, val] of Object.entries(input)) {
    if (!COLS[k] || val === undefined) continue;
    params.push(val);
    sets.push(`${COLS[k]} = $${params.length}`);
  }
  params.push(req.user!.id, id);
  const r = await query(
    `UPDATE parents SET ${sets.join(', ')}, updated_by = $${params.length - 1} WHERE id = $${params.length} AND deleted_at IS NULL`,
    params,
  );
  if (!r.rowCount) throw notFound('Parent not found', 'PARENT_NOT_FOUND');
  await audit(req, { action: 'update', module: 'parents', description: `Updated parent record (${Object.keys(input).join(', ')})`, entityType: 'parent', entityId: id });
  return getParent(id);
}

/**
 * Parent 360 home: everything a parent sees for one child today, gathered
 * in one round trip for the mobile-first portal.
 */
export async function childOverview(parentId: string, studentId: string) {
  const [child, gateToday, bus, homework, fees, notifications, events, pickup] = await Promise.all([
    one(`${STUDENT_ROW_SQL} WHERE s.id = $1`, [studentId]),
    many(`SELECT gate, direction, method, occurred_at AS "occurredAt" FROM gate_events
           WHERE student_id = $1 AND occurred_at >= current_date ORDER BY occurred_at`, [studentId]),
    one(`SELECT tr.name AS "routeName", tr.run_status AS "runStatus", tr.delay_minutes AS "delayMinutes", tr.eta_text AS eta,
                v.bus_no AS "busNo", v.registration_no AS "registrationNo", d.full_name AS driver, a.full_name AS attendant,
                rs.name AS "stopName", rs.pickup_time AS "pickupTime", rs.drop_time AS "dropTime",
                (SELECT json_agg(json_build_object('type', be.event_type, 'at', be.occurred_at) ORDER BY be.occurred_at)
                   FROM boarding_events be WHERE be.student_id = st.student_id AND be.occurred_at >= current_date) AS "boardingToday"
           FROM student_transport st JOIN transport_routes tr ON tr.id = st.route_id
           LEFT JOIN vehicles v ON v.id = tr.vehicle_id LEFT JOIN employees d ON d.id = tr.driver_id
           LEFT JOIN employees a ON a.id = tr.attendant_id LEFT JOIN route_stops rs ON rs.id = st.stop_id
          WHERE st.student_id = $1`, [studentId]),
    many(`SELECT h.id, sub.name AS subject, h.title, h.due_on AS "dueOn", h.status,
                 (hs.student_id IS NOT NULL) AS submitted
            FROM homework h JOIN subjects sub ON sub.id = h.subject_id
            JOIN students s ON s.section_id = h.section_id AND s.id = $1
            LEFT JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.student_id = s.id
           WHERE h.status = 'Open' ORDER BY h.due_on LIMIT 8`, [studentId]),
    one(`SELECT COALESCE(sum(amount_due - concession_amount), 0) AS billed, COALESCE(sum(amount_paid), 0) AS paid,
                COALESCE(sum(amount_due - concession_amount - amount_paid), 0) AS outstanding,
                min(due_date) FILTER (WHERE status IN ('Pending', 'Partial', 'Overdue')) AS "nextDue"
           FROM student_fees WHERE student_id = $1`, [studentId]),
    many(`SELECT n.id, n.category, n.tone, n.icon, n.title, n.body, n.route, n.created_at AS "createdAt", n.read_at AS "readAt"
            FROM notifications n JOIN parents p ON p.user_id = n.user_id
           WHERE p.id = $1 ORDER BY n.created_at DESC LIMIT 6`, [parentId]),
    many(`SELECT e.id, e.title, e.starts_on AS "startsOn", e.ends_on AS "endsOn", e.venue, e.audience FROM events e
           WHERE e.status = 'Published' AND e.starts_on >= current_date
             AND ${audienceParentSql('e.audience_filter', 'e.campus_id', '$1::uuid')}
           ORDER BY e.starts_on LIMIT 5`, [parentId]),
    many(`SELECT id, person_name AS "personName", relation, method, status, last_pickup_at AS "lastPickupAt"
            FROM pickup_authorisations WHERE student_id = $1 AND status <> 'Revoked' ORDER BY person_name`, [studentId]),
  ]);
  return { child, gateToday, bus, homework, fees, notifications, events, pickup };
}
