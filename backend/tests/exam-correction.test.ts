/**
 * Paper Correction gateway: permissions, signed forwarding, path allow-list and error
 * mapping, against a stand-in for the EXAM Vision service (no Python needed).
 */
import { createHash, createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { as } from './helpers.js';

const SECRET = 'exam-correction-test-secret-0123456789abcdef';
const sign = (...p: string[]) => createHmac('sha256', SECRET).update(p.join('\n')).digest('hex');

interface Seen { method: string; url: string; headers: IncomingMessage['headers']; body: Buffer }
let seen: Seen[] = [];
let reply: (s: Seen) => { status: number; type?: string; body: string } = () => ({ status: 200, body: '{}' });
let server: Server;
const saved = { url: env.EXAM_VISION_URL, secret: env.EXAM_VISION_SECRET };

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const s = { method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(chunks) };
      seen.push(s);
      const r = s.url === '/api/integration/sync' ? { status: 200, body: '{"students_created":0,"students_updated":0,"staff":1,"staff_disabled":0}' } : reply(s);
      res.writeHead(r.status, { 'content-type': r.type ?? 'application/json' });
      res.end(r.body);
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  env.EXAM_VISION_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  env.EXAM_VISION_SECRET = SECRET;
});
afterAll(() => {
  env.EXAM_VISION_URL = saved.url;
  env.EXAM_VISION_SECRET = saved.secret;
  server.close();
});
beforeEach(() => { seen = []; reply = () => ({ status: 200, body: '{}' }); });

const forwarded = () => seen.filter((s) => s.url !== '/api/integration/sync');

describe('Paper Correction gateway', () => {
  it('is for markers only', async () => {
    expect((await (await as('parent')).get('/api/exam-correction/status')).status).toBe(403);
    expect((await (await as('finance')).get('/api/exam-correction/api/exams')).status).toBe(403);
    expect(seen).toHaveLength(0);
  });

  it('pushes a signed roster and forwards requests with a signed identity', async () => {
    reply = () => ({ status: 200, body: '[{"id":"e1"}]' });
    const t = await as('teacher');
    const r = await t.get('/api/exam-correction/api/exams?x=1');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, data: [{ id: 'e1' }] });

    const sync = seen.find((s) => s.url === '/api/integration/sync');
    if (sync) { // synced once per process; may have happened in an earlier test
      const ts = sync.headers['x-hs-ts'] as string;
      expect(sync.headers['x-hs-sig']).toBe(sign('sync', ts, createHash('sha256').update(sync.body).digest('hex')));
      const roster = JSON.parse(sync.body.toString());
      expect(roster.students.length).toBeGreaterThan(0);
      expect(roster.students[0].class_name).toMatch(/ · [A-Z]+$/);
    }
    const [f] = forwarded();
    expect(f.url).toBe('/api/exams?x=1');
    const h = f.headers as Record<string, string>;
    expect(h['x-hs-role']).toBe('teacher');
    expect(h['x-hs-sig']).toBe(sign(h['x-hs-user'], h['x-hs-role'], h['x-hs-name'], h['x-hs-ts']));
    expect(h.authorization).toBeUndefined(); // the Holy Sai token never leaves
  });

  it('maps Holy Sai roles to service roles', async () => {
    reply = () => ({ status: 200, body: '{}' });
    await (await as('principal')).get('/api/exam-correction/api/auth/me');
    await (await as('superadmin')).get('/api/exam-correction/api/auth/me');
    expect(forwarded().map((s) => s.headers['x-hs-role'])).toEqual(['coordinator', 'admin']);
  });

  it('forwards JSON bodies and multipart uploads', async () => {
    const p = await as('principal');
    expect((await p.post('/api/exam-correction/api/exams', { name: 'UT', notes: 'line 1\nline 2' })).status).toBe(200);
    expect(JSON.parse(forwarded()[0].body.toString())).toEqual({ name: 'UT', notes: 'line 1\nline 2' });
    seen = [];
    const { token } = await (await import('./helpers.js')).login('principal');
    const request = (await import('supertest')).default;
    const { app } = await import('./helpers.js');
    const up = await request(app).post('/api/exam-correction/api/exams/e1/submissions').set('Authorization', `Bearer ${token}`)
      .field('student_id', 's1').attach('files', Buffer.from('%PDF-1.4 test'), 'A1.pdf');
    expect(up.status).toBe(200);
    const [m] = forwarded();
    expect(m.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(m.body.toString()).toContain('%PDF-1.4 test');
  });

  it('exposes only the module endpoints', async () => {
    const p = await as('principal');
    expect((await p.post('/api/exam-correction/api/auth/login', { username: 'a', password: 'b' })).status).toBe(404);
    expect((await p.post('/api/exam-correction/api/students', { admission_no: 'X' })).status).toBe(404);
    expect((await p.post('/api/exam-correction/api/integration/sync', {})).status).toBe(404);
    expect(forwarded()).toHaveLength(0);
  });

  it('never signs the user out over a refused gateway signature', async () => {
    reply = () => ({ status: 401, body: '{"detail":"Sign in to Holy Sai first."}' });
    const r = await (await as('teacher')).get('/api/exam-correction/api/exams');
    expect(r.status).toBe(502);
    reply = () => ({ status: 409, body: '{"detail":"Results are draft"}' });
    const c = await (await as('principal')).post('/api/exam-correction/api/exams/e1/results/approved', {});
    expect(c.status).toBe(409);
    expect(c.body).toMatchObject({ success: false, message: 'Results are draft', error: 'EXAM_VISION_409' });
  });

  it('passes images through untouched', async () => {
    reply = () => ({ status: 200, type: 'image/png', body: '\u0089PNG-bytes' });
    const r = await (await as('teacher')).get('/api/exam-correction/api/pages/p1/image').buffer(true);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
  });

  it('reports "not connected" when unconfigured', async () => {
    env.EXAM_VISION_URL = undefined;
    try {
      const t = await as('teacher');
      expect((await t.get('/api/exam-correction/status')).body.data).toMatchObject({ connected: false, role: 'teacher' });
      expect((await t.get('/api/exam-correction/api/exams')).status).toBe(503);
    } finally {
      env.EXAM_VISION_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }
  });
});
