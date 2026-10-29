/**
 * Circular attachments: type checks, the Draft/Under Review edit window, the
 * per-circular limit, and who may download (staff readers; parents only once
 * the circular is released to them).
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, as, login, type Who } from './helpers.js';
import { pool } from '../src/config/db.js';

afterAll(() => pool.end());

const PDF = Buffer.from('%PDF-1.4\n% circular attachment test\n');

async function attach(who: Who, circularId: string, body: Buffer, filename: string, contentType: string) {
  const { token } = await login(who);
  return request(app).post(`/api/circulars/${circularId}/attachments`).set('Authorization', `Bearer ${token}`)
    .attach('file', body, { filename, contentType });
}

async function download(who: Who, path: string) {
  const { token } = await login(who);
  return request(app).get(path).set('Authorization', `Bearer ${token}`).buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

describe('circular attachments', () => {
  it('attaches files to a draft and delivers them only to its released audience', async () => {
    const principal = await as('principal');
    const c = await principal.post('/api/circulars', { title: 'Grade 5 exam timetable (test)', body: 'Please see the attached timetable.', audience: { kind: 'grades', grades: [5] } });
    expect(c.status).toBe(201);
    const id = c.body.data.id as string;
    expect(c.body.data.attachments).toEqual([]);

    const up = await attach('principal', id, PDF, 'timetable.pdf', 'application/pdf');
    expect(up.status).toBe(201);
    const attId = up.body.data.id as string;

    // Bytes that do not match the declared type are refused
    const fake = await attach('principal', id, Buffer.from('not a pdf at all'), 'evil.pdf', 'application/pdf');
    expect(fake.status).toBe(400);
    expect(fake.body.error).toBe('FILE_TYPE_MISMATCH');
    // Types outside the allow-list are refused
    expect((await attach('principal', id, Buffer.from('MZ'), 'run.exe', 'application/octet-stream')).status).toBe(400);

    const got = await principal.get(`/api/circulars/${id}`);
    expect(got.body.data.attachments).toHaveLength(1);
    expect(got.body.data.attachments[0]).toMatchObject({ id: attId, name: 'timetable.pdf', mimeType: 'application/pdf', sizeBytes: PDF.length });

    // Staff readers can open it; a parent cannot see a draft's files
    const staff = await download('principal', `/api/circulars/${id}/attachments/${attId}/download`);
    expect(staff.status).toBe(200);
    expect(Buffer.compare(staff.body, PDF)).toBe(0);
    const familyPath = `/api/family/circulars/${id}/attachments/${attId}/download`;
    expect((await download('parent', familyPath)).status).toBe(404);

    await principal.post(`/api/circulars/${id}/submit`);
    expect((await (await as('superadmin')).post(`/api/circulars/${id}/release`)).status).toBe(200);

    // Released: the Grade 5 family gets the file, a Grade 7 family does not
    const own = await download('parent', familyPath);
    expect(own.status).toBe(200);
    expect(Buffer.compare(own.body, PDF)).toBe(0);
    expect((await download('parent2', familyPath)).status).toBe(404);
    const family = await (await as('parent')).get('/api/family/circulars');
    expect(family.body.data.find((x: any) => x.id === id).attachments).toHaveLength(1);

    // Locked once released, like the text
    const late = await attach('principal', id, PDF, 'late.pdf', 'application/pdf');
    expect(late.status).toBe(409);
    expect(late.body.error).toBe('CIRCULAR_LOCKED');
    expect((await principal.delete(`/api/circulars/${id}/attachments/${attId}`)).status).toBe(409);
  });

  it('removes attachments from a draft and caps them at five', async () => {
    const principal = await as('principal');
    const c = await principal.post('/api/circulars', { title: 'Attachment limit (test)', body: 'Testing the attachment limit.', audience: { kind: 'all' } });
    const id = c.body.data.id as string;
    const ids: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const r = await attach('principal', id, PDF, `page-${i}.pdf`, 'application/pdf');
      expect(r.status).toBe(201);
      ids.push(r.body.data.id);
    }
    const sixth = await attach('principal', id, PDF, 'page-6.pdf', 'application/pdf');
    expect(sixth.status).toBe(409);
    expect(sixth.body.error).toBe('TOO_MANY_ATTACHMENTS');

    expect((await principal.delete(`/api/circulars/${id}/attachments/${ids[0]}`)).status).toBe(200);
    expect((await principal.delete(`/api/circulars/${id}/attachments/${ids[0]}`)).status).toBe(404);
    expect((await download('principal', `/api/circulars/${id}/attachments/${ids[0]}/download`)).status).toBe(404);
    const got = await principal.get(`/api/circulars/${id}`);
    expect(got.body.data.attachments.map((a: any) => a.id)).toEqual(ids.slice(1));
    // Room again after the removal
    expect((await attach('principal', id, PDF, 'page-6.pdf', 'application/pdf')).status).toBe(201);
  });

  it('lets only senders change attachments', async () => {
    const c = await (await as('principal')).post('/api/circulars', { title: 'Sender check (test)', body: 'Only senders may attach files.', audience: { kind: 'all' } });
    expect((await attach('parent', c.body.data.id, PDF, 'x.pdf', 'application/pdf')).status).toBe(403);
  });
});
