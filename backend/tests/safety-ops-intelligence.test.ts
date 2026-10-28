/** Regression tests for safety, operations and intelligence fixes (partial updates, double submits, OTP limits). */
import { afterAll, describe, expect, it } from 'vitest';
import { as } from './helpers.js';
import { one, pool, query } from '../src/config/db.js';

const cleanup: (() => Promise<unknown>)[] = [];

afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn();
  await pool.end();
});

describe('operations partial updates', () => {
  it('editing an asset name keeps its status', async () => {
    const api = await as('principal');
    const a = await one<{ id: string; name: string; status: string }>(`SELECT id, name, status FROM assets WHERE deleted_at IS NULL AND status = 'In maintenance' LIMIT 1`);
    expect(a).toBeTruthy();
    cleanup.push(() => query('UPDATE assets SET name = $2, status = $3 WHERE id = $1', [a!.id, a!.name, a!.status]));
    const r = await api.put(`/api/assets/${a!.id}`, { name: `${a!.name} (renamed)` });
    expect(r.status).toBe(200);
    const after = await one<{ status: string }>('SELECT status FROM assets WHERE id = $1', [a!.id]);
    expect(after!.status).toBe('In maintenance');
  });

  it('editing a facility name keeps its status', async () => {
    const api = await as('principal');
    const f = await one<{ id: string; name: string; status: string }>(`SELECT id, name, status FROM facilities ORDER BY name LIMIT 1`);
    cleanup.push(() => query('UPDATE facilities SET name = $2, status = $3 WHERE id = $1', [f!.id, f!.name, f!.status]));
    expect((await api.put(`/api/facilities/${f!.id}`, { status: 'Closed' })).status).toBe(200);
    expect((await api.put(`/api/facilities/${f!.id}`, { name: `${f!.name} X` })).status).toBe(200);
    const after = await one<{ status: string }>('SELECT status FROM facilities WHERE id = $1', [f!.id]);
    expect(after!.status).toBe('Closed');
  });

  it('editing an inventory item reorder level keeps its unit cost', async () => {
    const api = await as('principal');
    const i = await one<{ id: string; reorder_level: number; unit_cost: number }>(`SELECT id, reorder_level, unit_cost FROM inventory_items WHERE unit_cost > 0 LIMIT 1`);
    cleanup.push(() => query('UPDATE inventory_items SET reorder_level = $2, unit_cost = $3 WHERE id = $1', [i!.id, i!.reorder_level, i!.unit_cost]));
    expect((await api.put(`/api/inventory/${i!.id}`, { reorderLevel: i!.reorder_level + 1 })).status).toBe(200);
    const after = await one<{ unit_cost: number }>('SELECT unit_cost FROM inventory_items WHERE id = $1', [i!.id]);
    expect(Number(after!.unit_cost)).toBe(Number(i!.unit_cost));
  });
});

describe('maintenance', () => {
  it('re-saving a completed request does not move its completion time', async () => {
    const api = await as('superadmin'); // approving a request is the Super Admin's decision
    const c = await one<{ id: string }>('SELECT id FROM campuses WHERE is_active ORDER BY established LIMIT 1');
    const cr = await api.post('/api/maintenance', { campusId: c!.id, description: 'Test: leaking tap in staff room', priority: 'Low' });
    expect(cr.status).toBe(201);
    const id = cr.body.data.id;
    cleanup.push(() => query('DELETE FROM maintenance_requests WHERE id = $1', [id]));
    for (const status of ['Approved', 'In Progress']) expect((await api.patch(`/api/maintenance/${id}/status`, { status })).status).toBe(200);
    expect((await api.patch(`/api/maintenance/${id}/status`, { status: 'Completed', cost: 0 })).status).toBe(200);
    await query(`UPDATE maintenance_requests SET completed_at = now() - interval '3 days' WHERE id = $1`, [id]);
    const before = await one<{ completed_at: Date }>('SELECT completed_at FROM maintenance_requests WHERE id = $1', [id]);
    expect((await api.patch(`/api/maintenance/${id}/status`, { status: 'Completed', cost: 250 })).status).toBe(200);
    const after = await one<{ completed_at: Date; cost: number }>('SELECT completed_at, cost FROM maintenance_requests WHERE id = $1', [id]);
    expect(after!.completed_at.toISOString()).toBe(before!.completed_at.toISOString());
    expect(Number(after!.cost)).toBe(250);
  });
});

describe('double submits', () => {
  it('a visitor can only be checked out once', async () => {
    const api = await as('office');
    const host = await one<{ id: string }>(`SELECT id FROM employees WHERE deleted_at IS NULL ORDER BY employee_code LIMIT 1`);
    const v = await api.post('/api/visitors', { fullName: 'Test Visitor', purpose: 'Meeting', hostEmployeeId: host!.id });
    expect(v.status).toBe(201);
    cleanup.push(() => query('DELETE FROM visitors WHERE id = $1', [v.body.data.id]));
    const res = await Promise.all([1, 2, 3].map(() => api.post(`/api/visitors/${v.body.data.id}/check-out`)));
    expect(res.map((r) => r.status).sort()).toEqual([200, 409, 409]);
  });

  it('two simultaneous identical gate scans record one event', async () => {
    const api = await as('staff');
    const s = await one<{ id: string }>(
      `SELECT s.id FROM students s WHERE s.deleted_at IS NULL AND s.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM gate_events g WHERE g.student_id = s.id AND (g.occurred_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date)
        ORDER BY s.admission_no LIMIT 1`);
    expect(s).toBeTruthy();
    cleanup.push(() => query(`DELETE FROM gate_events WHERE student_id = $1 AND occurred_at > now() - interval '1 hour'`, [s!.id]));
    const res = await Promise.all([1, 2, 3].map(() => api.post('/api/gate/events', { studentId: s!.id, direction: 'in', gate: 'Main Gate', method: 'Manual' })));
    expect(res.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM gate_events WHERE student_id = $1 AND occurred_at > now() - interval '1 hour'`, [s!.id]);
    expect(n!.n).toBe(1);
  });

  it('parallel early-warning checks do not raise the same signal twice', async () => {
    const api = await as('principal');
    const before = await one<{ n: number }>('SELECT count(*)::int AS n FROM early_warning_signals');
    cleanup.push(() => query(`DELETE FROM early_warning_signals WHERE raised_on = current_date AND created_at > now() - interval '1 hour' AND signal LIKE '%automatic check%'`));
    const res = await Promise.all([1, 2].map(() => api.post('/api/early-warning/run-check', {})));
    expect(res.map((r) => r.status)).toEqual([200, 200]);
    const createdBoth = res.reduce((a, r) => a + r.body.data.created.length, 0);
    const after = await one<{ n: number }>('SELECT count(*)::int AS n FROM early_warning_signals');
    expect(after!.n - before!.n).toBe(createdBoth);
    const dup = await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM (SELECT 1 FROM early_warning_signals WHERE closed_at IS NULL GROUP BY student_id, signal_type HAVING count(*) > 1) x`);
    expect(dup!.n).toBe(0);
  });
});

describe('pickup OTP', () => {
  it('parallel wrong guesses cannot exceed the attempt limit', async () => {
    const api = await as('office');
    const s = await one<{ id: string }>(`SELECT s.id FROM students s WHERE s.deleted_at IS NULL AND s.status = 'active' ORDER BY s.admission_no DESC LIMIT 1`);
    const pa = await api.post('/api/pickup/authorisations', { studentId: s!.id, personName: 'Test Uncle OTP', relation: 'Uncle', method: 'OTP' });
    expect(pa.status).toBe(201);
    const id = pa.body.data.id;
    cleanup.push(() => query('DELETE FROM pickup_authorisations WHERE id = $1', [id]));
    const otp = await api.post(`/api/pickup/authorisations/${id}/otp`);
    expect(otp.status).toBe(200);
    const code: string = otp.body.data.devCode;
    const wrong = code === '000000' ? '111111' : '000000';
    const res = await Promise.all(Array.from({ length: 10 }, () => api.post(`/api/pickup/authorisations/${id}/verify`, { code: wrong })));
    const invalid = res.filter((r) => r.body.error === 'OTP_INVALID').length;
    expect(invalid).toBeLessThanOrEqual(5);
    const ch = await one<{ attempts: number; consumed_at: Date | null }>(
      'SELECT attempts, consumed_at FROM pickup_otp_challenges WHERE authorisation_id = $1 ORDER BY created_at DESC LIMIT 1', [id]);
    expect(ch!.attempts).toBeLessThanOrEqual(5);
    expect(ch!.consumed_at).not.toBeNull();
    // Once locked, even the right code is refused.
    const right = await api.post(`/api/pickup/authorisations/${id}/verify`, { code });
    expect(right.status).toBe(400);
  });
});
