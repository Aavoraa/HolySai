/**
 * Cambridge IGCSE catalogue: the syllabus document each grade is examined on,
 * linking school syllabuses by code, grade mapping, and adding from the catalogue.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { as } from './helpers.js';
import { one, pool, query } from '../src/config/db.js';

afterAll(() => pool.end());

describe('Cambridge IGCSE catalogue', () => {
  it('lists every Cambridge syllabus with the document for each grade’s exam year', async () => {
    const api = await as('principal');
    const r = await api.get('/api/syllabus-catalogue');
    expect(r.status).toBe(200);
    expect(r.body.data.rows).toHaveLength(104);
    const end = await one<{ y: number }>('SELECT extract(year FROM ends_on)::int AS y FROM academic_years WHERE is_current');
    expect(r.body.data.examYears).toEqual({ 10: end!.y, 9: end!.y + 1 });

    // Each grade gets the newest document that covers its exam year
    const maths = r.body.data.rows.find((x: any) => x.code === '0580');
    for (const g of maths.byGrade) {
      expect(g.examYear).toBe(end!.y + (10 - g.grade));
      if (g.document) expect(g.document.from <= g.examYear && g.examYear <= g.document.to).toBe(true);
    }
    expect(maths.school).not.toBeNull(); // seeded school syllabus with the same code

    const nineOne = await api.get('/api/syllabus-catalogue?grading=9-1');
    expect(nineOne.body.data.rows.length).toBeGreaterThan(0);
    expect(nineOne.body.data.rows.every((x: any) => x.grading === '9-1')).toBe(true);
    expect((await api.get('/api/syllabus-catalogue?q=0625')).body.data.rows.map((x: any) => x.code)).toEqual(['0625']);
  });

  it('links school syllabuses to Cambridge by code, only for the grades that take them', async () => {
    const api = await as('principal');
    const list = (await api.get('/api/syllabuses')).body.data;
    const physics = list.find((s: any) => s.syllabusCode === '0625');
    expect(physics.gradeLevels).toEqual([10]);
    expect(physics.cambridge.byGrade.map((g: any) => g.grade)).toEqual([10]);
    expect(physics.cambridge.subjectPage).toMatch(/^https:\/\/www\.cambridgeinternational\.org\//);
    const school = list.find((s: any) => !s.syllabusCode);
    if (school) expect(school.cambridge).toBeNull();
    // Coverage counts only sections in the syllabus's grades
    const g10 = await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM sections sec JOIN classes c ON c.id = sec.class_id
        WHERE sec.academic_year_id = (SELECT id FROM academic_years WHERE is_current) AND c.grade_level = 10`);
    expect(physics.sections).toBe(g10!.n);
  });

  it('adds an A*–G syllabus from the catalogue and refuses 9–1, duplicates and non-managers', async () => {
    const admin = await as('superadmin');
    await query(`DELETE FROM syllabuses WHERE syllabus_code = '0610'`); // runnable again without a reset
    const sub = await one<{ id: string }>(`SELECT id FROM subjects WHERE code = 'SCI'`);
    const r = await admin.post('/api/syllabus-catalogue/add', { code: '0610', subjectId: sub!.id, gradeLevels: [10, 9], tiered: true });
    expect(r.status).toBe(201);
    const s = (await admin.get(`/api/syllabuses/${r.body.data.id}`)).body.data;
    expect(s).toMatchObject({ syllabusCode: '0610', title: 'Cambridge IGCSE Biology', gradeLevels: [9, 10], tiered: true, grading: 'A*-G' });
    expect(s.cambridge.byGrade).toHaveLength(2);

    const again = await admin.post('/api/syllabus-catalogue/add', { code: '0610', subjectId: sub!.id, gradeLevels: [9] });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('SYLLABUS_CODE_TAKEN');

    const nineOne = await admin.post('/api/syllabus-catalogue/add', { code: '0970', subjectId: sub!.id, gradeLevels: [9, 10] });
    expect(nineOne.status).toBe(409);
    expect(nineOne.body.error).toBe('GRADING_NOT_SUPPORTED');

    expect((await admin.post('/api/syllabus-catalogue/add', { code: '9999', subjectId: sub!.id, gradeLevels: [9] })).status).toBe(404);
    expect((await admin.post('/api/syllabus-catalogue/add', { code: '0620', subjectId: sub!.id, gradeLevels: [11] })).status).toBe(400);
    expect((await (await as('teacher')).post('/api/syllabus-catalogue/add', { code: '0620', subjectId: sub!.id, gradeLevels: [9] })).status).toBe(403);

    // Grades can be changed afterwards
    const upd = await admin.put(`/api/syllabuses/${r.body.data.id}`, { gradeLevels: [10] });
    expect(upd.status).toBe(200);
    expect((await admin.get(`/api/syllabuses/${r.body.data.id}`)).body.data.gradeLevels).toEqual([10]);
  });
});
