import type { NextFunction, Request, Response } from 'express';
import type { Permission, RoleScope } from '../config/rbac.js';
import { one, many } from '../config/db.js';
import { verifyAccessToken } from '../services/token.service.js';
import { forbidden, unauthorized } from '../utils/errors.js';
import type { AuthUser } from '../types.js';

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  title: string | null;
  status: string;
  campus_id: string | null;
  role_id: string;
  role_key: string;
  role_name: string;
  scope: RoleScope;
  home_route: string;
  employee_id: string | null;
  parent_id: string | null;
  student_id: string | null;
  password_changed_at: Date;
}

// Role permissions change rarely; cache briefly to avoid a join on every request.
const permCache = new Map<string, { at: number; perms: Set<Permission> }>();
const PERM_TTL_MS = 30_000;

export async function permissionsForRole(roleId: string): Promise<Set<Permission>> {
  const hit = permCache.get(roleId);
  if (hit && Date.now() - hit.at < PERM_TTL_MS) return hit.perms;
  const rows = await many<{ key: Permission }>(
    `SELECT p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1`,
    [roleId],
  );
  const perms = new Set(rows.map((r) => r.key));
  permCache.set(roleId, { at: Date.now(), perms });
  return perms;
}

export function clearPermissionCache() {
  permCache.clear();
}

/** `issuedAt` (JWT iat, seconds): an access token issued before the last password change is refused. */
export async function loadAuthUser(userId: string, clientType: AuthUser['clientType'] = 'web', issuedAt?: number): Promise<AuthUser | null> {
  const u = await one<UserRow>(
    `SELECT u.id, u.email, u.full_name, u.title, u.status, u.campus_id, u.password_changed_at,
            r.id AS role_id, r.key AS role_key, r.name AS role_name, r.scope, r.home_route,
            e.id AS employee_id, p.id AS parent_id, s.id AS student_id
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN employees e ON e.user_id = u.id AND e.deleted_at IS NULL
       LEFT JOIN parents p ON p.user_id = u.id AND p.deleted_at IS NULL
       LEFT JOIN students s ON s.user_id = u.id AND s.deleted_at IS NULL
      WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [userId],
  );
  if (!u || u.status !== 'active') return null;
  if (issuedAt != null && issuedAt < Math.floor(new Date(u.password_changed_at).getTime() / 1000)) {
    throw unauthorized('Your password was changed; please sign in again', 'TOKEN_REVOKED');
  }
  return {
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    title: u.title,
    roleKey: u.role_key,
    roleName: u.role_name,
    scope: u.scope,
    homeRoute: u.home_route,
    campusId: u.campus_id,
    permissions: await permissionsForRole(u.role_id),
    employeeId: u.employee_id,
    parentId: u.parent_id,
    studentId: u.student_id,
    clientType,
  };
}

/** Requires a valid Bearer access token. Web and mobile clients use the same header. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.get('authorization') || '';
  const [kind, token] = header.split(' ');
  if (kind !== 'Bearer' || !token) return next(unauthorized());
  const claims = verifyAccessToken(token);
  const user = await loadAuthUser(claims.sub, claims.ct, claims.iat);
  if (!user) return next(unauthorized('Account is not active', 'ACCOUNT_INACTIVE'));
  req.user = user;
  next();
}

/** Allows the request when the user holds ALL listed permissions. */
export function requirePermission(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const u = req.user;
    if (!u) return next(unauthorized());
    const missing = perms.filter((p) => !u.permissions.has(p));
    if (missing.length) return next(forbidden(`Missing permission: ${missing.join(', ')}`));
    next();
  };
}

/** Allows the request when the user holds ANY of the listed permissions. */
export function requireAny(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const u = req.user;
    if (!u) return next(unauthorized());
    if (!perms.some((p) => u.permissions.has(p))) return next(forbidden());
    next();
  };
}

export function has(req: Request, perm: Permission) {
  return !!req.user?.permissions.has(perm);
}
