/**
 * Set salary: basic pay and monthly allowances. The Super Admin's allowance changes apply at
 * once; HR's are proposed and replace the current amount only when approved, so nobody is
 * paid twice. Removing an allowance stops it.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { as } from './helpers.js';
import { many, one, pool } from '../src/config/db.js';

afterAll(() => pool.end());

const month = new Date().toISOString().slice(0, 7) + '-01';

async function newEmployee() {
  const campus = (await one<{ id: string }>('SELECT id FROM campuses WHERE is_active ORDER BY established LIMIT 1'))!.id;
  const r = await (await as('hr')).post('/api/workforce/employees', {
    fullName: `Salary Test ${Date.now()}`, campusId: campus, department: 'Accounts', designation: 'Accounts Assistant',
    employeeType: 'non_teaching', category: 'Reception & Admin', basicSalary: 20000,
  });
  expect(r.status).toBe(201);
  return r.body.data.id as string;
}
const active = (id: string) => many<{ type: string; amount: number; status: string }>(
  `SELECT allowance_type AS type, amount::float AS amount, status FROM allowances
    WHERE employee_id = $1 AND status IN ('Approved', 'Submitted') ORDER BY allowance_type, status`, [id]);

describe('set salary', () => {
  it('lets the Super Admin set basic pay and allowances at once, with a matching preview', async () => {
    const id = await newEmployee();
    const admin = await as('superadmin');
    const r = await admin.put(`/api/payroll/salary/${id}`, {
      basicSalary: 30000, effectiveMonth: month,
      allowances: [{ type: 'House rent allowance', amount: 12000 }, { type: 'Conveyance', amount: 1600 }],
    });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ basicChanged: true, applied: ['House rent allowance', 'Conveyance'], proposed: [] });
    const got = (await admin.get(`/api/payroll/salary/${id}`)).body.data;
    expect(got.basic).toBe(30000);
    expect(got.current.gross).toBe(43600);
    const preview = (await admin.post('/api/payroll/salary-preview', { basicSalary: 30000, allowances: [{ type: 'House rent allowance', amount: 12000 }, { type: 'Conveyance', amount: 1600 }] })).body.data;
    expect(preview.net).toBe(got.current.net);
    expect(preview.deductions.find((x: any) => x.label === 'Provident fund').amount).toBe(3600);

    // Removing one stops it straight away
    const removed = await admin.put(`/api/payroll/salary/${id}`, { basicSalary: 30000, effectiveMonth: month, allowances: [{ type: 'House rent allowance', amount: 12000 }] });
    expect(removed.body.data.stopped).toEqual(['Conveyance']);
    expect(await active(id)).toEqual([{ type: 'House rent allowance', amount: 12000, status: 'Approved' }]);
  });

  it("sends HR's allowance changes for approval, and approval replaces the old amount", async () => {
    const id = await newEmployee();
    await (await as('superadmin')).put(`/api/payroll/salary/${id}`, { basicSalary: 20000, effectiveMonth: month, allowances: [{ type: 'Special allowance', amount: 2000 }] });

    const hr = await as('hr');
    const r = await hr.put(`/api/payroll/salary/${id}`, { basicSalary: 21000, effectiveMonth: month, allowances: [{ type: 'Special allowance', amount: 3500 }] });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ basicChanged: true, applied: [], proposed: ['Special allowance'] });
    // Until approved, the current amount is still the one paid
    expect(await active(id)).toEqual([
      { type: 'Special allowance', amount: 2000, status: 'Approved' },
      { type: 'Special allowance', amount: 3500, status: 'Submitted' },
    ]);

    const campus = (await one<{ id: string }>('SELECT campus_id AS id FROM employees WHERE id = $1', [id]))!.id;
    const decide = await (await as('superadmin')).post('/api/finance/allowances/decide', { allowanceType: 'Special allowance', decision: 'Approved', campusId: campus });
    expect(decide.status).toBe(200);
    expect(await active(id)).toEqual([{ type: 'Special allowance', amount: 3500, status: 'Approved' }]);
  });

  it('is limited to payroll managers and refuses duplicate allowances', async () => {
    const id = await newEmployee();
    expect((await (await as('finance')).put(`/api/payroll/salary/${id}`, { basicSalary: 1, effectiveMonth: month })).status).toBe(403);
    const dup = await (await as('hr')).put(`/api/payroll/salary/${id}`, {
      basicSalary: 20000, effectiveMonth: month, allowances: [{ type: 'Conveyance', amount: 1 }, { type: 'conveyance', amount: 2 }],
    });
    expect(dup.status).toBe(400);
    expect(dup.body.error).toBe('DUPLICATE_ALLOWANCE');
  });

  it('leaves a pending proposal for the approval step when saved unchanged', async () => {
    const id = await newEmployee();
    await (await as('hr')).put(`/api/payroll/salary/${id}`, { basicSalary: 20000, effectiveMonth: month, allowances: [{ type: 'CPD allowance', amount: 1500 }] });
    // The Super Admin saves the same figures (e.g. after changing nothing): the proposal stays a proposal
    const r = await (await as('superadmin')).put(`/api/payroll/salary/${id}`, { basicSalary: 20000, effectiveMonth: month, allowances: [{ type: 'CPD allowance', amount: 1500 }] });
    expect(r.body.data).toMatchObject({ applied: [], proposed: [], stopped: [] });
    expect(await active(id)).toEqual([{ type: 'CPD allowance', amount: 1500, status: 'Submitted' }]);
  });
});
