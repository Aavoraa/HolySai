import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { many, one, query } from '../config/db.js';
import { requireAny, requirePermission, clearPermissionCache } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import { likeTerm, limitOffset, paginationSchema } from '../utils/pagination.js';
import { Where } from '../utils/sql.js';
import { created, ok, paged } from '../utils/response.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { audit } from '../services/audit.service.js';
import { notifyRoles, notifyUsers } from '../services/notification.service.js';
import { authorizeStudent, studentScope } from '../services/access.service.js';
import { hashPassword } from '../services/auth.service.js';
import { revokeAllForUser } from '../services/token.service.js';
import { upload, verifyUploadedFile, openStoredFile, safeFilename } from '../services/documents.service.js';
import { ALL_PERMISSIONS, SUPER_ADMIN_ONLY } from '../config/rbac.js';

const r = Router();
const uuidParam = z.object({ id: z.uuid() });
const any = requireAny(...ALL_PERMISSIONS); // any signed-in user with at least one permission

// =============================================================================
// Notifications (every role; always scoped to the signed-in user)
// =============================================================================
r.get('/notifications', any,
  validate(paginationSchema.extend({ category: z.enum(['Critical', 'Attention', 'Information', 'Completed']).optional(), unread: z.stringbool().optional() }), 'query'),
  async (req: Request, res: Response) => {
    const f = v(req, 'query');
    const w = new Where().add('n.user_id = ?', req.user!.id);
    w.addIf(f.category, 'n.category = ?');
    if (f.unread) w.add('n.read_at IS NULL');
    if (f.q) w.add('(n.title ILIKE ? OR n.body ILIKE ?)', likeTerm(f.q), likeTerm(f.q));
    const { limit, offset } = limitOffset(f);
    const rows = await many(
      `SELECT n.id, n.category, n.tone, n.icon, n.topic, n.title, n.body, n.route, n.entity_type AS "entityType",
              n.entity_id AS "entityId", n.read_at AS "readAt", n.created_at AS "createdAt", count(*) OVER() AS total
         FROM notifications n ${w.sql} ORDER BY n.created_at DESC LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
      w.params,
    );
    return paged(res, rows.map(({ total: _t, ...x }) => x), rows[0]?.total ?? 0, f.page, f.pageSize, 'Notifications retrieved');
  });

r.get('/notifications/counts', any, async (req: Request, res: Response) => {
  const c = await one(
    `SELECT count(*) FILTER (WHERE read_at IS NULL)::int AS unread,
            count(*) FILTER (WHERE read_at IS NULL AND category IN ('Critical', 'Attention'))::int AS alerts,
            count(*) FILTER (WHERE category = 'Critical')::int AS critical,
            count(*) FILTER (WHERE category = 'Attention')::int AS attention,
            count(*) FILTER (WHERE category = 'Information')::int AS information,
            count(*) FILTER (WHERE category = 'Completed')::int AS completed,
            count(*)::int AS total
       FROM notifications WHERE user_id = $1`, [req.user!.id]);
  const tasks = await one(
    `SELECT count(*)::int AS open FROM tasks
      WHERE status IN ('Pending', 'Under Review') AND (assignee_user_id = $1 OR assignee_role_key = $2)`,
    [req.user!.id, req.user!.roleKey]);
  return ok(res, { ...c, openTasks: tasks?.open ?? 0 }, 'Notification counts');
});

r.patch('/notifications/:id/read', any, validate(uuidParam, 'params'), async (req: Request, res: Response) => {
  const x = await query('UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2', [v(req, 'params').id, req.user!.id]);
  if (!x.rowCount) throw notFound('Notification not found');
  return ok(res, null, 'Marked as read');
});

r.post('/notifications/read-all', any, async (req: Request, res: Response) => {
  const x = await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user!.id]);
  return ok(res, { updated: x.rowCount }, 'All notifications marked as read');
});

r.post('/notifications/broadcast', requirePermission('notifications.broadcast'),
  validate(z.object({
    roles: z.array(z.string().max(40)).min(1).max(12),
    category: z.enum(['Critical', 'Attention', 'Information', 'Completed']),
    title: z.string().min(3).max(160),
    body: z.string().max(1000).optional(),
    route: z.string().max(200).regex(/^\/[\w\-/?=&]*$/).optional(),
    channels: z.array(z.enum(['whatsapp', 'sms', 'email', 'push'])).default([]),
  })),
  async (req: Request, res: Response) => {
    const b = v(req);
    const ids = await notifyRoles(b.roles, { category: b.category, title: b.title, body: b.body, route: b.route, topic: 'broadcast', icon: 'megaphone', channels: b.channels });
    await audit(req, { action: 'create', module: 'notifications', description: `Broadcast "${b.title}" to ${b.roles.join(', ')} (${ids.length} recipients)` });
    return created(res, { recipients: ids.length }, 'Notification sent');
  });

r.get('/notification-preferences', any, async (req: Request, res: Response) =>
  ok(res, await many('SELECT topic, in_app AS "inApp", whatsapp, sms, email, push FROM notification_preferences WHERE user_id = $1 ORDER BY topic', [req.user!.id])));

r.put('/notification-preferences', any,
  validate(z.array(z.object({ topic: z.string().max(40), inApp: z.boolean(), whatsapp: z.boolean(), sms: z.boolean(), email: z.boolean(), push: z.boolean() })).max(30)),
  async (req: Request, res: Response) => {
    for (const p of v<any[]>(req)) {
      await query(
        `INSERT INTO notification_preferences (user_id, topic, in_app, whatsapp, sms, email, push) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (user_id, topic) DO UPDATE SET in_app = $3, whatsapp = $4, sms = $5, email = $6, push = $7, updated_at = now()`,
        [req.user!.id, p.topic, p.inApp, p.whatsapp, p.sms, p.email, p.push]);
    }
    return ok(res, null, 'Preferences saved');
  });

r.post('/device-tokens', any, validate(z.object({ platform: z.enum(['ios', 'android', 'web']), token: z.string().min(10).max(4096) })),
  async (req: Request, res: Response) => {
    const b = v(req);
    await query(
      `INSERT INTO device_tokens (user_id, platform, token) VALUES ($1,$2,$3)
       ON CONFLICT (token) DO UPDATE SET user_id = $1, platform = $2, last_seen_at = now()`,
      [req.user!.id, b.platform, b.token]);
    return created(res, null, 'Device registered for push notifications');
  });

// =============================================================================
// Tasks (assigned to me or to my role)
// =============================================================================
r.get('/tasks', any, validate(paginationSchema.extend({ status: z.enum(['open', 'Pending', 'Under Review', 'Completed', 'Cancelled']).optional() }), 'query'),
  async (req: Request, res: Response) => {
    const f = v(req, 'query');
    const w = new Where().add('(t.assignee_user_id = ? OR t.assignee_role_key = ?)', req.user!.id, req.user!.roleKey);
    if (!f.status || f.status === 'open') w.add(`t.status IN ('Pending', 'Under Review')`);
    else w.add('t.status = ?', f.status);
    if (f.q) w.add('t.title ILIKE ?', likeTerm(f.q));
    const { limit, offset } = limitOffset(f);
    const rows = await many(
      `SELECT t.id, t.code, t.title, t.module, t.due_on AS "dueOn", t.priority, t.status, t.route,
              (t.due_on < current_date) AS overdue, t.completed_at AS "completedAt", count(*) OVER() AS total
         FROM tasks t ${w.sql}
        ORDER BY (t.status = 'Completed'), array_position(ARRAY['High','Medium','Low'], t.priority), t.due_on NULLS LAST
        LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`, w.params);
    return paged(res, rows.map(({ total: _t, ...x }) => x), rows[0]?.total ?? 0, f.page, f.pageSize, 'Tasks retrieved');
  });

r.patch('/tasks/:id', any, validate(uuidParam, 'params'), validate(z.object({ status: z.enum(['Pending', 'Under Review', 'Completed', 'Cancelled']) })),
  async (req: Request, res: Response) => {
    const { status } = v(req);
    const t = await one(
      `UPDATE tasks SET status = $3,
              completed_at = CASE WHEN $3 = 'Completed' THEN now() ELSE NULL END,
              completed_by = CASE WHEN $3 = 'Completed' THEN $4::uuid ELSE NULL END
        WHERE id = $1 AND (assignee_user_id = $4 OR assignee_role_key = $2) RETURNING code, title`,
      [v(req, 'params').id, req.user!.roleKey, status, req.user!.id]);
    if (!t) throw notFound('Task not found');
    await audit(req, { action: 'update', module: 'tasks', description: `Task ${t.code} marked ${status}`, entityType: 'task', entityId: v(req, 'params').id });
    return ok(res, null, 'Task updated');
  });

// =============================================================================
// Global search — scoped to what the signed-in user may open
// =============================================================================
r.get('/search', any, validate(z.object({ q: z.string().trim().min(1).max(80) }), 'query'), async (req: Request, res: Response) => {
  const u = req.user!;
  const term = likeTerm(v(req, 'query').q);
  const results: any[] = [];

  if (u.permissions.has('students.read') || u.permissions.has('students.read_assigned') || u.parentId || u.studentId) {
    const w = new Where().add('s.deleted_at IS NULL');
    studentScope(u, w);
    w.add('(s.full_name ILIKE ? OR s.admission_no ILIKE ?)', term, term);
    const students = await many(
      `SELECT s.id, s.full_name AS label, c.name || sec.name || ' · ' || s.admission_no AS meta
         FROM students s LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
         ${w.sql} ORDER BY s.full_name LIMIT 8`, w.params);
    for (const s of students) {
      results.push({ group: u.parentId ? 'My children' : 'Students', label: s.label, meta: s.meta, icon: 'user', route: u.parentId ? `/parent-360?child=${s.id}` : `/student-360/${s.id}` });
    }
  }
  if (u.permissions.has('parents.read')) {
    for (const p of await many(
      `SELECT id, full_name AS label, phone AS meta FROM parents WHERE deleted_at IS NULL AND (full_name ILIKE $1 OR phone ILIKE $1) ORDER BY full_name LIMIT 6`, [term])) {
      results.push({ group: 'Parents', label: p.label, meta: p.meta, icon: 'users', route: `/parent-directory?parent=${p.id}` });
    }
  }
  if (u.permissions.has('hr.read')) {
    for (const e of await many(
      `SELECT id, full_name AS label, designation || ' · ' || employee_code AS meta FROM employees
        WHERE deleted_at IS NULL AND (full_name ILIKE $1 OR employee_code ILIKE $1) ORDER BY full_name LIMIT 6`, [term])) {
      results.push({ group: 'Employees', label: e.label, meta: e.meta, icon: 'briefcase', route: `/workforce?employee=${e.id}` });
    }
  }
  if (u.permissions.has('admissions.read')) {
    for (const l of await many(
      `SELECT id, student_name || ' (' || parent_name || ')' AS label, stage || ' · ' || code AS meta FROM enquiries
        WHERE deleted_at IS NULL AND (student_name ILIKE $1 OR parent_name ILIKE $1 OR code ILIKE $1) ORDER BY created_at DESC LIMIT 6`, [term])) {
      results.push({ group: 'Admissions', label: l.label, meta: l.meta, icon: 'target', route: `/leads?lead=${l.id}` });
    }
  }
  if (u.permissions.has('finance.read')) {
    for (const p of await many(
      `SELECT p.id, p.receipt_no AS label, s.full_name || ' · ₹' || p.amount AS meta FROM fee_payments p JOIN students s ON s.id = p.student_id
        WHERE p.receipt_no ILIKE $1 ORDER BY p.paid_at DESC LIMIT 4`, [term])) {
      results.push({ group: 'Fees', label: p.label, meta: p.meta, icon: 'receipt', route: `/receipts?receipt=${p.id}` });
    }
  }
  if (u.permissions.has('documents.read')) {
    for (const d of await many(
      `SELECT id, name AS label, category AS meta FROM documents WHERE deleted_at IS NULL AND student_id IS NULL AND name ILIKE $1 LIMIT 4`, [term])) {
      results.push({ group: 'Documents', label: d.label, meta: d.meta, icon: 'folder', route: `/documents?doc=${d.id}` });
    }
  }
  return ok(res, results, 'Search results');
});

// =============================================================================
// Lookups for forms and filters
// =============================================================================
r.get('/lookups', any, async (req: Request, res: Response) => {
  const staff = !req.user!.parentId && !req.user!.studentId;
  const [campuses, academicYears, classes, subjects, houses] = await Promise.all([
    many(`SELECT id, code, name, short_name AS "shortName", place, curriculum, latitude, longitude FROM campuses WHERE is_active ORDER BY established`),
    many(`SELECT id, label, starts_on AS "startsOn", ends_on AS "endsOn", is_current AS "isCurrent", is_locked AS "isLocked" FROM academic_years ORDER BY starts_on DESC`),
    staff ? many(`SELECT c.id, c.name, c.grade_level AS "gradeLevel", c.stage, c.campus_id AS "campusId",
                         COALESCE(json_agg(json_build_object('id', s.id, 'name', s.name, 'room', s.room) ORDER BY s.name) FILTER (WHERE s.id IS NOT NULL), '[]') AS sections
                    FROM classes c
                    LEFT JOIN sections s ON s.class_id = c.id AND s.academic_year_id = (SELECT id FROM academic_years WHERE is_current)
                   GROUP BY c.id ORDER BY c.campus_id, c.grade_level`) : [],
    staff ? many(`SELECT id, code, name, stage FROM subjects ORDER BY name`) : [],
    staff ? many(`SELECT DISTINCT house FROM students WHERE house IS NOT NULL ORDER BY house`).then((x) => x.map((h) => h.house)) : [],
  ]);
  const data: Record<string, unknown> = { campuses, academicYears, classes, subjects, houses };
  if (req.user!.permissions.has('transport.read') || req.user!.permissions.has('students.create')) {
    data.routes = await many(`SELECT tr.id, tr.code, tr.name, tr.area, tr.campus_id AS "campusId",
                                     COALESCE(json_agg(json_build_object('id', rs.id, 'name', rs.name) ORDER BY rs.sequence) FILTER (WHERE rs.id IS NOT NULL), '[]') AS stops
                                FROM transport_routes tr LEFT JOIN route_stops rs ON rs.route_id = tr.id
                               GROUP BY tr.id ORDER BY tr.code`);
  }
  if (staff) {
    data.staff = await many(`SELECT id, full_name AS "fullName", designation, employee_type AS "employeeType", department
                               FROM employees WHERE deleted_at IS NULL AND employment_status = 'active' ORDER BY full_name`);
  }
  if (req.user!.permissions.has('users.manage')) data.roles = await many('SELECT id, key, name, description, scope FROM roles ORDER BY name');
  return ok(res, data, 'Lookups');
});

// =============================================================================
// Audit trail
// =============================================================================
r.get('/audit-logs', requirePermission('audit.read'),
  validate(paginationSchema.extend({
    module: z.string().max(40).optional(), action: z.string().max(30).optional(),
    userId: z.uuid().optional(), entityId: z.string().max(64).optional(),
    from: z.iso.date().optional(), to: z.iso.date().optional(),
  }), 'query'),
  async (req: Request, res: Response) => {
    const f = v(req, 'query');
    const w = new Where();
    w.addIf(f.module, 'a.module = ?');
    w.addIf(f.action, 'a.action = ?');
    w.addIf(f.userId, 'a.user_id = ?');
    w.addIf(f.entityId, 'a.entity_id = ?');
    // School days (Asia/Kolkata), whatever the database server's own timezone is.
    w.addIf(f.from, `a.created_at >= (?::date::timestamp AT TIME ZONE 'Asia/Kolkata')`);
    w.addIf(f.to, `a.created_at < ((?::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`);
    if (f.q) w.add('(a.description ILIKE ? OR a.user_name ILIKE ?)', likeTerm(f.q), likeTerm(f.q));
    const { limit, offset } = limitOffset(f);
    const rows = await many(
      `SELECT a.id, a.created_at AS "createdAt", a.user_name AS "userName", a.role_key AS role, a.action, a.module,
              a.entity_type AS "entityType", a.entity_id AS "entityId", a.description, host(a.ip_address) AS ip,
              a.device, a.user_agent AS "userAgent", count(*) OVER() AS total
         FROM audit_logs a ${w.sql} ORDER BY a.created_at DESC, a.id DESC
         LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`, w.params);
    await audit(req, { action: 'view', module: 'audit', description: 'Viewed audit trail', metadata: { filters: f } });
    return paged(res, rows.map(({ total: _t, ...x }) => x), rows[0]?.total ?? 0, f.page, f.pageSize, 'Audit trail retrieved');
  });

// =============================================================================
// Users & roles
// =============================================================================
r.get('/users', requirePermission('users.manage'), validate(paginationSchema.extend({ role: z.string().max(40).optional() }), 'query'),
  async (req: Request, res: Response) => {
    const f = v(req, 'query');
    const w = new Where().add('u.deleted_at IS NULL');
    w.addIf(f.role, 'r.key = ?');
    if (f.q) w.add('(u.full_name ILIKE ? OR u.email::text ILIKE ?)', likeTerm(f.q), likeTerm(f.q));
    const { limit, offset } = limitOffset(f);
    const rows = await many(
      `SELECT u.id, u.email, u.phone, u.full_name AS "fullName", u.title, u.status, r.key AS role, r.name AS "roleName",
              u.last_login_at AS "lastLoginAt", u.locked_until AS "lockedUntil", count(*) OVER() AS total
         FROM users u JOIN roles r ON r.id = u.role_id ${w.sql} ORDER BY u.full_name
         LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`, w.params);
    return paged(res, rows.map(({ total: _t, ...x }) => x), rows[0]?.total ?? 0, f.page, f.pageSize, 'Users retrieved');
  });

const passwordRule = z.string().min(10).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/);

r.post('/users', requirePermission('users.manage'),
  validate(z.object({
    email: z.email(), phone: z.string().regex(/^\+?[0-9 ]{8,16}$/).optional(), fullName: z.string().min(2).max(120),
    title: z.string().max(80).optional(), roleKey: z.string().max(40), campusId: z.uuid().optional(), password: passwordRule,
  })),
  async (req: Request, res: Response) => {
    const b = v(req);
    const role = await one<{ id: string }>('SELECT id FROM roles WHERE key = $1', [b.roleKey]);
    if (!role) throw badRequest('Unknown role', 'UNKNOWN_ROLE');
    if (b.roleKey === 'super_admin' && req.user!.roleKey !== 'super_admin') throw forbidden('Only a Super Admin can create Super Admins');
    const u = await one<{ id: string }>(
      `INSERT INTO users (email, phone, password_hash, full_name, title, role_id, campus_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [b.email.toLowerCase(), b.phone ?? null, await hashPassword(b.password), b.fullName, b.title ?? null, role.id, b.campusId ?? null]);
    await audit(req, { action: 'create', module: 'users', description: `Created user ${b.email} with role ${b.roleKey}`, entityType: 'user', entityId: u!.id });
    return created(res, { id: u!.id }, 'User created');
  });

r.patch('/users/:id', requirePermission('users.manage'), validate(uuidParam, 'params'),
  validate(z.object({ roleKey: z.string().max(40).optional(), status: z.enum(['active', 'suspended']).optional(), title: z.string().max(80).optional(), unlock: z.boolean().optional() })),
  async (req: Request, res: Response) => {
    const id = v(req, 'params').id;
    const b = v(req);
    if (id === req.user!.id && (b.roleKey || b.status === 'suspended')) throw badRequest('You cannot change your own role or suspend yourself', 'SELF_CHANGE');
    if (req.user!.roleKey !== 'super_admin') {
      const target = await one<{ key: string }>('SELECT r.key FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1', [id]);
      if (target?.key === 'super_admin') throw forbidden('Only a Super Admin can change a Super Admin account');
    }
    let roleId: string | null = null;
    if (b.roleKey) {
      if (b.roleKey === 'super_admin' && req.user!.roleKey !== 'super_admin') throw forbidden('Only a Super Admin can grant Super Admin');
      roleId = (await one<{ id: string }>('SELECT id FROM roles WHERE key = $1', [b.roleKey]))?.id ?? null;
      if (!roleId) throw badRequest('Unknown role', 'UNKNOWN_ROLE');
    }
    const x = await query(
      `UPDATE users SET role_id = COALESCE($2, role_id), status = COALESCE($3, status), title = COALESCE($4, title),
              failed_login_count = CASE WHEN $5 THEN 0 ELSE failed_login_count END,
              locked_until = CASE WHEN $5 THEN NULL ELSE locked_until END
        WHERE id = $1 AND deleted_at IS NULL`,
      [id, roleId, b.status ?? null, b.title ?? null, !!b.unlock]);
    if (!x.rowCount) throw notFound('User not found');
    if (b.status === 'suspended' || b.roleKey) await revokeAllForUser(id);
    await audit(req, { action: 'update', module: 'users', description: `Updated user (${Object.keys(b).join(', ')})`, entityType: 'user', entityId: id, metadata: b });
    return ok(res, null, 'User updated');
  });

r.get('/roles', requireAny('users.manage', 'settings.manage'), async (_req: Request, res: Response) => {
  const roles = await many(
    `SELECT r.id, r.key, r.name, r.description, r.scope, r.home_route AS "homeRoute",
            COALESCE(array_agg(p.key ORDER BY p.key) FILTER (WHERE p.key IS NOT NULL), '{}') AS permissions,
            (SELECT count(*) FROM users u WHERE u.role_id = r.id AND u.deleted_at IS NULL)::int AS users
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id
      GROUP BY r.id ORDER BY r.name`);
  const permissions = await many('SELECT key, module, description FROM permissions ORDER BY module, key');
  return ok(res, { roles, permissions }, 'Roles and permissions');
});

r.put('/roles/:id/permissions', requirePermission('users.manage', 'settings.manage'), validate(uuidParam, 'params'),
  validate(z.object({ permissions: z.array(z.string().max(60)).max(200) })),
  async (req: Request, res: Response) => {
    const role = await one<{ key: string }>('SELECT key FROM roles WHERE id = $1', [v(req, 'params').id]);
    if (!role) throw notFound('Role not found');
    if (role.key === 'super_admin') throw forbidden('Super Admin permissions cannot be edited');
    const perms: string[] = v(req).permissions;
    // Approve / reject rights belong to the Super Admin alone — nobody else can hand them out.
    if (req.user!.roleKey !== 'super_admin' && perms.some((p) => (SUPER_ADMIN_ONLY as string[]).includes(p))) {
      throw forbidden('Only a Super Admin can grant approval rights');
    }
    await query('DELETE FROM role_permissions WHERE role_id = $1', [v(req, 'params').id]);
    await query(
      `INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE key = ANY($2)`,
      [v(req, 'params').id, perms]);
    clearPermissionCache();
    await audit(req, { action: 'update', module: 'users', description: `Changed permissions for role ${role.key}`, entityType: 'role', entityId: v(req, 'params').id, metadata: { permissions: perms } });
    return ok(res, null, 'Role permissions updated');
  });

// =============================================================================
// System settings
// =============================================================================
r.get('/settings', requirePermission('settings.manage'), async (_req: Request, res: Response) =>
  ok(res, await many('SELECT key, value, description, is_public AS "isPublic", updated_at AS "updatedAt" FROM system_settings ORDER BY key')));

r.put('/settings/:key', requirePermission('settings.manage'),
  validate(z.object({ key: z.string().regex(/^[a-z0-9_.]{2,60}$/) }), 'params'), validate(z.object({ value: z.json() })),
  async (req: Request, res: Response) => {
    const x = await query('UPDATE system_settings SET value = $2, updated_by = $3 WHERE key = $1', [v(req, 'params').key, JSON.stringify(v(req).value), req.user!.id]);
    if (!x.rowCount) throw notFound('Setting not found');
    await audit(req, { action: 'update', module: 'settings', description: `Changed setting ${v(req, 'params').key}` });
    return ok(res, null, 'Setting saved');
  });

// =============================================================================
// Documents — secure upload & download
// =============================================================================
r.post('/documents', requireAny('documents.manage', 'students.update', 'parent_portal.use'), upload.single('file'),
  async (req: Request, res: Response) => {
    const parsed = z.object({
      name: z.string().min(2).max(160),
      category: z.string().max(60).default('General'),
      studentId: z.string().max(64).optional(),
      documentId: z.uuid().optional(),     // fulfil an existing "Pending" request
      collection: z.string().max(80).optional(),
    }).safeParse(req.body ?? {});
    if (!parsed.success) {
      throw badRequest('Validation failed', 'VALIDATION_ERROR', parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
    }
    const body = parsed.data;
    if (!req.file) throw badRequest('Attach a file in the "file" field', 'FILE_REQUIRED');
    const u = req.user!;
    let studentId: string | null = null;
    if (body.studentId) studentId = await authorizeStudent(req, body.studentId);
    else if (!u.permissions.has('documents.manage')) throw forbidden('Only document managers can upload school documents');
    const stored = await verifyUploadedFile(req.file);

    let id: string;
    if (body.documentId) {
      const row = await one<{ id: string }>(
        `UPDATE documents SET storage_key = $2, original_name = $3, mime_type = $4, size_bytes = $5, checksum_sha256 = $6,
                status = 'Submitted', uploaded_by = $7
          WHERE id = $1 AND (student_id IS NOT DISTINCT FROM $8) AND deleted_at IS NULL RETURNING id`,
        [body.documentId, stored.storageKey, safeFilename(req.file.originalname), req.file.mimetype, stored.size, stored.checksum, u.id, studentId]);
      if (!row) throw notFound('Document request not found');
      id = row.id;
    } else {
      const row = await one<{ id: string }>(
        `INSERT INTO documents (owner_type, owner_id, student_id, name, category, collection, status, storage_key, original_name,
                                mime_type, size_bytes, checksum_sha256, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,'Submitted',$7,$8,$9,$10,$11,$12) RETURNING id`,
        [studentId ? 'student' : 'school', studentId, studentId, body.name, body.category, body.collection ?? null, stored.storageKey,
          safeFilename(req.file.originalname), req.file.mimetype, stored.size, stored.checksum, u.id]);
      id = row!.id;
    }
    await audit(req, { action: 'create', module: 'documents', description: `Uploaded document "${body.name}"`, entityType: 'document', entityId: id, metadata: { studentId } });
    if (u.parentId) await notifyRoles(['office'], { category: 'Attention', topic: 'documents', icon: 'folder', title: `Parent uploaded "${body.name}" for verification`, route: '/documents' });
    return created(res, { id }, 'Document uploaded');
  });

r.get('/documents/:id/download', any, validate(uuidParam, 'params'), async (req: Request, res: Response) => {
  const d = await one<{ id: string; student_id: string | null; storage_key: string | null; original_name: string | null; mime_type: string | null; name: string }>(
    'SELECT id, student_id, storage_key, original_name, mime_type, name FROM documents WHERE id = $1 AND deleted_at IS NULL', [v(req, 'params').id]);
  if (!d || !d.storage_key) throw notFound('Document not found');
  if (d.student_id) await authorizeStudent(req, d.student_id);
  else if (!req.user!.permissions.has('documents.read')) throw notFound('Document not found');
  const stream = await openStoredFile(d.storage_key);
  if (!stream) throw notFound('File is no longer available');
  await audit(req, { action: 'view', module: 'documents', description: `Downloaded "${d.name}"`, entityType: 'document', entityId: d.id });
  res.setHeader('Content-Type', d.mime_type ?? 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(d.original_name ?? d.name)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // A read error mid-transfer (file removed, storage connection dropped) must end this
  // response, not surface as an unhandled 'error' event that takes the process down.
  stream.on('error', (err) => {
    req.log?.error({ err, document: d.id }, 'document download failed');
    res.destroy(err);
  });
  stream.pipe(res);
});

// Verifying or rejecting a document is an approval decision: Super Admin only.
r.patch('/documents/:id/verify', requirePermission('approvals.decide'), validate(uuidParam, 'params'),
  validate(z.object({ status: z.enum(['Verified', 'Rejected']), note: z.string().max(300).optional() })),
  async (req: Request, res: Response) => {
    const b = v(req);
    const d = await one<{ name: string; student_id: string | null; uploaded_by: string | null }>(
      `UPDATE documents SET status = $2, verified_by = $3, verified_at = now() WHERE id = $1 AND deleted_at IS NULL
       RETURNING name, student_id, uploaded_by`, [v(req, 'params').id, b.status, req.user!.id]);
    if (!d) throw notFound('Document not found');
    if (d.uploaded_by && d.uploaded_by !== req.user!.id) {
      await notifyUsers([d.uploaded_by], { category: b.status === 'Verified' ? 'Completed' : 'Attention', topic: 'documents', icon: 'folder', title: `"${d.name}" was ${b.status.toLowerCase()}`, body: b.note });
    }
    await audit(req, { action: 'approve', module: 'documents', description: `${b.status} document "${d.name}"`, entityType: 'document', entityId: v(req, 'params').id });
    return ok(res, null, `Document ${b.status.toLowerCase()}`);
  });

export default r;
