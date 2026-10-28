/**
 * API core & security regressions: auth lockout, token invalidation, admin
 * guards, error envelopes, Student 360 tracking consent and student updates.
 */
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { app, as, PASSWORD } from './helpers.js';
import { one, pool, query } from '../src/config/db.js';

const STRONG = 'CoreTest-Pass1';
const createdUsers: string[] = [];
const createdStudents: string[] = [];
const createdDevices: string[] = [];

afterAll(async () => {
  if (createdDevices.length) {
    await query('DELETE FROM student_locations WHERE device_id = ANY($1)', [createdDevices]);
    await query('DELETE FROM device_assignments WHERE device_id = ANY($1)', [createdDevices]);
    await query('DELETE FROM gps_devices WHERE id = ANY($1)', [createdDevices]);
  }
  if (createdStudents.length) await query('DELETE FROM students WHERE id = ANY($1)', [createdStudents]);
  if (createdUsers.length) {
    await query('DELETE FROM refresh_tokens WHERE user_id = ANY($1)', [createdUsers]);
    await query('UPDATE audit_logs SET user_id = NULL WHERE user_id = ANY($1)', [createdUsers]);
    await query('DELETE FROM users WHERE id = ANY($1)', [createdUsers]);
  }
  await pool.end();
});

async function makeUser(roleKey: string) {
  const admin = await as('superadmin');
  const email = `core.${roleKey}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
  const r = await admin.post('/api/users', { email, fullName: `Core Test ${roleKey}`, roleKey, password: STRONG });
  expect(r.status).toBe(201);
  createdUsers.push(r.body.data.id);
  return { id: r.body.data.id as string, email };
}

async function signIn(email: string, password = STRONG) {
  return request(app).post('/api/auth/login').send({ identifier: email, password, clientType: 'mobile' });
}

describe('authentication', () => {
  it('locks the account even when failed attempts arrive concurrently', async () => {
    const u = await makeUser('staff');
    await Promise.all(Array.from({ length: 6 }, () => signIn(u.email, 'wrong-password')));
    const r = await signIn(u.email);
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('ACCOUNT_LOCKED');
  }, 90_000); // bcrypt (pure JS) runs every attempt on one thread

  it('an access token issued before a password change stops working', async () => {
    const u = await makeUser('staff');
    const first = await signIn(u.email);
    const token = first.body.data.accessToken;
    await new Promise((r) => setTimeout(r, 1100)); // iat has one-second resolution
    const ch = await request(app).post('/api/auth/change-password').set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: STRONG, newPassword: 'CoreTest-Pass2' });
    expect(ch.status).toBe(200);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(401);
    const again = await signIn(u.email, 'CoreTest-Pass2');
    expect(again.status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${again.body.data.accessToken}`)).status).toBe(200);
  }, 60_000);

  it('logout with a non-string refresh token is not a server error', async () => {
    const r = await request(app).post('/api/auth/logout').send({ refreshToken: 12345 });
    expect(r.status).toBe(200);
  });
});

describe('administration guards', () => {
  it('only a Super Admin may change or suspend a Super Admin account', async () => {
    const target = await makeUser('super_admin');
    const sa = await makeUser('school_admin');
    const login = await signIn(sa.email);
    const r = await request(app).patch(`/api/users/${target.id}`).set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .send({ status: 'suspended' });
    expect(r.status).toBe(403);
    const row = await one('SELECT status FROM users WHERE id = $1', [target.id]);
    expect(row.status).toBe('active');
  });
});

describe('error envelope', () => {
  it('a sort key naming an Object.prototype member falls back safely', async () => {
    const api = await as('principal');
    for (const sort of ['constructor', 'toString', '__proto__']) {
      const r = await api.get(`/api/students?sort=${sort}&pageSize=5`);
      expect(r.status).toBe(200);
    }
  });

  it('an invalid document upload form is a 400, not a 500', async () => {
    const { token } = await (async () => {
      const r = await request(app).post('/api/auth/login').send({ identifier: 'admin.demo@holysai.edu', password: PASSWORD, clientType: 'mobile' });
      return { token: r.body.data.accessToken as string };
    })();
    const r = await request(app).post('/api/documents').set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('VALIDATION_ERROR');
  });

  it('an unsupported body charset is a 4xx, not a 500', async () => {
    const r = await request(app).post('/api/auth/login').set('Content-Type', 'application/json; charset=x-bogus').send('{"identifier":"abc"}');
    expect(r.status).toBe(415);
  });
});

describe('students', () => {
  it('rejects moving a student to a section of another campus', async () => {
    const api = await as('superadmin');
    const lk = await api.get('/api/lookups');
    const gdv = lk.body.data.campuses.find((c: any) => c.code === 'gdv');
    const own = lk.body.data.classes.find((c: any) => c.campusId === gdv.id && c.sections.length);
    const other = lk.body.data.classes.find((c: any) => c.campusId !== gdv.id && c.sections.length);
    const create = await api.post('/api/students', {
      firstName: 'Core', lastName: 'Mover', dateOfBirth: '2016-02-02', gender: 'M', campusId: gdv.id, sectionId: own.sections[0].id,
    });
    expect(create.status).toBe(201);
    createdStudents.push(create.body.data.id);
    const r = await api.put(`/api/students/${create.body.data.id}`, { sectionId: other.sections[0].id });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('SECTION_CAMPUS_MISMATCH');
    const r2 = await api.put(`/api/students/${create.body.data.id}`, { campusId: other.campusId });
    expect(r2.status).toBe(400);
    // Both together is a valid move.
    const ok = await api.put(`/api/students/${create.body.data.id}`, { campusId: other.campusId, sectionId: other.sections[0].id });
    expect(ok.status).toBe(200);
    expect(ok.body.data.campusId).toBe(other.campusId);
  });

  it('archiving a student ends their device assignment', async () => {
    const api = await as('superadmin');
    const lk = await api.get('/api/lookups');
    const gdv = lk.body.data.campuses.find((c: any) => c.code === 'gdv');
    const cls = lk.body.data.classes.find((c: any) => c.campusId === gdv.id && c.sections.length);
    const s = await api.post('/api/students', {
      firstName: 'Core', lastName: 'Archive', dateOfBirth: '2016-03-03', gender: 'F', campusId: gdv.id, sectionId: cls.sections[0].id,
    });
    createdStudents.push(s.body.data.id);
    const d = await api.post('/api/devices', { deviceType: 'gps_tracker', notes: 'api-core.test' });
    expect(d.status).toBe(201);
    createdDevices.push(d.body.data.device.id);
    const a = await api.post('/api/device-assignments', { studentId: s.body.data.id, deviceId: d.body.data.device.id });
    expect(a.status).toBe(201);
    expect((await api.delete(`/api/students/${s.body.data.id}`)).status).toBe(200);
    const dev = await one('SELECT status FROM gps_devices WHERE id = $1', [d.body.data.device.id]);
    expect(dev.status).toBe('available');
    const asg = await one('SELECT status FROM device_assignments WHERE id = $1', [a.body.data.id]);
    expect(asg.status).toBe('inactive');
  });
});

describe('tracking consent (can_view_tracking)', () => {
  it('a guardian without tracking access sees no location in Student 360 and gets no arrival alerts', async () => {
    const parent = await as('parent');
    const admin = await as('superadmin');
    const link = await one<{ student_id: string; parent_id: string; user_id: string }>(
      `SELECT sg.student_id, sg.parent_id, p.user_id FROM student_guardians sg JOIN parents p ON p.id = sg.parent_id
         JOIN students s ON s.id = sg.student_id JOIN users u ON u.id = p.user_id
        WHERE u.email = 'ranjith.kumar.demo@parents.holysai.edu' AND s.admission_no = 'HS-2026-1085'`);
    expect(link).toBeTruthy();
    await query('UPDATE student_guardians SET can_view_tracking = false WHERE student_id = $1 AND parent_id = $2', [link!.student_id, link!.parent_id]);
    try {
      const p = await parent.get(`/api/students/${link!.student_id}/profile`);
      expect(p.status).toBe(200);
      expect(p.body.data.tracking).toBeUndefined();
      expect((await parent.get(`/api/students/${link!.student_id}/location`)).status).toBe(404);

      const since = (await one<{ now: Date }>('SELECT now() AS now'))!.now;
      await admin.post(`/api/students/${link!.student_id}/location`, { latitude: 12.87, longitude: 80.07, locationStatus: 'in_transit' });
      await admin.post(`/api/students/${link!.student_id}/location`, { latitude: 12.8458, longitude: 80.0625, locationStatus: 'at_school' });
      const n = await one<{ n: number }>(
        `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND topic = 'tracking' AND created_at >= $2`, [link!.user_id, since]);
      expect(n!.n).toBe(0);
    } finally {
      await query('UPDATE student_guardians SET can_view_tracking = true WHERE student_id = $1 AND parent_id = $2', [link!.student_id, link!.parent_id]);
    }
  });
});
