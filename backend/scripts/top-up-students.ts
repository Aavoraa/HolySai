/**
 * Adds SAMPLE students to every section that has fewer than 5 (or the number given),
 * then fills every student's Student 360 profile (skills/skill web, activities,
 * achievements, behaviour, observations, timeline…) where it is missing — in an
 * existing database, without deleting or changing anything already there.
 *   npm run db:top-up            (at least 5 per section)
 *   npm run db:top-up -- 8       (at least 8 per section)
 */
import { pool } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { createContext } from '../../database/seed/index.js';
import { fillStudentProfiles, topUpSections } from '../../database/seed/core-students.js';

if (env.isProd) {
  console.error('Refusing to add SAMPLE students to a production database.');
  process.exit(1);
}
const min = Number(process.argv[2] ?? 5);
if (!Number.isInteger(min) || min < 1 || min > 40) {
  console.error('Give the minimum per section as a whole number between 1 and 40.');
  process.exit(1);
}

const client = await pool.connect();
try {
  await client.query('BEGIN');
  const ctx = createContext();
  const out = await topUpSections(client, ctx, min);
  const filled = await fillStudentProfiles(client, ctx);
  await client.query(
    `INSERT INTO audit_logs (user_id, user_name, role_key, action, module, description, device, metadata, created_at)
     VALUES (NULL, 'System', 'system', 'seed', 'system', $1, 'service', $2, now())`,
    [`Added ${out.added} SAMPLE student(s) so every section has at least ${min}; filled missing Student 360 records`, JSON.stringify({ ...out, filled })],
  );
  await client.query('COMMIT');
  console.log(`Done. Added ${out.added} sample student(s); every one of ${out.sections} sections now has at least ${min}.`);
  console.log(`Student 360 filled for ${filled.students} students: ${filled.skills} skills, ${filled.activities} activities, ` +
    `${filled.achievements} achievements, ${filled.behaviour} behaviour notes, ${filled.observations} observations, ${filled.timeline} timeline entries.`);
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
  await pool.end();
}
