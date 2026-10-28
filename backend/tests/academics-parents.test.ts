/**
 * Regression tests for academics, parents and parent-experience fixes:
 * teacher scope on /parents, audience targeting, circular release races,
 * PTM booking races and scope, and report-card approval counts.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { as, login } from './helpers.js';
import { many, one, pool, query } from '../src/config/db.js';

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

afterAll(() => pool.end());

describe('parents routes respect the teacher class scope', () => {
  it("hides families outside the teacher's sections", async () => {
    const other = await login('parent2'); // child HS-2026-1042 is in Grade 7B, not taught by the teacher
    const own = await login('parent'); // children in Grade 5A (teacher's class)
    const api = await as('teacher');
    expect((await api.get(`/api/parents/${other.user.parentId}`)).status).toBe(404);
    expect((await api.get(`/api/parents/${other.user.parentId}/children`)).status).toBe(404);
    expect((await api.get(`/api/parents/${other.user.parentId}/children/HS-2026-1042/overview`)).status).toBe(404);
    const list = await api.get('/api/parents?pageSize=200');
    expect(list.status).toBe(200);
    expect(list.body.data.some((p: any) => p.id === other.user.parentId)).toBe(false);
    expect(list.body.data.some((p: any) => p.id === own.user.parentId)).toBe(true);
    // Families in the teacher's class remain visible
    expect((await api.get(`/api/parents/${own.user.parentId}`)).status).toBe(200);
    expect((await api.get(`/api/parents/${own.user.parentId}/children/HS-2026-1041/overview`)).status).toBe(200);
    // School-wide staff are unaffected
    expect((await (await as('office')).get(`/api/parents/${other.user.parentId}/children`)).status).toBe(200);
  });

  it('limits circular acknowledgement lists (names, phones) to the teacher families', async () => {
    const other = await login('parent2');
    const own = await login('parent');
    const c = await one<{ id: string }>(`SELECT id FROM circulars WHERE status = 'Released' AND audience = 'All parents' LIMIT 1`);
    const ids = async (who: 'teacher' | 'principal') => {
      const all: string[] = [];
      for (const state of ['pending', 'acknowledged']) {
        const r = await (await as(who)).get(`/api/circulars/${c!.id}/acknowledgements?state=${state}&pageSize=200`);
        expect(r.status).toBe(200);
        all.push(...r.body.data.map((x: any) => x.parentId));
      }
      return all;
    };
    const teacherSees = await ids('teacher');
    expect(teacherSees).not.toContain(other.user.parentId);
    expect(teacherSees).toContain(own.user.parentId);
    expect(await ids('principal')).toContain(other.user.parentId);
  });
});

describe('audience targeting', () => {
  it('shows a parent only the events addressed to them on the Parent 360 home', async () => {
    const principal = await as('principal');
    const staffOnly = await principal.post('/api/events', { title: 'Staff training day (test)', startsOn: future(5), audience: { kind: 'staff' }, status: 'Published' });
    const grade12 = await principal.post('/api/events', { title: 'Grade 12 briefing (test)', startsOn: future(5), audience: { kind: 'grades', grades: [12] }, status: 'Published' });
    expect(staffOnly.status).toBe(201);
    expect(grade12.status).toBe(201);
    const { user } = await login('parent');
    const r = await (await as('parent')).get(`/api/parents/${user.parentId}/children/HS-2026-1041/overview`);
    expect(r.status).toBe(200);
    const ids = r.body.data.events.map((e: any) => e.id);
    expect(ids).not.toContain(staffOnly.body.data.id);
    expect(ids).not.toContain(grade12.body.data.id);
    await query('DELETE FROM events WHERE id = ANY($1)', [[staffOnly.body.data.id, grade12.body.data.id]]);
  });

  it('notifies only the staff of the circular campus', async () => {
    const principal = await as('principal');
    const campus = await one<{ id: string }>(`SELECT id FROM campuses WHERE code = 'vdv'`);
    const c = await principal.post('/api/circulars', { title: 'Vadavalli staff notice (test)', body: 'Staff meeting on Friday at 4 pm.', audience: { kind: 'staff' }, campusId: campus!.id });
    expect(c.status).toBe(201);
    expect(c.body.data.targetCount).toBe(0);
    await principal.post(`/api/circulars/${c.body.data.id}/submit`);
    const rel = await principal.post(`/api/circulars/${c.body.data.id}/release`);
    expect(rel.status).toBe(200);
    expect(rel.body.data.notified).toBe(0);
    const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE entity_id = $1 AND title = 'New circular from school'`, [c.body.data.id]);
    expect(n!.n).toBe(0);
  });

  it('releases a circular only once when two approvals race', async () => {
    const principal = await as('principal');
    const c = await principal.post('/api/circulars', { title: 'Race test circular', body: 'Please read this circular carefully.', audience: { kind: 'grades', grades: [5] } });
    await principal.post(`/api/circulars/${c.body.data.id}/submit`);
    const [a, b] = await Promise.all([
      principal.post(`/api/circulars/${c.body.data.id}/release`),
      principal.post(`/api/circulars/${c.body.data.id}/release`),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const n = await one<{ n: number; users: number }>(
      `SELECT count(*)::int AS n, count(DISTINCT user_id)::int AS users FROM notifications WHERE entity_id = $1 AND topic = 'circulars' AND title LIKE 'Circular needs%'`,
      [c.body.data.id]);
    expect(n!.n).toBe(n!.users);
  });
});

describe('PTM', () => {
  async function newSession() {
    const teacher = await login('teacher');
    const section = await one<{ id: string }>(`SELECT section_id AS id FROM students WHERE admission_no = 'HS-2026-1041'`);
    const r = await (await as('principal')).post('/api/ptm/sessions', {
      employeeId: teacher.user.employeeId, sectionId: section!.id, subjectLabel: 'Race test', sessionDate: future(10), totalSlots: 5,
    });
    expect(r.status).toBe(201);
    return r.body.data.id as string;
  }

  it('books at most one slot per child when two bookings race', async () => {
    const id = await newSession();
    const api = await as('parent');
    const res = await Promise.all([1, 2, 3].map((slotNo) => api.post(`/api/family/ptm/${id}/book`, { studentId: 'HS-2026-1041', slotNo })));
    expect(res.map((r) => r.status).filter((s) => s === 201)).toHaveLength(1);
    const rows = await many(`SELECT 1 FROM ptm_bookings b JOIN students s ON s.id = b.student_id WHERE b.ptm_session_id = $1 AND s.admission_no = 'HS-2026-1041' AND b.status <> 'Cancelled'`, [id]);
    expect(rows).toHaveLength(1);
    await query('DELETE FROM ptm_sessions WHERE id = $1', [id]);
  });

  it('does not let a session be moved into the past', async () => {
    const id = await newSession();
    const r = await (await as('principal')).patch(`/api/ptm/sessions/${id}`, { sessionDate: '2020-01-01' });
    expect(r.status).toBe(400);
    await query('DELETE FROM ptm_sessions WHERE id = $1', [id]);
  });

  it("does not let a teacher open a session for a section they don't teach", async () => {
    const teacher = await login('teacher');
    const section = await one<{ id: string }>(`SELECT section_id AS id FROM students WHERE admission_no = 'HS-2026-1042'`);
    const r = await (await as('teacher')).post('/api/ptm/sessions', {
      employeeId: teacher.user.employeeId, sectionId: section!.id, subjectLabel: 'Scope test', sessionDate: future(10), totalSlots: 5,
    });
    expect(r.status).toBe(400);
    await query(`DELETE FROM ptm_sessions WHERE subject_label = 'Scope test'`);
  });
});

describe('report cards', () => {
  it('counts only current students when checking approvals before sign-off', async () => {
    const b = await one<{ id: string; section_id: string }>(
      `SELECT b.id, b.section_id FROM report_card_batches b WHERE b.stage = 3 ORDER BY b.id LIMIT 1`);
    expect(b).toBeTruthy();
    const roster = await many<{ id: string }>(`SELECT id FROM students WHERE section_id = $1 AND deleted_at IS NULL AND status = 'active' ORDER BY id`, [b!.section_id]);
    const outsider = await one<{ id: string }>(`SELECT id FROM students WHERE section_id <> $1 LIMIT 1`, [b!.section_id]);
    const before = await many(`SELECT * FROM report_card_comments WHERE batch_id = $1`, [b!.id]);
    try {
      // Every current student has a comment, all approved except one; plus an approved comment
      // for a student who has since left the class.
      for (const s of roster) {
        await query(`INSERT INTO report_card_comments (batch_id, student_id, comment, ai_drafted, status) VALUES ($1,$2,'Test comment for the term.',true,'Approved')
                     ON CONFLICT (batch_id, student_id) DO UPDATE SET status = 'Approved'`, [b!.id, s.id]);
      }
      await query(`UPDATE report_card_comments SET status = 'Draft' WHERE batch_id = $1 AND student_id = $2`, [b!.id, roster[0].id]);
      await query(`INSERT INTO report_card_comments (batch_id, student_id, comment, ai_drafted, status) VALUES ($1,$2,'Left the class.',true,'Approved')`, [b!.id, outsider!.id]);
      const r = await (await as('principal')).post(`/api/academics/report-cards/${b!.id}/advance`, { toStage: 4 });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('COMMENTS_PENDING');
    } finally {
      await query('DELETE FROM report_card_comments WHERE batch_id = $1', [b!.id]);
      for (const c of before) {
        await query(`INSERT INTO report_card_comments (id, batch_id, student_id, comment, ai_drafted, status, reviewed_by, created_at, updated_at)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [c.id, c.batch_id, c.student_id, c.comment, c.ai_drafted, c.status, c.reviewed_by, c.created_at, c.updated_at]);
      }
      await query('UPDATE report_card_batches SET stage = 3 WHERE id = $1', [b!.id]);
    }
  });
});

describe('dashboards', () => {
  it('serves the Owner Overview for a campus and the group, and attendance analytics', async () => {
    const admin = await as('superadmin');
    const campus = await admin.get('/api/dashboard/overview');
    const group = await admin.get('/api/dashboard/overview?scope=group');
    expect(campus.status).toBe(200);
    expect(group.status).toBe(200);
    expect(Array.isArray(campus.body.data.activity.approvals)).toBe(true);
    // A campus never waits on more approvals than the whole group
    for (const row of campus.body.data.activity.approvals) {
      const g = group.body.data.activity.approvals.find((x: any) => x.label === row.label);
      expect(row.count).toBeLessThanOrEqual(g.count);
    }
    const a = await (await as('principal')).get('/api/attendance/analytics');
    expect(a.status).toBe(200);
    expect(a.body.data.kpis).toHaveProperty('tenDayAverage');
  });
});
