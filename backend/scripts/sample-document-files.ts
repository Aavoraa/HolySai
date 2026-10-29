/**
 * Attaches a SAMPLE PDF to every received student document (Verified, Submitted or
 * Rejected) that has no file yet, so "View" and "Download" work in development —
 * in an existing database, without changing anything else.
 *   npm run db:sample-files
 */
import { pool } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { attachStudentDocumentFiles } from '../../database/seed/sample-files.js';

if (env.isProd) {
  console.error('Refusing to add SAMPLE files to a production database.');
  process.exit(1);
}

const client = await pool.connect();
try {
  await client.query('BEGIN');
  const n = await attachStudentDocumentFiles(client);
  await client.query(
    `INSERT INTO audit_logs (user_id, user_name, role_key, action, module, description, device, metadata, created_at)
     VALUES (NULL, 'System', 'system', 'seed', 'system', $1, 'service', $2, now())`,
    [`Attached SAMPLE files to ${n} student document(s)`, JSON.stringify({ attached: n })],
  );
  await client.query('COMMIT');
  console.log(`Done. Attached a SAMPLE PDF to ${n} student document(s).`);
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
  await pool.end();
}
