import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { one, query, tx } from '../config/db.js';
import { unauthorized } from '../utils/errors.js';

export type ClientType = 'web' | 'mobile' | 'integration';

export interface AccessClaims {
  sub: string;
  role: string;
  typ: 'access';
  ct: ClientType;
  iat?: number;
}

export function signAccessToken(userId: string, roleKey: string, clientType: ClientType) {
  return jwt.sign({ role: roleKey, typ: 'access', ct: clientType }, env.JWT_SECRET, {
    subject: userId,
    expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions['expiresIn'],
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  try {
    const claims = jwt.verify(token, env.JWT_SECRET, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithms: ['HS256'],
    }) as jwt.JwtPayload;
    if (claims.typ !== 'access' || !claims.sub) throw new Error('wrong token type');
    return claims as unknown as AccessClaims;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw unauthorized('Access token expired', 'TOKEN_EXPIRED');
    throw unauthorized('Invalid access token', 'TOKEN_INVALID');
  }
}

/** Refresh tokens are opaque random strings; only an HMAC of the value is stored. */
function hashRefresh(token: string) {
  return crypto.createHmac('sha256', env.JWT_REFRESH_SECRET).update(token).digest('hex');
}

function newRefreshValue() {
  return {
    token: crypto.randomBytes(48).toString('base64url'),
    expiresAt: new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * 86_400_000),
  };
}

export async function issueRefreshToken(opts: { userId: string; clientType: ClientType; userAgent?: string | null; ip?: string | null }) {
  const { token, expiresAt } = newRefreshValue();
  const familyId = crypto.randomUUID();
  await query(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, client_type, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [opts.userId, familyId, hashRefresh(token), expiresAt, opts.clientType, opts.userAgent ?? null, opts.ip ?? null],
  );
  return { token, expiresAt, familyId };
}

/**
 * Rotates a refresh token. Presenting a token that was already rotated is
 * treated as theft: the whole token family is revoked.
 */
export async function rotateRefreshToken(token: string, ctx: { userAgent?: string | null; ip?: string | null }) {
  const result = await tx(async (db) => {
    const found = await one<{ id: string; user_id: string; family_id: string; expires_at: Date; revoked_at: Date | null; client_type: ClientType }>(
      `SELECT id, user_id, family_id, expires_at, revoked_at, client_type
         FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [hashRefresh(token)],
      db,
    );
    if (!found) return { error: unauthorized('Invalid refresh token', 'REFRESH_INVALID') };
    if (found.revoked_at) {
      await query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [found.family_id], db);
      return { error: unauthorized('Session was already refreshed elsewhere; please sign in again', 'REFRESH_REUSED') };
    }
    if (new Date(found.expires_at) < new Date()) return { error: unauthorized('Session expired; please sign in again', 'REFRESH_EXPIRED') };

    const next = newRefreshValue();
    const inserted = await one<{ id: string }>(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, client_type, user_agent, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [found.user_id, found.family_id, hashRefresh(next.token), next.expiresAt, found.client_type, ctx.userAgent ?? null, ctx.ip ?? null],
      db,
    );
    await query('UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2, last_used_at = now() WHERE id = $1', [found.id, inserted!.id], db);
    return { userId: found.user_id, clientType: found.client_type, familyId: found.family_id, ...next };
  });
  // Family revocation must commit, so errors are thrown after the transaction.
  if ('error' in result) throw result.error;
  return result;
}

export async function revokeRefreshToken(token: string) {
  const r = await one<{ family_id: string; user_id: string }>(
    'SELECT family_id, user_id FROM refresh_tokens WHERE token_hash = $1',
    [hashRefresh(token)],
  );
  if (r) await query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [r.family_id]);
  return r;
}

export async function revokeAllForUser(userId: string, exceptFamily?: string) {
  await query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR family_id <> $2)',
    [userId, exceptFamily ?? null],
  );
}

export async function listSessions(userId: string) {
  return (await query(
    `SELECT family_id, client_type, user_agent, host(ip_address) AS ip, min(created_at) AS started_at, max(created_at) AS last_active_at
       FROM refresh_tokens
      WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
      GROUP BY family_id, client_type, user_agent, ip_address
      ORDER BY last_active_at DESC`,
    [userId],
  )).rows;
}
