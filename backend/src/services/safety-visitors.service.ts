import type { Request } from 'express';
import { many, one, query, tx } from '../config/db.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { nextCode } from '../utils/codes.js';
import { likeTerm, limitOffset, orderBy, type Pagination } from '../utils/pagination.js';
import { Where } from '../utils/sql.js';
import { audit } from './audit.service.js';
import { notifyUsers } from './notification.service.js';
import { employeeUserId, hhmm, localDate, TODAY } from './safety-common.service.js';

const SELECT = `
  SELECT v.id, v.badge_no AS "badgeNo", v.full_name AS "fullName", v.phone, v.purpose, v.status,
         v.checked_in_at AS "checkedInAt", v.checked_out_at AS "checkedOutAt",
         v.host_employee_id AS "hostId", e.full_name AS "hostName", e.designation AS "hostDesignation",
         v.campus_id AS "campusId", cp.short_name AS "campusName", u.full_name AS "createdByName", v.created_at AS "createdAt"
    FROM visitors v
    JOIN campuses cp ON cp.id = v.campus_id
    LEFT JOIN employees e ON e.id = v.host_employee_id
    LEFT JOIN users u ON u.id = v.created_by`;

const SORTS: Record<string, string> = {
  badge: 'x."badgeNo"', name: 'x."fullName"', host: 'x."hostName"', in: 'x."checkedInAt"', out: 'x."checkedOutAt"', status: 'x.status',
};

export interface VisitorFilters extends Pagination {
  campusId?: string;
  date?: string;
  status?: 'Expected' | 'Inside' | 'Completed' | 'Denied';
}

/** Visits for a day. Visitors still inside from earlier days always show on today's list. */
export async function listVisitors(f: VisitorFilters) {
  const w = new Where();
  const day = w.param(f.date ?? null);
  w.add(`(${localDate('v.checked_in_at')} = COALESCE(${day}::date, ${TODAY})
          OR (v.status = 'Inside' AND COALESCE(${day}::date, ${TODAY}) = ${TODAY}))`);
  w.addIf(f.campusId, 'v.campus_id = ?');
  w.addIf(f.status, 'v.status = ?');
  if (f.q) w.add('(v.full_name ILIKE ? OR v.badge_no ILIKE ? OR v.purpose ILIKE ?)', likeTerm(f.q), likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT x.*, count(*) OVER() AS total FROM (${SELECT} ${w.sql}) x
      ORDER BY ${orderBy(f.sort, f.dir, SORTS, 'in')}, x."badgeNo" DESC
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export async function visitorSummary(campusId?: string) {
  const w = new Where();
  w.addIf(campusId, 'v.campus_id = ?');
  const r = await one(
    `SELECT count(*) FILTER (WHERE v.status = 'Inside')::int AS "onSite",
            count(*) FILTER (WHERE ${localDate('v.checked_in_at')} = ${TODAY} AND v.status IN ('Inside', 'Completed'))::int AS today,
            count(*) FILTER (WHERE v.status = 'Expected' AND ${localDate('v.checked_in_at')} >= ${TODAY})::int AS "preApproved",
            count(*) FILTER (WHERE v.status = 'Inside' AND ${localDate('v.checked_in_at')} < ${TODAY})::int AS "notCheckedOut",
            count(*) FILTER (WHERE v.status = 'Completed' AND ${localDate('v.checked_out_at')} = ${TODAY})::int AS "checkedOutToday",
            count(*) FILTER (WHERE v.status = 'Denied' AND ${localDate('v.checked_in_at')} = ${TODAY})::int AS "deniedToday"
       FROM visitors v ${w.sql}`,
    w.params,
  );
  return r;
}

async function getVisitor(id: string) {
  const r = await one(`${SELECT} WHERE v.id = $1`, [id]);
  if (!r) throw notFound('Visitor not found', 'VISITOR_NOT_FOUND');
  return r;
}

export interface VisitorInput {
  fullName: string;
  phone?: string;
  purpose: string;
  hostEmployeeId: string;
  campusId?: string;
  expectedAt?: string;
}

export async function createVisitor(req: Request, input: VisitorInput) {
  const host = await one<{ id: string; campus_id: string; full_name: string; user_id: string | null }>(
    'SELECT id, campus_id, full_name, user_id FROM employees WHERE id = $1 AND deleted_at IS NULL', [input.hostEmployeeId],
  );
  if (!host) throw badRequest('Choose a host from the staff list', 'HOST_NOT_FOUND', [{ field: 'hostEmployeeId', message: 'Unknown host' }]);
  let campusId = input.campusId ?? host.campus_id;
  if (input.campusId) {
    const c = await one('SELECT 1 FROM campuses WHERE id = $1', [input.campusId]);
    if (!c) throw badRequest('Unknown campus', 'CAMPUS_NOT_FOUND');
  } else campusId = host.campus_id;
  const expected = input.expectedAt ? new Date(input.expectedAt) : null;
  if (expected && expected.getTime() < Date.now() - 5 * 60_000) {
    throw badRequest('A pre-approved visit must be in the future', 'VISIT_IN_PAST', [{ field: 'expectedAt', message: 'Choose a future time' }]);
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const id = await tx(async (db) => {
        const badge = await nextCode('visitors', 'badge_no', 'V-', db);
        const row = await one<{ id: string; checked_in_at: Date }>(
          `INSERT INTO visitors (campus_id, badge_no, full_name, phone, purpose, host_employee_id, checked_in_at, status, created_by)
           VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7::timestamptz, now()), $8, $9) RETURNING id, checked_in_at`,
          [campusId, badge, input.fullName, input.phone ?? null, input.purpose, host.id, expected, expected ? 'Expected' : 'Inside', req.user!.id],
          db,
        );
        if (host.user_id) {
          await notifyUsers([host.user_id], {
            category: expected ? 'Information' : 'Attention', icon: 'idCard', topic: 'safety',
            title: expected
              ? `Visitor pre-approved: ${input.fullName} (${badge})`
              : `Your visitor ${input.fullName} has arrived — badge ${badge}`,
            body: `${input.purpose}${expected ? ` · expected ${expected.toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ` · checked in ${hhmm(row!.checked_in_at)}`}`,
            route: '/visitors', entityType: 'visitor', entityId: row!.id,
          }, db);
        }
        await audit(req, {
          action: 'create', module: 'safety',
          description: `${expected ? 'Pre-approved' : 'Checked in'} visitor ${input.fullName} (${badge}) — host ${host.full_name}`,
          entityType: 'visitor', entityId: row!.id, metadata: { purpose: input.purpose },
        }, db);
        return row!.id;
      });
      return getVisitor(id);
    } catch (err) {
      // Two check-ins at the same moment can race for a badge number; retry.
      if ((err as { code?: string }).code === '23505' && attempt < 2) continue;
      throw err;
    }
  }
  throw conflict('Could not allocate a badge number, try again', 'BADGE_CONFLICT');
}

async function transition(req: Request, id: string, from: string[], to: 'Inside' | 'Completed' | 'Denied', set: string, verb: string) {
  const v = await one<{ id: string; status: string; full_name: string; badge_no: string; host_employee_id: string | null }>(
    'SELECT id, status, full_name, badge_no, host_employee_id FROM visitors WHERE id = $1', [id],
  );
  if (!v) throw notFound('Visitor not found', 'VISITOR_NOT_FOUND');
  if (!from.includes(v.status)) throw conflict(`${v.full_name} is ${v.status.toLowerCase()} and cannot be ${verb}`, 'VISITOR_STATE');
  await tx(async (db) => {
    // Re-check the state in the UPDATE itself so a double submit cannot apply the transition twice.
    const r = await query(`UPDATE visitors SET status = $2, ${set} WHERE id = $1 AND status = ANY($3)`, [id, to, from], db);
    if (!r.rowCount) throw conflict(`${v.full_name} has already been updated. Reload and try again.`, 'VISITOR_STATE');
    if (to === 'Inside') {
      const uid = await employeeUserId(v.host_employee_id, db);
      if (uid) {
        await notifyUsers([uid], {
          category: 'Attention', icon: 'idCard', topic: 'safety',
          title: `Your visitor ${v.full_name} has arrived — badge ${v.badge_no}`, route: '/visitors', entityType: 'visitor', entityId: id,
        }, db);
      }
    }
    await audit(req, {
      action: 'update', module: 'safety', description: `Visitor ${v.full_name} (${v.badge_no}) ${verb}`,
      entityType: 'visitor', entityId: id,
    }, db);
  });
  return getVisitor(id);
}

export const checkIn = (req: Request, id: string) => transition(req, id, ['Expected'], 'Inside', 'checked_in_at = now()', 'checked in');
export const checkOut = (req: Request, id: string) => transition(req, id, ['Inside'], 'Completed', 'checked_out_at = now()', 'checked out');
export const deny = (req: Request, id: string) => transition(req, id, ['Expected'], 'Denied', 'checked_out_at = NULL', 'denied entry');
