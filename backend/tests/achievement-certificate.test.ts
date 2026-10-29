/**
 * Achievements with an optional certificate/photo: stored as a student document,
 * linked to the achievement, downloadable by staff and the student's own parent only.
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, as, login } from './helpers.js';
import { one, pool } from '../src/config/db.js';

afterAll(() => pool.end());

const PDF = Buffer.from('%PDF-1.4\n% achievement certificate test\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function studentId(admissionNo: string) {
  return (await one<{ id: string }>('SELECT id FROM students WHERE admission_no = $1', [admissionNo]))!.id;
}

describe('achievement certificates', () => {
  it('records an achievement with a certificate that staff and the child’s parent can open', async () => {
    const id = await studentId('HS-2026-1041'); // child of the demo parent, in the teacher's Grade 5A
    const { token } = await login('teacher');
    const r = await request(app).post(`/api/students/${id}/achievements`).set('Authorization', `Bearer ${token}`)
      .field('title', 'District science fair — first place (test)').field('achievementType', 'Competition')
      .field('level', 'District').field('achievedOn', '2026-10-01')
      .attach('file', PDF, { filename: 'certificate.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(201);
    const docId = r.body.data.documentId as string;
    expect(docId).toBeTruthy();

    const profile = await (await as('principal')).get(`/api/students/${id}/profile`);
    const ach = profile.body.data.achievements.find((a: any) => a.id === r.body.data.id);
    expect(ach).toMatchObject({ documentId: docId, fileName: 'certificate.pdf', fileType: 'application/pdf', verified: true });
    const doc = await one<{ category: string; student_id: string }>('SELECT category, student_id FROM documents WHERE id = $1', [docId]);
    expect(doc).toEqual({ category: 'Achievement certificate', student_id: id });

    const dl = async (who: 'principal' | 'parent' | 'parent2') => {
      const t = (await login(who)).token;
      return request(app).get(`/api/documents/${docId}/download`).set('Authorization', `Bearer ${t}`);
    };
    expect((await dl('principal')).status).toBe(200);
    expect((await dl('parent')).status).toBe(200);
    expect((await dl('parent2')).status).toBe(404); // another family's child
  });

  it('still accepts achievements without a file, and refuses a file that is not what it claims', async () => {
    const id = await studentId('HS-2026-1041');
    const plain = await (await as('teacher')).post(`/api/students/${id}/achievements`,
      { title: 'Class quiz winner (test)', achievementType: 'Academic', level: 'School', achievedOn: '2026-10-02' });
    expect(plain.status).toBe(201);
    expect(plain.body.data.documentId).toBeNull();

    const { token } = await login('teacher');
    const fake = await request(app).post(`/api/students/${id}/achievements`).set('Authorization', `Bearer ${token}`)
      .field('title', 'Fake certificate (test)').field('achievementType', 'Sports').field('achievedOn', '2026-10-03')
      .attach('file', Buffer.from('not an image'), { filename: 'photo.png', contentType: 'image/png' });
    expect(fake.status).toBe(400);
    expect(fake.body.error).toBe('FILE_TYPE_MISMATCH');
    // Nothing half-saved
    expect(await one(`SELECT 1 FROM achievements WHERE title = 'Fake certificate (test)'`)).toBeNull();

    const photo = await request(app).post(`/api/students/${id}/achievements`).set('Authorization', `Bearer ${token}`)
      .field('title', 'Sports day photo (test)').field('achievementType', 'Sports').field('achievedOn', '2026-10-03')
      .attach('file', PNG, { filename: 'photo.png', contentType: 'image/png' });
    expect(photo.status).toBe(201);
  });

  it('keeps teachers to their own students', async () => {
    const other = await studentId('HS-2026-1042'); // Grade 7B, not the teacher's class
    const { token } = await login('teacher');
    const r = await request(app).post(`/api/students/${other}/achievements`).set('Authorization', `Bearer ${token}`)
      .field('title', 'Out of scope (test)').field('achievementType', 'Academic').field('achievedOn', '2026-10-04')
      .attach('file', PDF, { filename: 'c.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(404);
    expect(await one(`SELECT 1 FROM documents WHERE name = 'Out of scope (test)'`)).toBeNull();
  });
});
