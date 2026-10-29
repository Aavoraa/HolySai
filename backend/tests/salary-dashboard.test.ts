/**
 * Salary dashboard: totals agree with the payroll runs, campus scope narrows them, and only
 * people who can see payroll can open it.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { as } from './helpers.js';
import { one, pool } from '../src/config/db.js';

afterAll(() => pool.end());

describe('salary dashboard', () => {
  it('summarises the latest pay month and its parts', async () => {
    const r = await (await as('hr')).get('/api/payroll/salary-dashboard');
    expect(r.status).toBe(200);
    const d = r.body.data;
    const runs = (await one<{ gross: string; net: string; month: string }>(
      `SELECT sum(gross_total) AS gross, sum(net_total) AS net, to_char(max(pay_month), 'YYYY-MM-DD') AS month
         FROM payroll_runs WHERE pay_month = (SELECT max(pay_month) FROM payroll_runs)`))!;
    expect(d.latest.month).toBe(runs.month);
    expect(d.latest.gross).toBeCloseTo(Number(runs.gross), 2);
    expect(d.latest.net).toBeCloseTo(Number(runs.net), 2);
    // Departments and pay bands cover every payslip of the month
    const slips = (await one<{ n: number; gross: string }>(
      `SELECT count(*)::int AS n, sum(ps.gross) AS gross FROM payslips ps JOIN payroll_runs r ON r.id = ps.payroll_run_id WHERE r.pay_month = $1::date`, [runs.month]))!;
    expect(d.bands.reduce((a: number, b: any) => a + b.employees, 0)).toBe(slips.n);
    expect(d.departments.reduce((a: number, x: any) => a + x.gross, 0)).toBeCloseTo(Number(slips.gross), 2);
    expect(d.earnings.length).toBeGreaterThan(0);
    expect(d.months.length).toBeGreaterThan(0);
  });

  it('narrows to one campus and stays behind payroll access', async () => {
    const campus = (await one<{ id: string }>('SELECT campus_id AS id FROM payroll_runs ORDER BY employee_count LIMIT 1'))!;
    const all = (await (await as('hr')).get('/api/payroll/salary-dashboard')).body.data;
    const one_ = (await (await as('hr')).get(`/api/payroll/salary-dashboard?campusId=${campus.id}`)).body.data;
    expect(one_.latest.employees).toBeLessThan(all.latest.employees);
    expect(one_.runs.every((x: any) => x.campus === one_.runs[0].campus)).toBe(true);
    expect((await (await as('teacher')).get('/api/payroll/salary-dashboard')).status).toBe(403);
  });

  it('lists every employee of a month with their payslip, and earlier months on request', async () => {
    const hr = await as('hr');
    const latest = (await hr.get('/api/payroll/salary-dashboard/employees')).body.data;
    const count = (await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM payslips ps JOIN payroll_runs r ON r.id = ps.payroll_run_id
        WHERE r.pay_month = (SELECT max(pay_month) FROM payroll_runs)`))!;
    expect(latest.rows).toHaveLength(count.n);
    const first = latest.rows[0];
    expect(first).toMatchObject({ payslipId: expect.any(String), name: expect.any(String), code: expect.any(String) });
    expect(first.net).toBeCloseTo(first.gross - first.deductions, 2);
    // The payslip it points to opens
    expect((await hr.get(`/api/payslips/${first.payslipId}`)).status).toBe(200);

    const oldest = (await one<{ m: string }>(`SELECT to_char(min(pay_month), 'YYYY-MM-DD') AS m FROM payroll_runs`))!.m;
    const earlier = (await hr.get(`/api/payroll/salary-dashboard/employees?month=${oldest}`)).body.data;
    expect(earlier.month).toBe(oldest);
    expect(earlier.rows.length).toBeGreaterThan(0);
    expect((await (await as('teacher')).get('/api/payroll/salary-dashboard/employees')).status).toBe(403);
  });
});
