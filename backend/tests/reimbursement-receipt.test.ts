/**
 * Reimbursement claims require a receipt: refused without one or with a fake file,
 * listed with the receipt's details, and opened by finance staff only.
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, as, login } from './helpers.js';
import { one, pool } from '../src/config/db.js';

afterAll(() => pool.end());

const PDF = Buffer.from('%PDF-1.4\n% bus ticket\n');

async function claim(file?: { body: Buffer; name: string; type: string }) {
  const { token } = await login('finance');
  const emp = (await one<{ id: string }>(`SELECT id FROM employees WHERE deleted_at IS NULL ORDER BY full_name LIMIT 1`))!.id;
  const req = request(app).post('/api/finance/reimbursements').set('Authorization', `Bearer ${token}`)
    .field('employeeId', emp).field('claimType', 'Travel').field('description', 'Bus fare to district meet (test)')
    .field('amount', '420.50').field('claimDate', new Date().toISOString().slice(0, 10));
  return file ? req.attach('file', file.body, { filename: file.name, contentType: file.type }) : req;
}

describe('reimbursement receipts', () => {
  it('refuses a claim without a receipt or with a fake one', async () => {
    const none = await claim();
    expect(none.status).toBe(400);
    expect(none.body.error).toBe('RECEIPT_REQUIRED');
    const fake = await claim({ body: Buffer.from('not a pdf'), name: 'ticket.pdf', type: 'application/pdf' });
    expect(fake.status).toBe(400);
    expect(fake.body.error).toBe('FILE_TYPE_MISMATCH');
    expect(await one(`SELECT 1 FROM reimbursements WHERE description = 'Bus fare to district meet (test)' AND receipt_document_id IS NULL`)).toBeNull();
  });

  it('stores the receipt with the claim and lets finance open it', async () => {
    const c = await claim({ body: PDF, name: 'bus-ticket.pdf', type: 'application/pdf' });
    expect(c.status).toBe(201);
    const id = c.body.data.id as string;

    const list = await (await as('finance')).get(`/api/finance/reimbursements?q=${c.body.data.code}`);
    expect(list.body.data[0].receipt).toMatchObject({ name: 'bus-ticket.pdf', mimeType: 'application/pdf' });
    const doc = await one<{ category: string; owner_type: string }>(
      'SELECT d.category, d.owner_type FROM reimbursements r JOIN documents d ON d.id = r.receipt_document_id WHERE r.id = $1', [id]);
    expect(doc).toEqual({ category: 'Claim receipt', owner_type: 'employee' });

    const open = async (who: 'finance' | 'teacher') =>
      request(app).get(`/api/finance/reimbursements/${id}/receipt`).set('Authorization', `Bearer ${(await login(who)).token}`);
    const ok = await open('finance');
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toContain('application/pdf');
    expect((await open('teacher')).status).toBe(403);
  });
});
