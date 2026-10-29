/**
 * HR letters: appointment (onboarding), relieving and experience letters are numbered per type
 * and year, keep the employee as they were when issued, check their dates, and are HR's to issue.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { as } from './helpers.js';
import { one, pool, query } from '../src/config/db.js';

afterAll(() => pool.end());

const emp = async () => (await one<{ id: string; join: string; name: string }>(
  `SELECT id, to_char(join_date, 'YYYY-MM-DD') AS join, full_name AS name FROM employees
    WHERE deleted_at IS NULL AND join_date IS NOT NULL ORDER BY employee_code LIMIT 1`))!;
const sign = { signatoryName: 'Dr. Meera Krishnan', signatoryTitle: 'Principal' };

describe('HR letters', () => {
  it('issues the three letters with their own numbering and prints from what was issued', async () => {
    const e = await emp();
    const hr = await as('hr');
    const defaults = (await hr.get(`/api/workforce/employees/${e.id}/letters`)).body.data;
    expect(defaults.employee.fullName).toBe(e.name);
    expect(defaults.monthlyGross).toBeGreaterThan(0);

    const a = await hr.post(`/api/workforce/employees/${e.id}/letters`, {
      type: 'onboarding', issuedOn: '2026-10-29', ...sign, joiningDate: e.join, monthlyGross: defaults.monthlyGross, probationMonths: 6,
    });
    expect(a.status).toBe(201);
    expect(a.body.data.refNo).toMatch(/^HS\/HR\/AL\/2026\/\d{3}$/);
    const a2 = await hr.post(`/api/workforce/employees/${e.id}/letters`, { type: 'onboarding', issuedOn: '2026-10-29', ...sign, joiningDate: e.join });
    expect(Number(a2.body.data.refNo.slice(-3))).toBe(Number(a.body.data.refNo.slice(-3)) + 1);

    const r = await hr.post(`/api/workforce/employees/${e.id}/letters`, {
      type: 'relieving', issuedOn: '2026-10-29', ...sign, lastWorkingDay: '2026-10-28', resignationDate: '2026-09-28', duesCleared: true,
    });
    expect(r.body.data.refNo).toMatch(/^HS\/HR\/RL\/2026\/\d{3}$/);
    const x = await hr.post(`/api/workforce/employees/${e.id}/letters`, { type: 'experience', issuedOn: '2026-10-29', ...sign, lastWorkingDay: '2026-10-28' });
    expect(x.body.data.refNo).toMatch(/^HS\/HR\/EL\/2026\/\d{3}$/);

    // The letter keeps the employee's designation as on the day of issue
    const before = (await hr.get(`/api/workforce/letters/${x.body.data.id}`)).body.data;
    const designation = before.details.employee.designation;
    await query(`UPDATE employees SET designation = 'Changed later (test)' WHERE id = $1`, [e.id]);
    const after = (await hr.get(`/api/workforce/letters/${x.body.data.id}`)).body.data;
    expect(after.details.employee.designation).toBe(designation);
    expect(after).toMatchObject({ type: 'experience', title: 'Experience Letter', refNo: x.body.data.refNo });
    await query(`UPDATE employees SET designation = $2 WHERE id = $1`, [e.id, designation]);

    const listed = (await hr.get(`/api/workforce/letters?q=${encodeURIComponent(x.body.data.refNo)}`)).body.data;
    expect(listed.map((l: any) => l.id)).toEqual([x.body.data.id]);
    const audit = await one(`SELECT 1 FROM audit_logs WHERE entity_id = $1 AND description LIKE $2`, [e.id, `%${x.body.data.refNo}%`]);
    expect(audit).not.toBeNull();
  });

  it('checks the dates and who may issue', async () => {
    const e = await emp();
    const hr = await as('hr');
    const early = await hr.post(`/api/workforce/employees/${e.id}/letters`, { type: 'relieving', issuedOn: '2026-10-29', ...sign, lastWorkingDay: '1990-01-01' });
    expect(early.status).toBe(400);
    expect((await hr.post(`/api/workforce/employees/${e.id}/letters`, { type: 'experience', issuedOn: '2026-10-29', ...sign })).status).toBe(400);
    expect((await hr.post(`/api/workforce/employees/${e.id}/letters`, { type: 'onboarding', issuedOn: '2026-10-29', ...sign })).status).toBe(400);
    expect((await (await as('teacher')).post(`/api/workforce/employees/${e.id}/letters`, { type: 'experience', issuedOn: '2026-10-29', ...sign, lastWorkingDay: '2026-10-28' })).status).toBe(403);
    expect((await (await as('teacher')).get('/api/workforce/letters')).status).toBe(403);
  });
});
