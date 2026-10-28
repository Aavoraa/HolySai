import type { CookieOptions, Request, Response } from 'express';
import { env } from '../config/env.js';
import * as auth from '../services/auth.service.js';
import { revokeRefreshToken, listSessions, revokeAllForUser, type ClientType } from '../services/token.service.js';
import { audit, clientIp, deviceFrom } from '../services/audit.service.js';
import { v } from '../middleware/validate.js';
import { ok } from '../utils/response.js';
import { unauthorized } from '../utils/errors.js';
import { query } from '../config/db.js';

const COOKIE = 'hs_refresh';

function cookieOptions(expires?: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict',
    path: '/api/auth',
    domain: env.COOKIE_DOMAIN || undefined,
    expires,
  };
}

/**
 * Web clients receive the refresh token as an httpOnly cookie (not readable
 * by scripts). Mobile/integration clients receive it in the body and keep it
 * in secure device storage. Both get the same short-lived access token.
 */
function respondWithTokens(req: Request, res: Response, clientType: ClientType, result: Awaited<ReturnType<typeof auth.login>>, message: string) {
  const body: Record<string, unknown> = {
    accessToken: result.accessToken,
    tokenType: 'Bearer',
    expiresIn: env.JWT_ACCESS_TTL,
    user: auth.publicUser(result.user),
  };
  if (clientType === 'web') {
    res.cookie(COOKIE, result.refresh.token, cookieOptions(result.refresh.expiresAt));
  } else {
    body.refreshToken = result.refresh.token;
    body.refreshExpiresAt = result.refresh.expiresAt;
  }
  return ok(res, body, message);
}

export async function login(req: Request, res: Response) {
  const { identifier, password, clientType: bodyType } = v(req);
  const clientType: ClientType = bodyType ?? deviceFrom(req);
  try {
    const result = await auth.login(identifier, password, { clientType, userAgent: req.get('user-agent'), ip: clientIp(req) });
    req.user = result.user;
    await audit(req, { action: 'login', module: 'auth', description: `${result.user.fullName} signed in`, entityType: 'user', entityId: result.user.id });
    return respondWithTokens(req, res, clientType, result, 'Signed in successfully');
  } catch (err) {
    await audit(req, { action: 'login_failed', module: 'auth', description: 'Failed sign-in attempt', metadata: { identifier: String(identifier).slice(0, 60) } }, undefined, { id: null, name: 'Anonymous', role: 'anonymous' });
    throw err;
  }
}

export async function refresh(req: Request, res: Response) {
  const token: string | undefined = v(req).refreshToken ?? req.cookies?.[COOKIE];
  if (!token) throw unauthorized('No session to refresh', 'REFRESH_MISSING');
  try {
    const result = await auth.refresh(token, { userAgent: req.get('user-agent'), ip: clientIp(req) });
    return respondWithTokens(req, res, result.refresh.clientType, result as any, 'Session refreshed');
  } catch (err) {
    res.clearCookie(COOKIE, cookieOptions());
    throw err;
  }
}

export async function logout(req: Request, res: Response) {
  // Not validated by a schema (logout always succeeds), so ignore anything that is not a string.
  const token = [req.body?.refreshToken, req.cookies?.[COOKIE]].find((t): t is string => typeof t === 'string' && t.length > 0);
  if (token) {
    const r = await revokeRefreshToken(token);
    if (r) await audit(req, { action: 'logout', module: 'auth', description: 'Signed out', entityType: 'user', entityId: r.user_id }, undefined, { id: r.user_id, name: 'User', role: 'user' });
  }
  res.clearCookie(COOKIE, cookieOptions());
  return ok(res, null, 'Signed out');
}

export async function me(req: Request, res: Response) {
  const u = req.user!;
  const extra = await query(
    `SELECT c.code AS campus_code, c.name AS campus_name,
            (SELECT label FROM academic_years WHERE is_current) AS academic_year
       FROM users u LEFT JOIN campuses c ON c.id = u.campus_id WHERE u.id = $1`,
    [u.id],
  );
  return ok(res, { ...auth.publicUser(u), ...extra.rows[0] }, 'Current user');
}

export async function changePassword(req: Request, res: Response) {
  const { currentPassword, newPassword } = v(req);
  await auth.changePassword(req.user!.id, currentPassword, newPassword);
  await audit(req, { action: 'update', module: 'auth', description: 'Changed password; other sessions signed out', entityType: 'user', entityId: req.user!.id });
  res.clearCookie(COOKIE, cookieOptions());
  return ok(res, null, 'Password changed. Please sign in again.');
}

export async function sessions(req: Request, res: Response) {
  return ok(res, await listSessions(req.user!.id), 'Active sessions');
}

export async function signOutEverywhere(req: Request, res: Response) {
  await revokeAllForUser(req.user!.id);
  await audit(req, { action: 'logout', module: 'auth', description: 'Signed out of all sessions', entityType: 'user', entityId: req.user!.id });
  res.clearCookie(COOKIE, cookieOptions());
  return ok(res, null, 'Signed out of all devices');
}
