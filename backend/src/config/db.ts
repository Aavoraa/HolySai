import pg from 'pg';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

// Return DATE columns as 'YYYY-MM-DD' strings (no timezone shifting) and
// NUMERIC as JS numbers (all money/scores here are well within double precision).
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)));

/**
 * Managed Postgres (Supabase, Neon, RDS) terminates TLS with its own CA. Set
 * DATABASE_SSL=true and DATABASE_CA_CERT to verify the chain properly, or
 * DATABASE_SSL=no-verify to encrypt without verification.
 */
function sslConfig(): pg.PoolConfig['ssl'] {
  if (env.DATABASE_SSL === 'off') return undefined;
  if (env.DATABASE_SSL === 'no-verify') return { rejectUnauthorized: false };
  return env.DATABASE_CA_CERT ? { rejectUnauthorized: true, ca: env.DATABASE_CA_CERT } : { rejectUnauthorized: true };
}

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  ssl: sslConfig(),
  idleTimeoutMillis: 30_000,
  // Managed poolers drop idle connections; fail fast instead of hanging.
  connectionTimeoutMillis: 15_000,
});

// An idle client can be dropped by the server or a pooler (e.g. Supabase
// recycling connections). pg emits that on the pool; without a listener Node
// treats it as unhandled and the whole API exits. The pool discards the dead
// client and opens a fresh one on the next query, so logging is enough.
pool.on('error', (err) => {
  logger.warn({ err: err.message }, 'Idle database connection closed; it will be replaced on next use');
});

export type Queryable = pg.Pool | pg.PoolClient;

/** Parameterised query helper. Never interpolate user input into `text`. */
export async function query<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Queryable = pool) {
  return db.query<T>(text, params as any[]);
}

export async function one<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Queryable = pool): Promise<T | null> {
  const r = await db.query<T>(text, params as any[]);
  return r.rows[0] ?? null;
}

export async function many<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Queryable = pool): Promise<T[]> {
  const r = await db.query<T>(text, params as any[]);
  return r.rows;
}

/** Runs `fn` inside a transaction; rolls back on any thrown error. */
export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
