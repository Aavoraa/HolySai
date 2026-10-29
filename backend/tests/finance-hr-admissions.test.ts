/**
 * Regression tests for finance, workforce and admissions rules (seeded test database).
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, as, login } from './helpers.js';
import { many, one, pool, query } from '../src/config/db.js';

afterAll(() => pool.end());

const campusId = async () => (await one<{ id: string }>('SELECT id FROM campuses WHERE is_active ORDER BY established LIMIT 1'))!.id;
const empOf = async (email: string) =>
  (await one<{ id: string }>('SELECT e.id FROM employees e JOIN users u ON u.id = e.user_id WHERE u.email = $1', [email]))!.id;

let seq = 0;
async function newLead() {
  const office = await as('office');
  seq += 1;
  const r = await office.post('/api/enquiries', {
    campusId: await campusId(), parentName: 'Test Parent', phone: `+91 90000 ${String(Date.now() % 100000).padStart(5, '0')}${seq}`.slice(0, 16),
    studentName: `Regression Child ${Date.now()}-${seq}`, gradeApplied: 'Grade 3', source: 'Website',
  });
  expect(r.status).toBe(201);
  return r.body.data as { id: string; code: string };
}

describe('admissions', () => {
  it('moving a lead to Offer still requires every document to be verified', async () => {
    const office = await as('office');
    const lead = await newLead();
    const r = await office.post(`/api/enquiries/${lead.code}/stage`, { stage: 'Offer', note: 'Skipping ahead' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('DOCUMENTS_INCOMPLETE');
    const app = await one('SELECT status FROM admissions WHERE enquiry_id = $1', [lead.id]);
    expect(app).toBeNull();
  });

  it('a completed follow-up cannot be completed a second time', async () => {
    const office = await as('office');
    const lead = await newLead();
    const f = await one<{ id: string }>(`SELECT id FROM follow_ups WHERE enquiry_id = $1 AND status = 'Scheduled'`, [lead.id]);
    const first = await office.patch(`/api/follow-ups/${f!.id}`, { status: 'Completed', outcome: 'Spoke to parent' });
    expect(first.status).toBe(200);
    const again = await office.patch(`/api/follow-ups/${f!.id}`, { status: 'Completed', outcome: 'Spoke to parent' });
    expect(again.status).toBe(400);
    const comms = await one<{ n: number }>(`SELECT count(*)::int AS n FROM communications WHERE enquiry_id = $1 AND subject LIKE 'Call — %'`, [lead.id]);
    expect(comms!.n).toBe(1);
  });

  it('rescheduling an assessment replaces the open assessment follow-up', async () => {
    const office = await as('office');
    const lead = await newLead();
    const a = await office.post('/api/applications', { enquiryId: lead.id });
    expect(a.status).toBe(201);
    const id = a.body.data.id;
    expect((await office.post(`/api/applications/${id}/status`, { status: 'Under Review', note: 'Looks fine' })).status).toBe(200);
    const t1 = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const t2 = new Date(Date.now() + 5 * 86_400_000).toISOString();
    expect((await office.post(`/api/applications/${id}/status`, { status: 'Assessment Scheduled', note: 'Booked', assessmentAt: t1 })).status).toBe(200);
    expect((await office.post(`/api/applications/${id}/status`, { status: 'Assessment Scheduled', note: 'Moved', assessmentAt: t2 })).status).toBe(200);
    const open = await many<{ scheduled_at: Date }>(
      `SELECT scheduled_at FROM follow_ups WHERE enquiry_id = $1 AND status = 'Scheduled' AND notes = 'Entrance assessment'`, [lead.id]);
    expect(open).toHaveLength(1);
    expect(new Date(open[0].scheduled_at).toISOString()).toBe(t2);
  });
});

describe('finance', () => {
  it('extending a fee structure due date clears the stored Overdue status', async () => {
    const fin = await as('finance');
    const s = await one<{ id: string }>(
      `SELECT fee_structure_id AS id FROM student_fees WHERE status = 'Overdue' AND fee_structure_id IS NOT NULL LIMIT 1`);
    expect(s).not.toBeNull();
    const due = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
    const r = await fin.patch(`/api/finance/fee-structures/${s!.id}`, { dueDate: due });
    expect(r.status).toBe(200);
    const left = await one<{ n: number }>(`SELECT count(*)::int AS n FROM student_fees WHERE fee_structure_id = $1 AND status = 'Overdue'`, [s!.id]);
    expect(left!.n).toBe(0);
    const f = await one<{ student_id: string }>(`SELECT student_id FROM student_fees WHERE fee_structure_id = $1 AND status <> 'Paid' LIMIT 1`, [s!.id]);
    if (f) {
      const acc = await fin.get(`/api/finance/accounts/${f.student_id}`);
      const lines = acc.body.data.lines.filter((l: any) => l.dueDate === due);
      expect(lines.every((l: any) => l.status !== 'Overdue')).toBe(true);
    }
  });

  it('a finance approver cannot approve their own reimbursement', async () => {
    const fin = await as('finance');
    const me = await empOf('rajesh.iyer.demo@holysai.edu');
    // Claims are multipart: the fields plus the required receipt
    const { token } = await login('finance');
    const c = await request(app).post('/api/finance/reimbursements').set('Authorization', `Bearer ${token}`)
      .field('employeeId', me).field('claimType', 'Travel').field('description', 'Own claim').field('amount', '1500')
      .field('claimDate', new Date().toISOString().slice(0, 10))
      .attach('file', Buffer.from('%PDF-1.4 receipt'), { filename: 'receipt.pdf', contentType: 'application/pdf' });
    expect(c.status).toBe(201);
    const r = await fin.post(`/api/finance/reimbursements/${c.body.data.id}/approve`);
    expect(r.status).toBe(403);
    const row = await one<{ status: string }>('SELECT status FROM reimbursements WHERE id = $1', [c.body.data.id]);
    expect(row!.status).toBe('Submitted');
  });

  // Only the Super Admin decides (approvals.decide); decideAllowance also skips the decider's
  // own row, which matters only if a decider is ever an employee.
  it('HR cannot approve an allowance paid to themselves', async () => {
    const hr = await as('hr');
    const me = await empOf('lakshmi.n.demo@holysai.edu');
    const other = (await one<{ id: string }>(
      `SELECT id FROM employees WHERE id <> $1 AND deleted_at IS NULL AND employment_status = 'active' ORDER BY employee_code LIMIT 1`, [me]))!.id;
    const type = `Regression allowance ${Date.now()}`;
    const c = await hr.post('/api/finance/allowances', {
      allowanceType: type, employeeIds: [me, other], amount: 1000, effectiveMonth: new Date().toISOString().slice(0, 10),
    });
    expect(c.status).toBe(201);
    expect((await hr.post('/api/finance/allowances/decide', { allowanceType: type, decision: 'Approved' })).status).toBe(403);
    const own = await one<{ status: string }>('SELECT status FROM allowances WHERE allowance_type = $1 AND employee_id = $2', [type, me]);
    expect(own!.status).toBe('Submitted');
    const d = await (await as('superadmin')).post('/api/finance/allowances/decide', { allowanceType: type, decision: 'Approved' });
    expect(d.status).toBe(200);
    expect(d.body.data.updated).toBe(2);
  });

  it('reconciliation never matches one payment to two statement lines', async () => {
    const fin = await as('finance');
    const s = await one<{ student_id: string }>(
      `SELECT student_id FROM student_fees WHERE amount_due - concession_amount - amount_paid > 0 AND status <> 'Waived' LIMIT 1`);
    const ref = `REGTEST-${Date.now()}`;
    const pay = await fin.post(`/api/finance/accounts/${s!.student_id}/payments`, { amount: 1, method: 'UPI', reference: ref });
    expect(pay.status).toBe(201);
    const p = { id: pay.body.data.id as string };
    await query(
      `INSERT INTO bank_statement_lines (statement_date, reference, amount, channel) VALUES (current_date, $1, 1, 'UPI'), (current_date, $1, 1, 'UPI')`,
      [ref]);
    const r = await fin.post('/api/finance/reconciliation/run');
    expect(r.status).toBe(200);
    const matched = await one<{ n: number }>(`SELECT count(*)::int AS n FROM bank_statement_lines WHERE matched_payment_id = $1`, [p!.id]);
    expect(matched!.n).toBe(1);
  });
});
