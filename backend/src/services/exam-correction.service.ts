/**
 * Paper Correction — the bridge to EXAM Vision (exam-vision/), the internal service in
 * which Claude reads handwritten answer sheets and suggests marks against teacher rubrics.
 *
 * Holy Sai stays the system of record for people: it signs the user in, decides their
 * role in the service, and pushes the student roster and marking staff to it. Each
 * forwarded request carries the caller's identity signed with EXAM_VISION_SECRET
 * (HMAC-SHA256), so the service never sees a Holy Sai token and runs no logins of its own.
 * Approved marks come back into the Assessments register through saveMarks, with its
 * roster, maximum-mark and moderation-lock rules.
 */
import { createHash, createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import { many } from '../config/db.js';
import { AppError, badRequest, conflict, forbidden } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { audit } from './audit.service.js';
import { getAssessment, saveMarks } from './academics-assessments.service.js';
import type { AuthUser } from '../types.js';

export type ExamRole = 'admin' | 'coordinator' | 'teacher';

/** Long enough for Claude to draft every rubric of an exam in one request. */
const UPSTREAM_TIMEOUT_MS = 10 * 60_000;
const SYNC_EVERY_MS = 5 * 60_000;

export const configured = () => !!env.EXAM_VISION_URL && !!env.EXAM_VISION_SECRET;

const notConnected = () =>
  new AppError(503, 'EXAM_VISION_NOT_CONFIGURED', 'Paper Correction is not connected. Set EXAM_VISION_URL and EXAM_VISION_SECRET.');
const unreachable = () =>
  new AppError(502, 'EXAM_VISION_UNREACHABLE', 'The Paper Correction service is not responding. Start it and try again.');

/**
 * The caller's role in the service: settings managers configure Claude (admin), other
 * school-wide markers create exams and assign teachers (coordinator), teachers mark the
 * exams they are assigned to.
 */
export function examRole(user: AuthUser): ExamRole | null {
  if (!user.permissions.has('assessments.manage')) return null;
  if (user.permissions.has('settings.manage')) return 'admin';
  return user.scope === 'school' ? 'coordinator' : 'teacher';
}

const sign = (...parts: string[]) => createHmac('sha256', env.EXAM_VISION_SECRET!).update(parts.join('\n')).digest('hex');
const now = () => String(Math.floor(Date.now() / 1000));

function identityHeaders(user: AuthUser): Record<string, string> {
  const role = examRole(user);
  if (!role) throw forbidden();
  const name = Buffer.from(user.fullName, 'utf8').toString('base64url');
  const ts = now();
  return { 'x-hs-user': user.id, 'x-hs-role': role, 'x-hs-name': name, 'x-hs-ts': ts, 'x-hs-sig': sign(user.id, role, name, ts) };
}

function upstream(path: string) {
  return `${env.EXAM_VISION_URL!.replace(/\/$/, '')}/api/${path}`;
}

/** How long a repeatable request keeps retrying while the service wakes from sleep (free hosting). */
const WAKE_RETRY_MS = 90_000;
const WAKE_STATUSES = new Set([502, 503, 504]);

/**
 * One request to the service. With `retry` (only for requests that are safe to repeat),
 * a gateway error or a refused connection — what a host shows while the service is
 * waking or restarting — is retried every 5 s for up to WAKE_RETRY_MS.
 */
async function call(url: string, init: RequestInit & { duplex?: 'half' }, retry = false): Promise<globalThis.Response> {
  const until = Date.now() + WAKE_RETRY_MS;
  for (;;) {
    let res: globalThis.Response | null = null;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
      if (!retry || !WAKE_STATUSES.has(res.status) || Date.now() > until) return res;
    } catch (err) {
      if (!retry || Date.now() > until) {
        logger.warn({ err: (err as Error).message, url }, 'Paper Correction service unreachable');
        throw unreachable();
      }
    }
    await res?.body?.cancel().catch(() => undefined);
    await new Promise((ok) => setTimeout(ok, 5_000));
  }
}

/** The service's error detail as one sentence (FastAPI: string, or a list of validation errors). */
function detailOf(body: unknown, status: number): string {
  const d = (body as { detail?: unknown } | null)?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x) => (x as { msg?: string }).msg ?? '').filter(Boolean).join('; ') || 'Invalid request';
  return `Paper Correction request failed (${status})`;
}

/** Calls the service as `user` and returns its JSON, throwing its error as an AppError. */
async function getJson<T>(user: AuthUser, path: string): Promise<T> {
  if (!configured()) throw notConnected();
  const res = await call(upstream(path), { headers: identityHeaders(user) }, true);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new AppError(res.status === 401 ? 502 : res.status, `EXAM_VISION_${res.status}`, detailOf(body, res.status));
  return body as T;
}

// ---------------------------------------------------------------------------
// Proxy
// ---------------------------------------------------------------------------

/**
 * Which service endpoints the web app may reach. Sign-in, account and roster writes are
 * Holy Sai's own and are not exposed; the integration endpoint is server-to-server only.
 */
const ALLOWED: { re: RegExp; methods?: string[] }[] = [
  { re: /^(exams|questions|submissions|pages|answers|jobs)(\/|$)/ },
  { re: /^settings\/ai(\/|$)/ },
  { re: /^(users|students|audit|auth\/me)$/, methods: ['GET'] },
];

export async function forward(req: Request, res: Response, path: string) {
  if (!configured()) throw notConnected();
  if (!ALLOWED.some((a) => a.re.test(path) && (!a.methods || a.methods.includes(req.method)))) {
    throw new AppError(404, 'NOT_FOUND', 'Not found');
  }
  await ensureSynced();

  const headers: Record<string, string> = identityHeaders(req.user!);
  let body: BodyInit | undefined;
  let duplex: 'half' | undefined;
  const type = req.get('content-type') ?? '';
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (type.startsWith('multipart/form-data')) {
      // Answer-sheet uploads stream straight through; the service checks size, type and pages.
      headers['content-type'] = type;
      if (req.get('content-length')) headers['content-length'] = req.get('content-length')!;
      body = Readable.toWeb(req) as unknown as BodyInit;
      duplex = 'half';
    } else {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(req.body ?? {});
    }
  }
  const query = new URLSearchParams(req.query as Record<string, string>).toString();
  const up = await call(upstream(path) + (query ? `?${query}` : ''), { method: req.method, headers, body, duplex }, req.method === 'GET');

  const upType = up.headers.get('content-type') ?? '';
  if (upType.includes('application/json')) {
    const data = await up.json().catch(() => null);
    if (up.ok) return res.status(up.status).json({ success: true, data, message: 'OK' });
    // A 401 from the service means the gateway signature was refused (secret mismatch or
    // clock skew), not that the user's Holy Sai session ended — never sign them out for it.
    const status = up.status === 401 ? 502 : up.status;
    if (up.status === 401) logger.error('Paper Correction refused the gateway signature — check EXAM_VISION_SECRET and EXAM_GATEWAY_SECRET match');
    return res.status(status).json({ success: false, message: detailOf(data, up.status), error: `EXAM_VISION_${up.status}` });
  }
  // Page images and CSV reports
  res.status(up.status);
  for (const h of ['content-type', 'content-disposition']) {
    const v = up.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  res.setHeader('cache-control', 'no-store');
  res.end(Buffer.from(await up.arrayBuffer()));
}

// ---------------------------------------------------------------------------
// Roster sync
// ---------------------------------------------------------------------------

interface RosterStudent { admission_no: string; name: string; class_name: string; section: string; roll_no: string }
interface RosterStaff { id: string; name: string; role: ExamRole }

/**
 * The class label used in Paper Correction: the class name plus the campus code, because
 * every campus has its own "Grade 5". The web app builds the same label when it creates an exam.
 */
export const classLabel = (className: string, campusCode: string) => `${className} · ${campusCode.toUpperCase()}`;

async function roster(): Promise<{ students: RosterStudent[]; staff: RosterStaff[] }> {
  const students = await many<RosterStudent>(
    `SELECT s.admission_no, s.full_name AS name, c.name || ' · ' || upper(cp.code) AS class_name,
            sec.name AS section, COALESCE(en.roll_no::text, '') AS roll_no
       FROM students s
       JOIN sections sec ON sec.id = s.section_id
       JOIN classes c ON c.id = sec.class_id
       JOIN campuses cp ON cp.id = c.campus_id
       LEFT JOIN enrollments en ON en.student_id = s.id AND en.academic_year_id = sec.academic_year_id
      WHERE s.deleted_at IS NULL AND s.status = 'active'
      ORDER BY s.admission_no`,
  );
  const staff = await many<{ id: string; name: string; scope: string; admin: boolean }>(
    `SELECT u.id, u.full_name AS name, r.scope, bool_or(p.key = 'settings.manage') AS admin
       FROM users u
       JOIN roles r ON r.id = u.role_id
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id AND p.key IN ('assessments.manage', 'settings.manage')
      WHERE u.deleted_at IS NULL AND u.status = 'active'
      GROUP BY u.id, u.full_name, r.scope
     HAVING bool_or(p.key = 'assessments.manage')`,
  );
  return {
    students,
    staff: staff.map((s) => ({ id: s.id, name: s.name, role: s.admin ? 'admin' : s.scope === 'school' ? 'coordinator' : 'teacher' })),
  };
}

let lastSync: { at: Date; result: Record<string, number> } | null = null;
let syncing: Promise<Record<string, number>> | null = null;

/** Pushes the active student roster and marking staff to the service. */
export async function syncRoster(): Promise<Record<string, number>> {
  if (!configured()) throw notConnected();
  if (!syncing) {
    syncing = (async () => {
      const body = JSON.stringify(await roster());
      const ts = now();
      const res = await call(upstream('integration/sync'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hs-ts': ts, 'x-hs-sig': sign('sync', ts, createHash('sha256').update(body).digest('hex')) },
        body,
      }, true); // the roster upsert is safe to repeat
      const out = await res.json().catch(() => null);
      if (!res.ok) {
        logger.error({ status: res.status, detail: out?.detail }, 'Paper Correction roster sync failed');
        throw new AppError(502, 'EXAM_VISION_SYNC_FAILED', `Roster sync failed: ${detailOf(out, res.status)}`);
      }
      lastSync = { at: new Date(), result: out };
      return out as Record<string, number>;
    })().finally(() => { syncing = null; });
  }
  return syncing;
}

/** Keeps the service's roster fresh: synchronously the first time, then in the background. */
async function ensureSynced() {
  if (!lastSync) {
    await syncRoster();
    return;
  }
  if (Date.now() - lastSync.at.getTime() > SYNC_EVERY_MS) {
    syncRoster().catch(() => undefined); // logged in syncRoster; the cached roster is still usable
  }
}

/** The service's process start time; a change means it restarted (and may have lost its data). */
async function startedAt(): Promise<number | null> {
  const res = await call(upstream('health'), {}, true);
  const body = await res.json().catch(() => null);
  return typeof body?.started === 'number' ? body.started : null;
}

/** Free hosting puts the service to sleep when idle; waking it takes up to a minute. */
const STATUS_WAIT_MS = 20_000;

export async function status(user: AuthUser) {
  const role = examRole(user);
  if (!configured()) return { connected: false, reason: 'Not configured on the server (EXAM_VISION_URL / EXAM_VISION_SECRET).', role, lastSync: null };
  const check = (async () => {
    const started = await startedAt();
    // A restarted service on a host without a persistent disk starts empty: send the roster again now.
    if (!lastSync || (started !== null && lastSync.result.started !== started)) await syncRoster();
    else await ensureSynced();
    const ai = await getJson<Record<string, unknown>>(user, 'settings/ai/status');
    return { connected: true, reason: null, role, ai, lastSync: lastSync && { at: lastSync.at.toISOString(), ...lastSync.result } };
  })();
  check.catch(() => undefined); // may finish after the timeout below
  const waking = new Promise<null>((ok) => setTimeout(() => ok(null), STATUS_WAIT_MS).unref());
  try {
    const out = await Promise.race([check, waking]);
    return out ?? { connected: false, waking: true, reason: 'The Paper Correction service is starting up. Try again in a minute.', role, lastSync: null };
  } catch (err) {
    return { connected: false, reason: (err as Error).message, role, lastSync: null };
  }
}

// ---------------------------------------------------------------------------
// Approved marks → Assessments register
// ---------------------------------------------------------------------------

interface ExamReport {
  exam: { id: string; name: string; subject: string; class_name: string; section: string; results_status: string; maximum: number };
  students: { admission_no: string; name: string; total: number; maximum: number; approved: boolean }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Writes each approved answer-sheet total into an assessment's marks, scaled to the
 * assessment's maximum when the two differ. Students are matched by admission number;
 * anyone not on the assessment roster (or not fully approved) is reported, not written.
 */
export async function pushMarks(req: Request, examId: string, assessmentId: string) {
  const user = req.user!;
  const report = await getJson<ExamReport>(user, `exams/${encodeURIComponent(examId)}/report`);
  if (!['approved', 'published'].includes(report.exam.results_status)) {
    throw conflict('Approve the results in Paper Correction before sending them to the marks register', 'RESULTS_NOT_APPROVED');
  }
  const assessment = await getAssessment(user, assessmentId); // scope: 404 outside the caller's sections
  if (assessment.locked) throw conflict(assessment.lockReason ?? 'Marks are locked', 'ASSESSMENT_LOCKED');
  const max = Number(assessment.maxMarks);
  const byNo = new Map(assessment.students.map((s: { id: string; admissionNo: string }) => [s.admissionNo, s.id]));

  const marks: { studentId: string; marks: number; isAbsent: boolean; remarks: string }[] = [];
  const skipped: { admissionNo: string; name: string; reason: string }[] = [];
  for (const s of report.students) {
    const studentId = byNo.get(s.admission_no);
    if (!studentId) skipped.push({ admissionNo: s.admission_no, name: s.name, reason: 'Not on this assessment\'s roster' });
    else if (!s.approved) skipped.push({ admissionNo: s.admission_no, name: s.name, reason: 'Marks not fully approved' });
    else if (!s.maximum) skipped.push({ admissionNo: s.admission_no, name: s.name, reason: 'Exam has no marks' });
    else {
      const scaled = s.maximum === max ? s.total : round2((s.total * max) / s.maximum);
      marks.push({
        studentId, marks: Math.min(scaled, max), isAbsent: false,
        remarks: s.maximum === max ? 'Paper Correction' : `Paper Correction: ${round2(s.total)} / ${s.maximum}`,
      });
    }
  }
  if (!marks.length) throw badRequest('No approved answer sheet matches a student on this assessment', 'NOTHING_TO_SEND', skipped.map((s, i) => ({ field: `students.${i}`, message: `${s.name}: ${s.reason}` })));

  const saved = await saveMarks(req, assessmentId, { marks, action: 'save' });
  await audit(req, {
    action: 'update', module: 'assessments',
    description: `Sent ${marks.length} approved Paper Correction mark(s) from "${report.exam.name}" to ${assessment.code} — ${assessment.name}`,
    entityType: 'assessment', entityId: assessmentId,
    metadata: { examId, sent: marks.length, skipped: skipped.length, scaled: report.exam.maximum !== max },
  });
  return { ...saved, sent: marks.length, skipped, scaledFrom: report.exam.maximum !== max ? report.exam.maximum : null, scaledTo: max };
}
