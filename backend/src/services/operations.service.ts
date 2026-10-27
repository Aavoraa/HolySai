/**
 * Operations — assets, facilities (+ bookings), maintenance, inventory.
 * Every figure is computed from the transactional tables.
 */
import type { Request } from 'express';
import { many, one, query, tx } from '../config/db.js';
import { Where } from '../utils/sql.js';
import { likeTerm, limitOffset, orderBy, type Pagination } from '../utils/pagination.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { nextCode } from '../utils/codes.js';
import { audit } from './audit.service.js';
import { notifyRoles, notifyUsers } from './notification.service.js';
import { assertCampus, splitTotal, updateById } from './operations-helpers.js';

const MODULE = 'operations';

// =============================================================================
// Assets
// =============================================================================
/** Straight-line depreciation life (years) per category, for the book value KPI. */
const LIFE_SQL = `CASE a.category WHEN 'IT' THEN 5 WHEN 'Vehicle' THEN 8 WHEN 'Lab' THEN 10 WHEN 'Furniture' THEN 10
                  WHEN 'Sports' THEN 6 WHEN 'Library' THEN 8 ELSE 15 END`;

const ASSET_STATUS_SQL = `CASE WHEN a.status = 'Active' AND a.next_service_on <= current_date THEN 'Maintenance due' ELSE a.status END`;

const ASSET_SORTS: Record<string, string> = {
  name: 'a.name', code: 'a.code', category: 'a.category', location: 'a.location', purchased: 'a.purchased_on',
  nextService: 'a.next_service_on', status: 'a.status', value: 'a.purchase_value', assigned: 'e.full_name',
};

export async function listAssets(f: Pagination & { campusId?: string; category?: string; status?: string; serviceDue?: number }) {
  const w = new Where().add('a.deleted_at IS NULL');
  w.addIf(f.campusId, 'a.campus_id = ?');
  w.addIf(f.category, 'a.category = ?');
  w.addIf(f.status, `${ASSET_STATUS_SQL} = ?`);
  if (f.serviceDue) w.add(`a.status <> 'Retired' AND a.next_service_on <= current_date + ?::int`, f.serviceDue);
  if (f.q) w.add('(a.name ILIKE ? OR a.code ILIKE ? OR a.location ILIKE ?)', likeTerm(f.q), likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT a.id, a.code, a.name, a.category, a.location, a.campus_id AS "campusId", cp.short_name AS "campusName",
            a.facility_id AS "facilityId", fa.name AS "facilityName",
            a.assigned_to AS "assignedTo", e.full_name AS "assignedName", e.designation AS "assignedRole",
            a.purchased_on AS "purchasedOn", a.purchase_value AS "purchaseValue", a.next_service_on AS "nextServiceOn",
            (a.next_service_on - current_date) AS "serviceInDays",
            ${ASSET_STATUS_SQL} AS status, a.status AS "storedStatus",
            count(*) OVER() AS total
       FROM assets a
       JOIN campuses cp ON cp.id = a.campus_id
       LEFT JOIN facilities fa ON fa.id = a.facility_id
       LEFT JOIN employees e ON e.id = a.assigned_to
       ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, ASSET_SORTS, 'name')}, a.code
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`, w.params);
  return splitTotal(rows);
}

export async function assetSummary(campusId?: string) {
  return one(
    `SELECT count(*) FILTER (WHERE a.status <> 'Retired')::int AS total,
            count(*) FILTER (WHERE a.status <> 'Retired' AND a.next_service_on <= current_date + 30)::int AS "serviceDue30",
            count(*) FILTER (WHERE a.status <> 'Retired' AND a.next_service_on < current_date)::int AS "serviceOverdue",
            count(*) FILTER (WHERE a.status = 'In maintenance')::int AS "inMaintenance",
            COALESCE(round(sum(GREATEST(0, a.purchase_value * (1 - (current_date - COALESCE(a.purchased_on, current_date)) / 365.25 / ${LIFE_SQL})))
                     FILTER (WHERE a.status <> 'Retired')), 0)::numeric AS "bookValue",
            COALESCE(sum(a.purchase_value) FILTER (WHERE a.status <> 'Retired'), 0)::numeric AS "purchaseValue",
            COALESCE((SELECT json_agg(x ORDER BY x.value DESC) FROM (
               SELECT a2.category AS label, count(*)::int AS value FROM assets a2
                WHERE a2.deleted_at IS NULL AND a2.status <> 'Retired' AND ($1::uuid IS NULL OR a2.campus_id = $1)
                GROUP BY a2.category) x), '[]') AS "byCategory"
       FROM assets a WHERE a.deleted_at IS NULL AND ($1::uuid IS NULL OR a.campus_id = $1)`, [campusId ?? null]);
}

const ASSET_COLS: Record<string, string> = {
  campusId: 'campus_id', name: 'name', category: 'category', location: 'location', facilityId: 'facility_id',
  assignedTo: 'assigned_to', purchasedOn: 'purchased_on', purchaseValue: 'purchase_value', nextServiceOn: 'next_service_on', status: 'status',
};

export async function createAsset(req: Request, b: any) {
  await assertCampus(b.campusId);
  return tx(async (db) => {
    const code = await nextCode('assets', 'code', 'AST-', db);
    const r = await one<{ id: string }>(
      `INSERT INTO assets (code, campus_id, name, category, location, facility_id, assigned_to, purchased_on, purchase_value, next_service_on, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [code, b.campusId, b.name, b.category, b.location ?? null, b.facilityId ?? null, b.assignedTo ?? null, b.purchasedOn ?? null,
        b.purchaseValue ?? null, b.nextServiceOn ?? null, b.status], db);
    await audit(req, { action: 'create', module: MODULE, description: `Added asset ${code} — ${b.name}`, entityType: 'asset', entityId: r!.id }, db);
    return { id: r!.id, code };
  });
}

export async function updateAsset(req: Request, id: string, b: any) {
  if (b.campusId) await assertCampus(b.campusId);
  const { row, keys } = await updateById<{ code: string }>('assets', id, b, ASSET_COLS, { where: 'AND deleted_at IS NULL', returning: 'code' });
  if (!row) throw notFound('Asset not found');
  await audit(req, { action: 'update', module: MODULE, description: `Updated asset ${row.code}`, entityType: 'asset', entityId: id, metadata: { changed: keys } });
}

export async function retireAsset(req: Request, id: string) {
  const r = await one<{ code: string }>(
    `UPDATE assets SET status = 'Retired', deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING code`, [id]);
  if (!r) throw notFound('Asset not found');
  await audit(req, { action: 'delete', module: MODULE, description: `Retired asset ${r.code}`, entityType: 'asset', entityId: id });
}

export async function recordService(req: Request, id: string, b: { servicedOn: string; nextServiceOn: string; note?: string | null }) {
  const r = await one<{ code: string; name: string }>(
    `UPDATE assets SET next_service_on = $2, status = CASE WHEN status = 'Retired' THEN status ELSE 'Active' END
      WHERE id = $1 AND deleted_at IS NULL RETURNING code, name`, [id, b.nextServiceOn]);
  if (!r) throw notFound('Asset not found');
  await audit(req, {
    action: 'update', module: MODULE, description: `Recorded service for ${r.code} on ${b.servicedOn}; next due ${b.nextServiceOn}`,
    entityType: 'asset', entityId: id, metadata: { note: b.note ?? null },
  });
}

// =============================================================================
// Facilities & bookings
// =============================================================================
/** Weekly utilisation = booked hours this school week (Mon–Fri) ÷ 40 teaching hours. */
export async function listFacilities(campusId?: string, q?: string) {
  const w = new Where();
  w.addIf(campusId, 'f.campus_id = ?');
  if (q) w.add('f.name ILIKE ?', likeTerm(q));
  return many(
    `SELECT f.id, f.name, f.facility_type AS "facilityType", f.capacity, f.status, f.campus_id AS "campusId", cp.short_name AS "campusName",
            COALESCE(wk.hours, 0)::float AS "bookedHours",
            LEAST(100, round(100 * COALESCE(wk.hours, 0) / 40.0))::int AS utilisation,
            COALESCE(td.items, '[]') AS today,
            (SELECT count(*) FROM maintenance_requests m WHERE m.facility_id = f.id AND m.status NOT IN ('Completed', 'Rejected'))::int AS "openRequests"
       FROM facilities f
       JOIN campuses cp ON cp.id = f.campus_id
       LEFT JOIN LATERAL (
         SELECT sum(extract(epoch FROM (b.ends_at - b.starts_at)) / 3600) AS hours
           FROM facility_bookings b
          WHERE b.facility_id = f.id AND b.status = 'Booked'
            AND b.booked_on BETWEEN date_trunc('week', current_date)::date AND date_trunc('week', current_date)::date + 4) wk ON true
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object('id', b.id, 'purpose', b.purpose, 'startsAt', to_char(b.starts_at, 'HH24:MI'), 'endsAt', to_char(b.ends_at, 'HH24:MI')) ORDER BY b.starts_at) AS items
           FROM facility_bookings b WHERE b.facility_id = f.id AND b.status = 'Booked' AND b.booked_on = current_date) td ON true
       ${w.sql}
      ORDER BY cp.established, f.name`, w.params);
}

const FACILITY_COLS: Record<string, string> = { campusId: 'campus_id', name: 'name', facilityType: 'facility_type', capacity: 'capacity', status: 'status' };

export async function createFacility(req: Request, b: any) {
  await assertCampus(b.campusId);
  const r = await one<{ id: string }>(
    `INSERT INTO facilities (campus_id, name, facility_type, capacity, status) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [b.campusId, b.name, b.facilityType, b.capacity ?? null, b.status]);
  await audit(req, { action: 'create', module: MODULE, description: `Added facility ${b.name}`, entityType: 'facility', entityId: r!.id });
  return { id: r!.id };
}

export async function updateFacility(req: Request, id: string, b: any) {
  if (b.campusId) await assertCampus(b.campusId);
  const { row, keys } = await updateById<{ name: string }>('facilities', id, b, FACILITY_COLS, { returning: 'name' });
  if (!row) throw notFound('Facility not found');
  await audit(req, { action: 'update', module: MODULE, description: `Updated facility ${row.name}`, entityType: 'facility', entityId: id, metadata: { changed: keys } });
}

export async function listBookings(facilityId: string, from?: string, to?: string) {
  const f = await one('SELECT id, name FROM facilities WHERE id = $1', [facilityId]);
  if (!f) throw notFound('Facility not found');
  const rows = await many(
    `SELECT b.id, b.booked_on AS "bookedOn", to_char(b.starts_at, 'HH24:MI') AS "startsAt", to_char(b.ends_at, 'HH24:MI') AS "endsAt",
            b.purpose, b.status, u.full_name AS "bookedBy", b.booked_by AS "bookedById"
       FROM facility_bookings b LEFT JOIN users u ON u.id = b.booked_by
      WHERE b.facility_id = $1 AND b.status = 'Booked'
        AND b.booked_on BETWEEN COALESCE($2::date, current_date) AND COALESCE($3::date, current_date + 13)
      ORDER BY b.booked_on, b.starts_at`, [facilityId, from ?? null, to ?? null]);
  return { facility: f, bookings: rows };
}

export async function createBooking(req: Request, facilityId: string, b: { bookedOn: string; startsAt: string; endsAt: string; purpose: string }) {
  return tx(async (db) => {
    const f = await one<{ name: string; status: string }>('SELECT name, status FROM facilities WHERE id = $1 FOR UPDATE', [facilityId], db);
    if (!f) throw notFound('Facility not found');
    if (f.status === 'Closed' || f.status === 'Maintenance') throw badRequest(`${f.name} cannot be booked while it is ${f.status.toLowerCase()}`, 'FACILITY_UNAVAILABLE');
    const clash = await one<{ purpose: string; s: string; e: string }>(
      `SELECT purpose, to_char(starts_at, 'HH24:MI') AS s, to_char(ends_at, 'HH24:MI') AS e FROM facility_bookings
        WHERE facility_id = $1 AND booked_on = $2 AND status = 'Booked' AND starts_at < $4::time AND ends_at > $3::time LIMIT 1`,
      [facilityId, b.bookedOn, b.startsAt, b.endsAt], db);
    if (clash) throw conflict(`${f.name} is already booked ${clash.s}–${clash.e} (${clash.purpose})`, 'BOOKING_CLASH');
    const r = await one<{ id: string }>(
      `INSERT INTO facility_bookings (facility_id, booked_on, starts_at, ends_at, purpose, booked_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [facilityId, b.bookedOn, b.startsAt, b.endsAt, b.purpose, req.user!.id], db);
    await audit(req, { action: 'create', module: MODULE, description: `Booked ${f.name} on ${b.bookedOn} ${b.startsAt}–${b.endsAt}`, entityType: 'facility_booking', entityId: r!.id }, db);
    return { id: r!.id };
  });
}

export async function cancelBooking(req: Request, id: string) {
  const b = await one<{ booked_by: string | null; name: string; booked_on: string }>(
    `SELECT b.booked_by, f.name, b.booked_on FROM facility_bookings b JOIN facilities f ON f.id = b.facility_id WHERE b.id = $1 AND b.status = 'Booked'`, [id]);
  if (!b) throw notFound('Booking not found');
  if (b.booked_by !== req.user!.id && !req.user!.permissions.has('operations.manage')) throw forbidden('You can only cancel your own bookings');
  await query(`UPDATE facility_bookings SET status = 'Cancelled' WHERE id = $1`, [id]);
  await audit(req, { action: 'delete', module: MODULE, description: `Cancelled booking of ${b.name} on ${b.booked_on}`, entityType: 'facility_booking', entityId: id });
}

// =============================================================================
// Maintenance
// =============================================================================
const MR_NEXT: Record<string, string[]> = {
  Submitted: ['Under Review', 'Approved', 'Rejected'],
  'Under Review': ['Approved', 'Rejected'],
  Approved: ['In Progress', 'Rejected'],
  'In Progress': ['Completed'],
  Completed: [],
  Rejected: [],
};

const MR_SORTS: Record<string, string> = {
  code: `substring(m.code FROM 4)::int`, date: 'm.raised_on', priority: `array_position(ARRAY['Urgent','High','Medium','Low'], m.priority)`,
  status: `array_position(ARRAY['Submitted','Under Review','Approved','In Progress','Completed','Rejected'], m.status)`,
  item: 'm.description', raised: 'rb.full_name',
};

export async function listMaintenance(req: Request, f: Pagination & { campusId?: string; status?: string; priority?: string; mine?: boolean }) {
  const w = new Where();
  w.addIf(f.campusId, 'm.campus_id = ?');
  if (f.status === 'open') w.add(`m.status NOT IN ('Completed', 'Rejected')`);
  else w.addIf(f.status, 'm.status = ?');
  w.addIf(f.priority, 'm.priority = ?');
  if (f.mine) w.add('m.raised_by = ?', req.user!.employeeId);
  if (f.q) w.add('(m.description ILIKE ? OR m.code ILIKE ?)', likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT m.id, m.code, m.description, m.priority, m.status, m.raised_on AS "raisedOn", m.completed_at AS "completedAt", m.cost,
            m.campus_id AS "campusId", cp.short_name AS "campusName",
            m.raised_by AS "raisedById", rb.full_name AS "raisedBy", m.assigned_to AS "assignedToId", asg.full_name AS "assignedTo",
            m.asset_id AS "assetId", a.code AS "assetCode", a.name AS "assetName", m.facility_id AS "facilityId", fa.name AS "facilityName",
            (current_date - m.raised_on) AS "ageDays",
            count(*) OVER() AS total
       FROM maintenance_requests m
       JOIN campuses cp ON cp.id = m.campus_id
       LEFT JOIN employees rb ON rb.id = m.raised_by
       LEFT JOIN employees asg ON asg.id = m.assigned_to
       LEFT JOIN assets a ON a.id = m.asset_id
       LEFT JOIN facilities fa ON fa.id = m.facility_id
       ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, MR_SORTS, 'date')}, m.code DESC
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`, w.params);
  return splitTotal(rows);
}

export async function maintenanceSummary(campusId?: string) {
  const s = await one(
    `SELECT count(*) FILTER (WHERE status NOT IN ('Completed', 'Rejected'))::int AS open,
            count(*) FILTER (WHERE status NOT IN ('Completed', 'Rejected') AND priority IN ('High', 'Urgent'))::int AS "highPriority",
            count(*) FILTER (WHERE status IN ('Submitted', 'Under Review'))::int AS "awaitingDecision",
            count(*) FILTER (WHERE status = 'Completed' AND completed_at >= date_trunc('month', now()))::int AS "closedThisMonth",
            round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (completed_at - raised_on::timestamptz)) / 86400)
                   FILTER (WHERE status = 'Completed' AND completed_at > now() - interval '90 days'))::numeric, 1)::float AS "medianDaysToClose",
            COALESCE(sum(cost) FILTER (WHERE status = 'Completed' AND completed_at >= date_trunc('month', now())), 0)::numeric AS "costThisMonth"
       FROM maintenance_requests WHERE ($1::uuid IS NULL OR campus_id = $1)`, [campusId ?? null]);
  return s;
}

export async function createMaintenance(req: Request, b: any) {
  const u = req.user!;
  const campusId = b.campusId ?? u.campusId;
  if (!campusId) throw badRequest('Choose a campus', 'CAMPUS_REQUIRED');
  await assertCampus(campusId);
  return tx(async (db) => {
    if (b.assetId) {
      const a = await one('SELECT 1 FROM assets WHERE id = $1 AND deleted_at IS NULL', [b.assetId], db);
      if (!a) throw badRequest('Asset not found', 'ASSET_NOT_FOUND');
    }
    if (b.facilityId) {
      const fa = await one('SELECT 1 FROM facilities WHERE id = $1', [b.facilityId], db);
      if (!fa) throw badRequest('Facility not found', 'FACILITY_NOT_FOUND');
    }
    const code = await nextCode('maintenance_requests', 'code', 'MR-', db, 3);
    const r = await one<{ id: string }>(
      `INSERT INTO maintenance_requests (code, campus_id, asset_id, facility_id, description, priority, raised_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [code, campusId, b.assetId ?? null, b.facilityId ?? null, b.description, b.priority, u.employeeId], db);
    await audit(req, { action: 'create', module: MODULE, description: `Raised maintenance request ${code} — ${b.description}`, entityType: 'maintenance_request', entityId: r!.id }, db);
    await notifyRoles(['principal', 'school_admin', 'super_admin'], {
      category: b.priority === 'High' || b.priority === 'Urgent' ? 'Attention' : 'Information', topic: 'operations', icon: 'wrench',
      title: `${code}: ${b.description}`, body: `${b.priority} priority · raised by ${u.fullName}`, route: '/maintenance', entityType: 'maintenance_request', entityId: r!.id,
    }, db);
    return { id: r!.id, code };
  });
}

export async function updateMaintenanceStatus(req: Request, id: string, b: { status: string; assignedTo?: string | null; cost?: number | null; note?: string | null }) {
  return tx(async (db) => {
    const m = await one<{ code: string; status: string; asset_id: string | null; raiser_user: string | null; description: string }>(
      `SELECT m.code, m.status, m.asset_id, e.user_id AS raiser_user, m.description
         FROM maintenance_requests m LEFT JOIN employees e ON e.id = m.raised_by WHERE m.id = $1 FOR UPDATE OF m`, [id], db);
    if (!m) throw notFound('Maintenance request not found');
    if (b.status !== m.status && !MR_NEXT[m.status]?.includes(b.status)) {
      throw badRequest(`A request that is ${m.status} cannot move to ${b.status}`, 'INVALID_TRANSITION');
    }
    if (b.status === 'Completed' && b.cost == null) throw badRequest('Record the cost (0 if none) to complete the request', 'COST_REQUIRED', [{ field: 'cost', message: 'Required to complete' }]);
    await query(
      `UPDATE maintenance_requests
          SET status = $2,
              assigned_to = COALESCE($3, assigned_to),
              cost = COALESCE($4, cost),
              completed_at = CASE WHEN $2 = 'Completed' THEN now() ELSE completed_at END
        WHERE id = $1`, [id, b.status, b.assignedTo ?? null, b.cost ?? null], db);
    if (m.asset_id && b.status === 'In Progress') await query(`UPDATE assets SET status = 'In maintenance' WHERE id = $1 AND status <> 'Retired'`, [m.asset_id], db);
    if (m.asset_id && b.status === 'Completed') await query(`UPDATE assets SET status = 'Active' WHERE id = $1 AND status = 'In maintenance'`, [m.asset_id], db);
    await audit(req, {
      action: b.status === 'Approved' || b.status === 'Rejected' ? 'approve' : 'update', module: MODULE,
      description: `${m.code} moved from ${m.status} to ${b.status}`, entityType: 'maintenance_request', entityId: id,
      metadata: { note: b.note ?? null, cost: b.cost ?? null },
    }, db);
    if (m.raiser_user && m.raiser_user !== req.user!.id && b.status !== m.status) {
      await notifyUsers([m.raiser_user], {
        category: b.status === 'Completed' ? 'Completed' : b.status === 'Rejected' ? 'Attention' : 'Information', topic: 'operations', icon: 'wrench',
        title: `${m.code} is now ${b.status}`, body: b.note ?? m.description, route: '/maintenance', entityType: 'maintenance_request', entityId: id,
      }, db);
    }
  });
}

// =============================================================================
// Inventory
// =============================================================================
const LEVEL_SQL = `CASE WHEN i.quantity < i.reorder_level THEN 'Reorder' WHEN i.quantity = i.reorder_level THEN 'At minimum' ELSE 'In stock' END`;
const INV_SORTS: Record<string, string> = {
  name: 'i.name', category: 'i.category', quantity: 'i.quantity', reorder: 'i.reorder_level', sku: 'i.sku',
  level: `i.quantity::float / NULLIF(i.reorder_level, 0)`, value: 'i.quantity * i.unit_cost', status: LEVEL_SQL,
};

export async function listInventory(f: Pagination & { campusId?: string; category?: string; level?: string }) {
  const w = new Where();
  w.addIf(f.campusId, 'i.campus_id = ?');
  w.addIf(f.category, 'i.category = ?');
  if (f.level === 'low') w.add('i.quantity < i.reorder_level');
  if (f.level === 'at_minimum') w.add('i.quantity = i.reorder_level');
  if (f.level === 'ok') w.add('i.quantity > i.reorder_level');
  if (f.q) w.add('(i.name ILIKE ? OR i.sku ILIKE ?)', likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT i.id, i.sku, i.name, i.category, i.unit, i.quantity, i.reorder_level AS "reorderLevel", i.unit_cost AS "unitCost",
            (i.quantity * i.unit_cost)::numeric AS "stockValue", ${LEVEL_SQL} AS status,
            i.campus_id AS "campusId", cp.short_name AS "campusName", v.name AS vendor,
            (SELECT max(mv.created_at) FROM inventory_movements mv WHERE mv.item_id = i.id) AS "lastMovementAt",
            count(*) OVER() AS total
       FROM inventory_items i
       JOIN campuses cp ON cp.id = i.campus_id
       LEFT JOIN vendors v ON v.id = i.vendor_id
       ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, INV_SORTS, 'name')}, i.name
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`, w.params);
  return splitTotal(rows);
}

export async function inventorySummary(campusId?: string) {
  return one(
    `SELECT count(*)::int AS items,
            count(*) FILTER (WHERE quantity < reorder_level)::int AS "belowReorder",
            count(*) FILTER (WHERE quantity = reorder_level)::int AS "atMinimum",
            COALESCE(sum(quantity * unit_cost), 0)::numeric AS "stockValue",
            COALESCE(json_agg(name ORDER BY quantity::float / NULLIF(reorder_level, 0)) FILTER (WHERE quantity < reorder_level), '[]') AS "lowItems",
            (SELECT count(*) FROM inventory_movements mv JOIN inventory_items i2 ON i2.id = mv.item_id
              WHERE mv.created_at > now() - interval '30 days' AND ($1::uuid IS NULL OR i2.campus_id = $1))::int AS "movements30d"
       FROM inventory_items WHERE ($1::uuid IS NULL OR campus_id = $1)`, [campusId ?? null]);
}

export async function inventoryCategories() {
  return (await many<{ category: string }>('SELECT DISTINCT category FROM inventory_items ORDER BY category')).map((r) => r.category);
}

export async function createInventoryItem(req: Request, b: any) {
  await assertCampus(b.campusId);
  return tx(async (db) => {
    const sku = b.sku ?? (await nextCode('inventory_items', 'sku', 'INV-', db));
    const dup = await one('SELECT 1 FROM inventory_items WHERE sku = $1', [sku], db);
    if (dup) throw conflict(`SKU ${sku} already exists`, 'SKU_EXISTS');
    const r = await one<{ id: string }>(
      `INSERT INTO inventory_items (sku, campus_id, name, category, unit, quantity, reorder_level, unit_cost)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [sku, b.campusId, b.name, b.category, b.unit, b.quantity, b.reorderLevel, b.unitCost], db);
    if (b.quantity > 0) {
      await query(`INSERT INTO inventory_movements (item_id, movement_type, quantity, note, moved_by) VALUES ($1, 'in', $2, 'Opening stock', $3)`,
        [r!.id, b.quantity, req.user!.id], db);
    }
    await audit(req, { action: 'create', module: MODULE, description: `Added inventory item ${sku} — ${b.name}`, entityType: 'inventory_item', entityId: r!.id }, db);
    return { id: r!.id, sku };
  });
}

const INV_COLS: Record<string, string> = { campusId: 'campus_id', name: 'name', category: 'category', unit: 'unit', reorderLevel: 'reorder_level', unitCost: 'unit_cost' };

export async function updateInventoryItem(req: Request, id: string, b: any) {
  if (b.campusId) await assertCampus(b.campusId);
  const { row, keys } = await updateById<{ sku: string }>('inventory_items', id, b, INV_COLS, { returning: 'sku' });
  if (!row) throw notFound('Inventory item not found');
  await audit(req, { action: 'update', module: MODULE, description: `Updated inventory item ${row.sku}`, entityType: 'inventory_item', entityId: id, metadata: { changed: keys } });
}

export async function recordMovement(req: Request, id: string, b: { movementType: 'in' | 'out' | 'adjust'; quantity: number; note?: string | null }) {
  return tx(async (db) => {
    const i = await one<{ sku: string; name: string; quantity: number; reorder_level: number; unit: string }>(
      'SELECT sku, name, quantity, reorder_level, unit FROM inventory_items WHERE id = $1 FOR UPDATE', [id], db);
    if (!i) throw notFound('Inventory item not found');
    let next = i.quantity;
    let delta = b.quantity;
    if (b.movementType === 'in') next = i.quantity + b.quantity;
    if (b.movementType === 'out') {
      if (b.quantity > i.quantity) throw badRequest(`Only ${i.quantity} ${i.unit} in stock`, 'INSUFFICIENT_STOCK', [{ field: 'quantity', message: `Only ${i.quantity} ${i.unit} in stock` }]);
      next = i.quantity - b.quantity;
      delta = -b.quantity;
    }
    if (b.movementType === 'adjust') {
      if (!b.note) throw badRequest('Give a reason for the stock adjustment', 'REASON_REQUIRED', [{ field: 'note', message: 'Reason required for adjustments' }]);
      next = b.quantity;
      delta = b.quantity - i.quantity;
    }
    await query('UPDATE inventory_items SET quantity = $2 WHERE id = $1', [id, next], db);
    await query('INSERT INTO inventory_movements (item_id, movement_type, quantity, note, moved_by) VALUES ($1,$2,$3,$4,$5)',
      [id, b.movementType, delta, b.note ?? null, req.user!.id], db);
    await audit(req, {
      action: 'update', module: MODULE, description: `Stock ${b.movementType} ${Math.abs(delta)} ${i.unit} — ${i.name} (${i.quantity} → ${next})`,
      entityType: 'inventory_item', entityId: id,
    }, db);
    if (next < i.reorder_level && i.quantity >= i.reorder_level) {
      await notifyRoles(['office', 'principal'], {
        category: 'Attention', topic: 'operations', icon: 'layers', title: `${i.name} is below the reorder point`,
        body: `${next} ${i.unit} left (reorder at ${i.reorder_level})`, route: '/inventory', entityType: 'inventory_item', entityId: id,
      }, db);
    }
    return { quantity: next };
  });
}

export async function listMovements(f: Pagination & { itemId?: string; campusId?: string }) {
  const w = new Where();
  w.addIf(f.itemId, 'mv.item_id = ?');
  w.addIf(f.campusId, 'i.campus_id = ?');
  if (f.q) w.add('(i.name ILIKE ? OR mv.note ILIKE ?)', likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT mv.id, mv.created_at AS "createdAt", mv.movement_type AS "movementType", mv.quantity, mv.note,
            i.id AS "itemId", i.name AS "itemName", i.sku, i.unit, u.full_name AS "movedBy", count(*) OVER() AS total
       FROM inventory_movements mv JOIN inventory_items i ON i.id = mv.item_id
       LEFT JOIN users u ON u.id = mv.moved_by
       ${w.sql}
      ORDER BY mv.created_at DESC, mv.id DESC
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`, w.params);
  return splitTotal(rows);
}

export async function purchaseRequest(req: Request, id: string, b: { quantity: number; note?: string | null }) {
  const i = await one<{ sku: string; name: string; unit: string; quantity: number }>('SELECT sku, name, unit, quantity FROM inventory_items WHERE id = $1', [id]);
  if (!i) throw notFound('Inventory item not found');
  await notifyRoles(['finance', 'principal'], {
    category: 'Attention', topic: 'operations', icon: 'layers',
    title: `Purchase request: ${b.quantity} ${i.unit} of ${i.name}`,
    body: `${i.sku} · ${i.quantity} in stock · requested by ${req.user!.fullName}${b.note ? ` — ${b.note}` : ''}`,
    route: '/inventory', entityType: 'inventory_item', entityId: id,
  });
  await audit(req, { action: 'create', module: MODULE, description: `Raised purchase request for ${b.quantity} ${i.unit} of ${i.name}`, entityType: 'inventory_item', entityId: id, metadata: { quantity: b.quantity, note: b.note ?? null } });
}
