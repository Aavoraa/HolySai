/**
 * November 2026 school requests: timetable and calendar upload (class teachers edit their own
 * class), admission tracking for families, fee bills with bank/UPI details, biometric staff
 * attendance, teacher documents, public certificate checks, RFID visitor cards and WhatsApp sending.
 */
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { app, as, login, type Who } from './helpers.js';
import { many, one, pool, query } from '../src/config/db.js';
import { parsePunchTime } from '../src/services/workforce-biometric.service.js';
import { sendWhatsApp, whatsappNumber } from '../src/services/whatsapp.provider.js';
import { env } from '../src/config/env.js';

afterAll(() => pool.end());

const PDF = Buffer.from('%PDF-1.4\n% school requests test\n');

async function upload(who: Who, path: string, file: Buffer, filename: string, fields: Record<string, string> = {}, type = 'text/csv') {
  const { token } = await login(who);
  let r = request(app).post(path).set('Authorization', `Bearer ${token}`).set('X-Client-Type', 'mobile');
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
  return r.attach('file', file, { filename, contentType: type });
}
const csv = (rows: string[]) => Buffer.from(rows.join('\r\n') + '\r\n');

/** The demo teacher and the section they are class teacher of. */
async function teacherClass() {
  return (await one<{ employee_id: string; section_id: string; cls: string; sec: string; campus_id: string; other_section: string }>(
    `SELECT e.id AS employee_id, sec.id AS section_id, c.name AS cls, sec.name AS sec, c.campus_id,
            (SELECT s2.id FROM sections s2 JOIN classes c2 ON c2.id = s2.class_id
              WHERE c2.campus_id = c.campus_id AND s2.id <> sec.id AND s2.class_teacher_id IS DISTINCT FROM e.id LIMIT 1) AS other_section
       FROM employees e JOIN users u ON u.id = e.user_id JOIN sections sec ON sec.class_teacher_id = e.id
       JOIN classes c ON c.id = sec.class_id JOIN academic_years ay ON ay.id = sec.academic_year_id AND ay.is_current
      WHERE u.email = 'priya.raghavan.demo@holysai.edu' LIMIT 1`))!;
}

describe('timetable: class teachers and upload', () => {
  it('lets a class teacher add, edit and clear periods of their own class only', async () => {
    const t = await teacherClass();
    const teacher = await as('teacher');
    const period = (await one<{ id: string }>('SELECT id FROM periods WHERE campus_id = $1 ORDER BY period_no DESC LIMIT 1', [t.campus_id]))!;
    await query('DELETE FROM timetable_entries WHERE section_id = $1 AND day_of_week = 6 AND period_id = $2', [t.section_id, period.id]);

    const tt = await teacher.get(`/api/academics/timetable?sectionId=${t.section_id}`);
    expect(tt.body.data.canEdit).toBe(true);

    const add = await teacher.put('/api/academics/timetable/slots', { sectionId: t.section_id, day: 6, periodId: period.id, activity: 'Club', room: 'Hall' });
    expect(add.status).toBe(201);
    const edit = await teacher.put(`/api/academics/timetable/entries/${add.body.data.id}`, { activity: 'Library' });
    expect(edit.status).toBe(200);
    expect((await one('SELECT activity FROM timetable_entries WHERE id = $1', [add.body.data.id]))!.activity).toBe('Library');
    expect((await teacher.delete(`/api/academics/timetable/entries/${add.body.data.id}`)).status).toBe(200);

    // Another class: visible to the school office, not editable by this teacher.
    const other = await teacher.put('/api/academics/timetable/slots', { sectionId: t.other_section, day: 6, periodId: period.id, activity: 'Club' });
    expect([403, 404]).toContain(other.status);
  });

  it('imports a timetable CSV after checking every row', async () => {
    const t = await teacherClass();
    const p = (await one<{ no: number }>('SELECT max(period_no) AS no FROM periods WHERE campus_id = $1', [t.campus_id]))!;
    const subject = (await one<{ code: string }>('SELECT code FROM subjects ORDER BY code LIMIT 1'))!;
    const file = csv([
      'class,section,day,period,subject,activity,teacher,room',
      `${t.cls},${t.sec},Saturday,${p.no},${subject.code},,,R-1`,
      `${t.cls},${t.sec},Saturday,${p.no - 1},,Games,,Ground`,
    ]);
    const tmpl = await (await as('teacher')).get('/api/academics/timetable/import/template');
    expect(tmpl.status).toBe(200);
    expect(tmpl.text).toContain('class,section,day,period');

    const check = await upload('teacher', '/api/academics/timetable/import', file, 'tt.csv', { campusId: t.campus_id, dryRun: 'true' });
    expect(check.status).toBe(200);
    expect(check.body.data).toMatchObject({ dryRun: true, valid: 2, failed: 0, imported: 0 });

    const bad = await upload('teacher', '/api/academics/timetable/import', csv(['class,section,day,period', `${t.cls},${t.sec},Funday,99`]), 'bad.csv', { campusId: t.campus_id });
    expect(bad.body.data.failed).toBe(1);
    expect(bad.body.data.imported).toBe(0);

    const run = await upload('teacher', '/api/academics/timetable/import', file, 'tt.csv', { campusId: t.campus_id });
    expect(run.body.data).toMatchObject({ dryRun: false, imported: 2, failed: 0 });
    const rows = await many('SELECT activity FROM timetable_entries WHERE section_id = $1 AND day_of_week = 6', [t.section_id]);
    expect(rows.some((r) => r.activity === 'Games')).toBe(true);
    await query('DELETE FROM timetable_entries WHERE section_id = $1 AND day_of_week = 6', [t.section_id]);
  });
});

describe('academic calendar upload', () => {
  it('adds term dates and holidays and flags duplicates', async () => {
    const title = `Test holiday ${Date.now()}`;
    const file = csv(['title,type,startDate,endDate', `${title},Holiday,20/12/2026,22/12/2026`, 'Bad row,Picnic,2026-13-40,']);
    const check = await upload('teacher', '/api/events/import', file, 'cal.csv', { dryRun: 'true' });
    expect(check.status).toBe(200);
    expect(check.body.data).toMatchObject({ valid: 1, failed: 1 });

    const ok = await upload('teacher', '/api/events/import', csv(['title,type,startDate,endDate', `${title},Holiday,20/12/2026,22/12/2026`]), 'cal.csv');
    expect(ok.body.data.imported).toBe(1);
    const e = await one<{ starts_on: string; ends_on: string; event_type: string }>(
      `SELECT to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on, event_type FROM events WHERE title = $1`, [title]);
    expect(e).toMatchObject({ starts_on: '2026-12-20', ends_on: '2026-12-22', event_type: 'Holiday' });

    const again = await upload('teacher', '/api/events/import', csv(['title,type,startDate', `${title},Holiday,2026-12-20`]), 'cal.csv', { dryRun: 'true' });
    expect(again.body.data.results[0].errors[0].message).toMatch(/Already on the calendar/);
    await query('DELETE FROM events WHERE title = $1', [title]);
  });
});

describe('admission tracking', () => {
  it('records every status change and shows families their progress by number and phone', async () => {
    const a = (await one<{ id: string; application_no: string; phone: string }>(
      `SELECT a.id, a.application_no, COALESCE(a.guardian_phone, e.phone) AS phone FROM admissions a LEFT JOIN enquiries e ON e.id = a.enquiry_id
        WHERE a.status = 'Submitted' AND COALESCE(a.guardian_phone, e.phone) IS NOT NULL LIMIT 1`))!;
    const principal = await as('principal');
    const moved = await principal.post(`/api/applications/${a.id}/status`, { status: 'Under Review', note: 'Documents received at the desk' });
    expect(moved.status).toBe(200);

    const detail = (await principal.get(`/api/applications/${a.id}`)).body.data;
    expect(detail.statusHistory[0]).toMatchObject({ fromStatus: 'Submitted', toStatus: 'Under Review', note: 'Documents received at the desk' });
    expect(detail.statusHistory[0].changedBy).toBeTruthy();

    const pub = await request(app).get('/api/public/application-status').query({ applicationNo: a.application_no.toLowerCase(), phone: a.phone });
    expect(pub.status).toBe(200);
    expect(pub.body.data).toMatchObject({ applicationNo: a.application_no, status: 'Under Review' });
    expect(pub.body.data.steps.find((s: any) => s.status === 'Under Review').state).toBe('current');
    expect(JSON.stringify(pub.body.data)).not.toContain('Documents received'); // office notes stay private

    const wrong = await request(app).get('/api/public/application-status').query({ applicationNo: a.application_no, phone: '9000000000' });
    expect(wrong.status).toBe(404);
    await query(`UPDATE admissions SET status = 'Submitted' WHERE id = $1`, [a.id]);
  });
});

describe('fee bill', () => {
  it('lists what is owed with the school bank and UPI details', async () => {
    await query(`UPDATE system_settings SET value = '"HDFC Bank"' WHERE key = 'finance.bank_name'`);
    await query(`UPDATE system_settings SET value = '"50200012345678"' WHERE key = 'finance.bank_account_no'`);
    await query(`UPDATE system_settings SET value = '"HDFC0001234"' WHERE key = 'finance.bank_ifsc'`);
    await query(`UPDATE system_settings SET value = '"holysai@hdfcbank"' WHERE key = 'finance.upi_id'`);
    const s = (await one<{ id: string }>(
      `SELECT student_id AS id FROM student_fees WHERE amount_due - concession_amount - amount_paid > 0 AND status <> 'Waived' LIMIT 1`))!;
    const r = await (await as('finance')).get(`/api/finance/accounts/${s.id}/bill`);
    expect(r.status).toBe(200);
    expect(r.body.data.total).toBeGreaterThan(0);
    expect(r.body.data.billNo).toMatch(/^BILL-/);
    expect(r.body.data.bank).toMatchObject({ bankName: 'HDFC Bank', ifsc: 'HDFC0001234', upiId: 'holysai@hdfcbank', configured: true });
    expect(r.body.data.lines.every((l: any) => l.balance > 0)).toBe(true);
    await query(`UPDATE system_settings SET value = '""' WHERE key LIKE 'finance.bank%' OR key = 'finance.upi_id'`);
  });
});

describe('biometric staff attendance', () => {
  it('takes punches from a registered machine and derives check-in and check-out', async () => {
    const hr = await as('hr');
    const dev = await hr.post('/api/workforce/biometric-devices', { name: 'Test staff entry' });
    expect(dev.status).toBe(201);
    const { deviceCode, token } = dev.body.data;
    const emp = (await one<{ id: string; code: string }>(
      `SELECT e.id, e.employee_code AS code FROM employees e WHERE e.deleted_at IS NULL AND e.employment_status = 'active'
          AND NOT EXISTS (SELECT 1 FROM leave_requests l WHERE l.employee_id = e.id AND l.status = 'Approved' AND current_date BETWEEN l.from_date AND l.to_date)
        ORDER BY e.employee_code DESC LIMIT 1`))!;
    const day = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    await query(`DELETE FROM staff_attendance WHERE employee_id = $1 AND attendance_date = $2`, [emp.id, day]);

    const body = { device_id: deviceCode, punches: [
      { employee_code: emp.code, punched_at: `${day} 08:02` },
      { employee_code: emp.code, punched_at: `${day} 16:45:10` },
      { employee_code: 'NOPE-1', punched_at: `${day} 08:00` },
    ] };
    const bad = await request(app).post('/api/v1/attendance/punches').set('Authorization', 'Bearer hsb_wrong').send(body);
    expect(bad.status).toBe(401);
    const r = await request(app).post('/api/v1/attendance/punches').set('Authorization', `Bearer ${token}`).send(body);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ received: 3, stored: 2 });
    expect(r.body.data.rejected[0].reason).toMatch(/Unknown employee/);
    const again = await request(app).post('/api/v1/attendance/punches').set('Authorization', `Bearer ${token}`).send(body);
    expect(again.body.data).toMatchObject({ stored: 0, duplicates: 2 });

    const row = await one(`SELECT to_char(check_in, 'HH24:MI') AS i, to_char(check_out, 'HH24:MI') AS o, source FROM staff_attendance WHERE employee_id = $1 AND attendance_date = $2`, [emp.id, day]);
    expect(row).toMatchObject({ i: '08:02', o: '16:45', source: 'biometric' });

    // HR imports the machine's log for the same day: an earlier punch moves check-in.
    const imp = await upload('hr', '/api/workforce/attendance/punches/import', csv(['employeeCode,date,time', `${emp.code},${day},07:55`]), 'log.csv');
    expect(imp.body.data).toMatchObject({ imported: 1, failed: 0 });
    expect((await one(`SELECT to_char(check_in, 'HH24:MI') AS i FROM staff_attendance WHERE employee_id = $1 AND attendance_date = $2`, [emp.id, day]))!.i).toBe('07:55');

    await query('DELETE FROM staff_attendance_punches WHERE employee_id = $1', [emp.id]);
    await query('DELETE FROM biometric_devices WHERE device_code = $1', [deviceCode]);
  });

  it('reads machine times as school time', () => {
    expect(parsePunchTime('2026-11-03 08:05')!.toISOString()).toBe('2026-11-03T02:35:00.000Z');
    expect(parsePunchTime('2026-11-03T08:05:00Z')!.toISOString()).toBe('2026-11-03T08:05:00.000Z');
    expect(parsePunchTime('yesterday')).toBeNull();
  });
});

describe('teacher documents', () => {
  it('lets HR upload a qualification certificate and open it again', async () => {
    const t = await teacherClass();
    const up = await upload('hr', `/api/workforce/employees/${t.employee_id}/documents`, PDF, 'bed.pdf', { name: 'B.Ed. certificate (test)' }, 'application/pdf');
    expect(up.status).toBe(201);
    const profile = (await (await as('hr')).get(`/api/workforce/employees/${t.employee_id}`)).body.data;
    expect(profile.documents.find((d: any) => d.id === up.body.data.id)).toMatchObject({ status: 'Verified', hasFile: true });
    expect(profile.teaching.length).toBeGreaterThan(0);
    const dl = await (await as('hr')).get(`/api/workforce/employees/${t.employee_id}/documents/${up.body.data.id}/download`);
    expect(dl.status).toBe(200);
    expect((await (await as('teacher')).get(`/api/workforce/employees/${t.employee_id}/documents/${up.body.data.id}/download`)).status).toBe(403);
    await query('DELETE FROM documents WHERE id = $1', [up.body.data.id]);
  });
});

describe('certificate check from the QR code', () => {
  it('confirms an issued certificate without sign-in', async () => {
    const c = (await one<{ code: string }>(`SELECT verification_code AS code FROM certificates WHERE status = 'Issued' AND verification_code IS NOT NULL LIMIT 1`))!;
    const r = await request(app).get(`/api/public/certificates/${c.code}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ valid: true, code: c.code });
    expect((await request(app).get('/api/public/certificates/TC-2026-99999')).status).toBe(404);
    expect((await request(app).get('/api/public/certificates/not-a-code')).status).toBe(400);
  });
});

describe('RFID visitor cards', () => {
  it('checks a visitor in and out with a tap and lets the card be reused', async () => {
    const office = await as('office');
    const host = (await one<{ id: string }>(`SELECT id FROM employees WHERE deleted_at IS NULL AND employment_status = 'active' LIMIT 1`))!;
    const tag = `AB12${Date.now().toString(16).slice(-6).toUpperCase()}`;
    const expected = new Date(Date.now() + 3_600_000).toISOString();
    const v = await office.post('/api/visitors', { fullName: 'Card Test Visitor', purpose: 'Meeting', hostEmployeeId: host.id, expectedAt: expected, rfidTag: tag.toLowerCase() });
    expect(v.status).toBe(201);
    expect(v.body.data.rfidTag).toBe(tag);

    const busy = await office.post('/api/visitors', { fullName: 'Second Visitor', purpose: 'Meeting', hostEmployeeId: host.id, rfidTag: tag });
    expect(busy.status).toBe(409);

    const tapIn = await office.post('/api/visitors/rfid-tap', { tag: `${tag.slice(0, 4)} ${tag.slice(4)}` });
    expect(tapIn.body.data).toMatchObject({ action: 'in' });
    const tapOut = await office.post('/api/visitors/rfid-tap', { tag });
    expect(tapOut.body.data).toMatchObject({ action: 'out' });
    expect((await office.post('/api/visitors/rfid-tap', { tag })).status).toBe(404);

    const reuse = await office.post('/api/visitors', { fullName: 'Next Visitor', purpose: 'Meeting', hostEmployeeId: host.id, rfidTag: tag });
    expect(reuse.status).toBe(201);
    await query(`DELETE FROM visitors WHERE rfid_tag = $1`, [tag]);
  });
});

describe('WhatsApp sending', () => {
  it('normalises Indian numbers', () => {
    expect(whatsappNumber('+91 98400 12345')).toBe('919840012345');
    expect(whatsappNumber('09840012345')).toBe('919840012345');
    expect(whatsappNumber('9840012345')).toBe('919840012345');
    expect(whatsappNumber('12345')).toBeNull();
  });

  it('posts the gateway payload with the bearer token', async () => {
    const saved = { url: env.WHATSAPP_API_URL, token: env.WHATSAPP_API_TOKEN };
    Object.assign(env, { WHATSAPP_API_URL: 'https://wa.example.test/send', WHATSAPP_API_TOKEN: 'secret-token' });
    let seen: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ messageId: 'wamid-1' }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const id = await sendWhatsApp({ to: '919840012345', title: 'Absent today', body: 'Aarav was marked absent.', reference: 'd1' }, fake);
      expect(id).toBe('wamid-1');
      expect(seen!.url).toBe('https://wa.example.test/send');
      expect((seen!.init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token');
      expect(JSON.parse(String(seen!.init.body))).toMatchObject({ to: '919840012345', message: '*Absent today*\nAarav was marked absent.' });
      const failing = (async () => new Response('bad number', { status: 400 })) as unknown as typeof fetch;
      await expect(sendWhatsApp({ to: '91', title: 'x', body: null, reference: 'd2' }, failing)).rejects.toThrow(/400/);
    } finally {
      Object.assign(env, { WHATSAPP_API_URL: saved.url, WHATSAPP_API_TOKEN: saved.token });
    }
  });
});
