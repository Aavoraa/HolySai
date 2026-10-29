/**
 * Seeds the database with clearly-marked SAMPLE data for development and demos.
 * Run with `npm run db:seed` (or `npm run db:reset` to drop, migrate and seed).
 */
import type pg from 'pg';
import { addDays, kolkataTime, listSchoolDays, mulberry32, todayInKolkata, type SeedContext } from './context.js';
import { seedOrg } from './core-org.js';
import { fillStudentProfiles, seedStudents } from './core-students.js';
import { seedInbox } from './core-inbox.js';
import * as academics from './academics.js';
import * as admissions from './admissions.js';
import * as finance from './finance.js';
import * as workforce from './workforce.js';
import * as safety from './safety.js';
import * as parentsExperience from './parents-experience.js';
import * as operations from './operations.js';
import * as innovation from './innovation.js';
import * as group from './group.js';
import * as intelligence from './intelligence.js';
import * as planning from './planning.js';
import * as jobCards from './jobcards.js';
import * as parentLog from './parent-log.js';
import * as syllabus from './syllabus.js';
import { attachStudentDocumentFiles } from './sample-files.js';

const DOMAINS: [string, { seed: (db: pg.PoolClient, ctx: SeedContext) => Promise<void> }][] = [
  ['academics', academics],
  ['admissions', admissions],
  ['finance', finance],
  ['workforce', workforce],
  ['safety', safety],
  ['parents-experience', parentsExperience],
  ['operations', operations],
  ['innovation', innovation],
  ['group', group],
  ['intelligence', intelligence],
  ['budget planning', planning],
  ['job cards', jobCards],
  ['parent contact log', parentLog],
  ['Cambridge IGCSE syllabus', syllabus],
];

export function createContext(now = new Date()): SeedContext {
  const today = todayInKolkata(now);
  const rand = mulberry32(Number(today.replace(/-/g, '')) % 100000 + 2026);
  return {
    today,
    now,
    yearId: '',
    yearStart: '',
    campuses: {},
    roles: {},
    users: {},
    employees: {},
    employeeByName: {},
    classes: {},
    sections: {},
    subjects: {},
    routes: {},
    stops: {},
    students: [],
    studentByNo: {},
    parents: {},
    rand,
    pick: (arr) => arr[Math.floor(rand() * arr.length)],
    int: (min, max) => min + Math.floor(rand() * (max - min + 1)),
    day: (offset) => addDays(today, offset),
    at: (date, hhmm) => kolkataTime(date, hhmm),
    schoolDays: (from, to, sat) => listSchoolDays(from, to, sat),
  };
}

export async function seedAll(client: pg.PoolClient, demoPassword: string, log = console.log) {
  const ctx = createContext();
  const step = async (name: string, fn: () => Promise<void>) => {
    const t = Date.now();
    await fn();
    log(`  ✓ ${name} (${Date.now() - t} ms)`);
  };
  await client.query('BEGIN');
  try {
    await step('organisation, roles, users, staff, classes', () => seedOrg(client, ctx, demoPassword));
    await step('transport, families, students, attendance, Student 360, GPS tracking', () => seedStudents(client, ctx));
    for (const [name, mod] of DOMAINS) await step(name, () => mod.seed(client, ctx));
    // Admissions enrols students after the Student 360 seed; give everyone a full profile.
    await step('Student 360 profiles for every student', async () => { await fillStudentProfiles(client, ctx); });
    await step('sample files for student documents', async () => { await attachStudentDocumentFiles(client); });
    await step('notifications and tasks', () => seedInbox(client, ctx));
    await client.query(
      `INSERT INTO audit_logs (user_id, user_name, role_key, action, module, description, device, metadata, created_at)
       VALUES (NULL, 'System', 'system', 'seed', 'system', 'Database seeded with SAMPLE data for development', 'service', $1, now())`,
      [JSON.stringify({ today: ctx.today, students: ctx.students.length })],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
  return ctx;
}
