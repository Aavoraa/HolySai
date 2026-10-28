import bcrypt from 'bcryptjs';
import { one, query } from '../config/db.js';
import { unauthorized, badRequest } from '../utils/errors.js';
import { loadAuthUser } from '../middleware/auth.js';
import { issueRefreshToken, rotateRefreshToken, signAccessToken, revokeAllForUser, type ClientType } from './token.service.js';
import type { AuthUser } from '../types.js';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
// Compared against when the account does not exist, so response time does not reveal it.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-placeholder', 10);

export function publicUser(u: AuthUser) {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    title: u.title,
    role: { key: u.roleKey, name: u.roleName, scope: u.scope, homeRoute: u.homeRoute },
    campusId: u.campusId,
    permissions: [...u.permissions].sort(),
    employeeId: u.employeeId,
    parentId: u.parentId,
    studentId: u.studentId,
  };
}

export async function login(identifier: string, password: string, ctx: { clientType: ClientType; userAgent?: string | null; ip?: string | null }) {
  const row = await one<{ id: string; password_hash: string; status: string; failed_login_count: number; locked_until: Date | null }>(
    `SELECT id, password_hash, status, failed_login_count, locked_until
       FROM users WHERE (email = $1 OR phone = $1) AND deleted_at IS NULL`,
    [identifier.toLowerCase().includes('@') ? identifier.toLowerCase() : identifier],
  );

  if (!row) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw unauthorized('Incorrect email/mobile or password', 'INVALID_CREDENTIALS');
  }
  if (row.locked_until && new Date(row.locked_until) > new Date()) {
    throw unauthorized('Too many failed attempts. Try again in a few minutes.', 'ACCOUNT_LOCKED');
  }
  const valid = await bcrypt.compare(password, row.password_hash);
  if (!valid) {
    // Counted in SQL, not from the value read above: concurrent guesses must not
    // overwrite each other's count, nor clear a lock another attempt just set.
    await query(
      `UPDATE users SET failed_login_count = CASE WHEN locked_until > now() THEN failed_login_count
                                                 WHEN failed_login_count + 1 >= $2 THEN 0 ELSE failed_login_count + 1 END,
              locked_until = CASE WHEN locked_until > now() THEN locked_until
                                  WHEN failed_login_count + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE NULL END
        WHERE id = $1`,
      [row.id, MAX_FAILED, LOCK_MINUTES],
    );
    throw unauthorized('Incorrect email/mobile or password', 'INVALID_CREDENTIALS');
  }
  if (row.status !== 'active') throw unauthorized('This account is not active. Contact the school office.', 'ACCOUNT_INACTIVE');

  await query('UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [row.id]);
  const user = await loadAuthUser(row.id, ctx.clientType);
  if (!user) throw unauthorized('Account is not active', 'ACCOUNT_INACTIVE');

  const accessToken = signAccessToken(user.id, user.roleKey, ctx.clientType);
  const refresh = await issueRefreshToken({ userId: user.id, clientType: ctx.clientType, userAgent: ctx.userAgent, ip: ctx.ip });
  return { user, accessToken, refresh };
}

export async function refresh(token: string, ctx: { userAgent?: string | null; ip?: string | null }) {
  const rotated = await rotateRefreshToken(token, ctx);
  const user = await loadAuthUser(rotated.userId, rotated.clientType);
  if (!user) throw unauthorized('Account is not active', 'ACCOUNT_INACTIVE');
  const accessToken = signAccessToken(user.id, user.roleKey, rotated.clientType);
  return { user, accessToken, refresh: rotated };
}

export async function changePassword(userId: string, current: string, next: string) {
  const row = await one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!row || !(await bcrypt.compare(current, row.password_hash))) {
    throw badRequest('Current password is incorrect', 'INVALID_CURRENT_PASSWORD');
  }
  if (await bcrypt.compare(next, row.password_hash)) throw badRequest('Choose a password you have not used here before', 'PASSWORD_REUSED');
  const hash = await bcrypt.hash(next, 12);
  await query('UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1', [userId, hash]);
  // Sign out every other session after a password change.
  await revokeAllForUser(userId);
}

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}
