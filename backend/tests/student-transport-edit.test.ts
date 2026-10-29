/**
 * Editing a student's transport: change route and stop, switch to own transport, and
 * refuse stops off the route or routes from another campus.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { as } from './helpers.js';
import { one, pool } from '../src/config/db.js';

afterAll(() => pool.end());

describe('student transport on edit', () => {
  it('changes the route and stop, clears to own transport, and validates the choice', async () => {
    const api = await as('principal');
    const s = (await one<{ id: string; campus_id: string }>(`SELECT id, campus_id FROM students WHERE admission_no = 'HS-2026-1043'`))!;
    const route = (await one<{ id: string }>(
      `SELECT r.id FROM transport_routes r WHERE r.campus_id = $1 AND (SELECT count(*) FROM route_stops x WHERE x.route_id = r.id) >= 2
        ORDER BY r.code LIMIT 1`, [s.campus_id]))!;
    const stop = (await one<{ id: string }>('SELECT id FROM route_stops WHERE route_id = $1 ORDER BY sequence DESC LIMIT 1', [route.id]))!;

    expect((await api.put(`/api/students/${s.id}`, { transport: { routeId: route.id, stopId: stop.id } })).status).toBe(200);
    expect(await one('SELECT route_id, stop_id FROM student_transport WHERE student_id = $1', [s.id])).toEqual({ route_id: route.id, stop_id: stop.id });
    const profile = await api.get(`/api/students/${s.id}/profile`);
    expect(profile.body.data.transport).toMatchObject({ routeId: route.id, stopId: stop.id });

    // A stop from another route is refused
    const otherStop = (await one<{ id: string }>('SELECT id FROM route_stops WHERE route_id <> $1 LIMIT 1', [route.id]))!;
    const bad = await api.put(`/api/students/${s.id}`, { transport: { routeId: route.id, stopId: otherStop.id } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('STOP_NOT_ON_ROUTE');

    // A route on another campus is refused
    const away = await one<{ id: string }>('SELECT id FROM transport_routes WHERE campus_id <> $1 LIMIT 1', [s.campus_id]);
    if (away) {
      const r = await api.put(`/api/students/${s.id}`, { transport: { routeId: away.id } });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('ROUTE_CAMPUS_MISMATCH');
    }

    // null = own transport
    expect((await api.put(`/api/students/${s.id}`, { transport: null })).status).toBe(200);
    expect(await one('SELECT 1 FROM student_transport WHERE student_id = $1', [s.id])).toBeNull();
    expect((await api.get(`/api/students/${s.id}/profile`)).body.data.transport).toBeNull();
  });
});
