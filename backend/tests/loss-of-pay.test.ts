/**
 * Loss of pay from staff attendance: Absent = 1 day, Half Day = ½, paid leave and unmarked days
 * cost nothing; per-day pay = (basic + allowances) ÷ working days (Sundays excluded).
 * Applied when payroll is calculated and shown in the Set salary preview.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { as } from './helpers.js';
import { many, one, pool, query } from '../src/config/db.js';
import { calculatePayslip, lossOfPay, workingDaysInMonth } from '../src/services/workforce-paycalc.js';

afterAll(() => pool.end());

describe('loss of pay', () => {
  it('counts working days and caps the deduction', () => {
    expect(workingDaysInMonth('2026-06-01')).toBe(26); // June 2026: 30 days, 4 Sundays
    expect(workingDaysInMonth('2026-02-01')).toBe(24);
    expect(lossOfPay(26_000, 2.5, 26)).toBe(2500);
    expect(lossOfPay(26_000, 0, 26)).toBe(0);
    expect(lossOfPay(26_000, 40, 26)).toBe(26_000);
    const slip = calculatePayslip({ basic: 20_000, allowances: [{ label: 'HRA', amount: 6_000 }], overtimeHours: 0, overtimeAmount: 0, reimbursements: 0, unpaidDays: 1, workingDays: 26 });
    expect(slip.deductions.find((d) => d.label.startsWith('Loss of pay'))).toEqual({ label: 'Loss of pay (1 day)', amount: 1000 });
    const full = calculatePayslip({ basic: 20_000, allowances: [], overtimeHours: 0, overtimeAmount: 0, reimbursements: 0 });
    expect(full.deductions.some((d) => d.label.startsWith('Loss of pay'))).toBe(false);
  });

  it('deducts unpaid absences when payroll is calculated', async () => {
    // A campus and month with no run yet: June 2026 for the smallest campus
    const campus = (await one<{ id: string }>(
      `SELECT c.id FROM campuses c JOIN employees e ON e.campus_id = c.id AND e.deleted_at IS NULL AND e.employment_status = 'active'
        GROUP BY c.id ORDER BY count(*) LIMIT 1`))!.id;
    await query(`DELETE FROM payroll_runs WHERE campus_id = $1 AND pay_month = '2026-06-01'`, [campus]);
    const emps = await many<{ id: string; basic: number }>(
      `SELECT id, basic_salary::float AS basic FROM employees WHERE campus_id = $1 AND deleted_at IS NULL AND employment_status = 'active' ORDER BY employee_code`, [campus]);
    const e = emps[0];
    await query(`DELETE FROM staff_attendance WHERE employee_id = $1 AND attendance_date BETWEEN '2026-06-01' AND '2026-06-30'`, [e.id]);
    // 2 absent + 1 half day = 2.5 unpaid; a paid leave day and a present day cost nothing
    await query(
      `INSERT INTO staff_attendance (employee_id, attendance_date, status, source) VALUES
         ($1, '2026-06-02', 'Absent', 'manual'), ($1, '2026-06-03', 'Absent', 'manual'), ($1, '2026-06-04', 'Half Day', 'manual'),
         ($1, '2026-06-05', 'On Leave', 'manual'), ($1, '2026-06-06', 'Present', 'manual')`, [e.id]);

    const hr = await as('hr');
    const run = await hr.post('/api/payroll/runs', { campusId: campus, payMonth: '2026-06' });
    expect(run.status).toBe(201);
    const calc = await hr.post(`/api/payroll/runs/${run.body.data.run.id}/calculate`);
    expect(calc.status).toBe(200);

    const slip = (await one<{ earnings: { label: string; amount: number }[]; deductions: { label: string; amount: number }[] }>(
      'SELECT earnings, deductions FROM payslips WHERE payroll_run_id = $1 AND employee_id = $2', [run.body.data.run.id, e.id]))!;
    const regular = slip.earnings.filter((x) => !x.label.startsWith('Overtime') && x.label !== 'Reimbursements').reduce((a, x) => a + Number(x.amount), 0);
    const lop = slip.deductions.find((d) => d.label.startsWith('Loss of pay'));
    expect(lop).toEqual({ label: 'Loss of pay (2.5 days)', amount: Math.round((regular / 26) * 2.5) });

    // Someone with no absences that month has no loss of pay
    if (emps[1]) {
      const other = (await one<{ deductions: { label: string }[] }>('SELECT deductions FROM payslips WHERE payroll_run_id = $1 AND employee_id = $2', [run.body.data.run.id, emps[1].id]))!;
      const absences = await one<{ n: number }>(`SELECT count(*)::int AS n FROM staff_attendance WHERE employee_id = $1 AND status IN ('Absent', 'Half Day') AND attendance_date BETWEEN '2026-06-01' AND '2026-06-30'`, [emps[1].id]);
      if (!absences!.n) expect(other.deductions.some((d) => d.label.startsWith('Loss of pay'))).toBe(false);
    }
  });

  it("shows the month's attendance and loss of pay in the Set salary preview", async () => {
    const e = (await one<{ id: string }>(
      `SELECT employee_id AS id FROM staff_attendance WHERE status = 'Absent' AND attendance_date BETWEEN '2026-06-01' AND '2026-06-30' LIMIT 1`))!;
    const r = await (await as('hr')).post('/api/payroll/salary-preview', {
      basicSalary: 26000, allowances: [], employeeId: e.id, month: '2026-06-01',
    });
    expect(r.status).toBe(200);
    expect(r.body.data.attendance).toMatchObject({ month: '2026-06-01', workingDays: 26, absent: 2, halfDay: 1, onLeave: 1, unpaidDays: 2.5 });
    expect(r.body.data.deductions.find((d: any) => d.label.startsWith('Loss of pay')).amount).toBe(2500);
  });
});
