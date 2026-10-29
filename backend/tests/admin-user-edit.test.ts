/**
 * Users & Roles → Edit: name, title, mobile and an admin password reset. A reset signs the
 * user out, works only with a strong password, never on your own account, and is never logged.
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, as, login } from './helpers.js';
import { one, pool } from '../src/config/db.js';

afterAll(() => pool.end());

const signIn = (identifier: string, password: string) =>
  request(app).post('/api/auth/login').send({ identifier, password, clientType: 'mobile' });

describe('admin edit user', () => {
  it('updates details and resets the password', async () => {
    const admin = await as('superadmin');
    const stamp = Date.now();
    const email = `reset.test.${stamp}@holysai.edu`;
    const phone = `+91 9${String(stamp).slice(-9)}`; // mobile numbers are unique, so one per run
    const created = await admin.post('/api/users', { email, fullName: 'Reset Test', roleKey: 'teacher', password: 'OldPassw0rd1' });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const before = await signIn(email, 'OldPassw0rd1');
    expect(before.status).toBe(200);
    const oldToken = before.body.data.accessToken as string;
    // Session tokens record their issue time to the second; let a second pass so this one predates the reset.
    await new Promise((r) => setTimeout(r, 1100));

    // Weak passwords are refused
    expect((await admin.patch(`/api/users/${id}`, { password: 'short' })).status).toBe(400);

    const r = await admin.patch(`/api/users/${id}`, { fullName: 'Reset Tested', title: 'Class Teacher', phone, password: 'NewPassw0rd2' });
    expect(r.status).toBe(200);
    expect(await one('SELECT full_name, title, phone FROM users WHERE id = $1', [id]))
      .toEqual({ full_name: 'Reset Tested', title: 'Class Teacher', phone });

    // Old password fails, new one works, and the old session no longer does
    expect((await signIn(email, 'OldPassw0rd1')).status).toBe(401);
    expect((await signIn(email, 'NewPassw0rd2')).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${oldToken}`)).status).toBe(401);

    // The audit entry records the reset, never the password
    const log = await one<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM audit_logs WHERE entity_id = $1 AND module = 'users' AND action = 'update' ORDER BY created_at DESC LIMIT 1`, [id]);
    expect(log!.metadata.passwordReset).toBe(true);
    expect(JSON.stringify(log!.metadata)).not.toContain('NewPassw0rd2');
  });

  it('refuses a reset of your own account and by non-admins', async () => {
    const me = await login('superadmin');
    const self = await (await as('superadmin')).patch(`/api/users/${me.user.id}`, { password: 'AnotherPassw0rd3' });
    expect(self.status).toBe(400);
    expect(self.body.error).toBe('SELF_PASSWORD');
    const target = await login('teacher');
    expect((await (await as('principal')).patch(`/api/users/${target.user.id}`, { password: 'AnotherPassw0rd3' })).status).toBe(403);
  });
});
