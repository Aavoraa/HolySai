-- 117 — Permissions for Budget Planning, Approvals, Job Cards, Parent Contact Log
-- and Cambridge grading; every approval decision becomes Super Admin only.
--
-- backend/src/config/rbac.ts is the source of truth. A fresh database gets these
-- rows from the seed (which runs after the migrations), so this migration only
-- touches databases that already hold roles — it is a no-op on an empty schema.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM roles) THEN
    RETURN;
  END IF;

  INSERT INTO permissions (key, module, description) VALUES
    ('approvals.decide', 'approvals', 'Approve or reject requests in every module (Super Admin only)'),
    ('planning.read',    'planning',  'View budget plans and planning cycles'),
    ('planning.manage',  'planning',  'Prepare and submit budget plans for approval'),
    ('jobcards.use',     'jobcards',  'Raise job cards and work on cards sent to your department'),
    ('jobcards.manage',  'jobcards',  'Manage job cards and departments across the school'),
    ('parentlog.read',   'parentlog', 'View the contact log of parents and staff reaching the principal or staff'),
    ('parentlog.manage', 'parentlog', 'Record walk-ins, calls and other contact attempts'),
    ('grading.manage',   'grading',   'Edit Cambridge grade boundaries and syllabus settings')
  ON CONFLICT (key) DO NOTHING;

  -- Super Admin holds every permission.
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
  WHERE r.key = 'super_admin'
  ON CONFLICT DO NOTHING;

  -- New grants per role (mirrors rbac.ts).
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM (VALUES
    ('school_admin', 'planning.read'), ('school_admin', 'planning.manage'),
    ('school_admin', 'jobcards.use'), ('school_admin', 'jobcards.manage'),
    ('school_admin', 'parentlog.read'), ('school_admin', 'parentlog.manage'),
    ('school_admin', 'grading.manage'),
    ('management', 'planning.read'), ('management', 'jobcards.use'), ('management', 'parentlog.read'),
    ('principal', 'planning.read'), ('principal', 'planning.manage'),
    ('principal', 'jobcards.use'), ('principal', 'jobcards.manage'),
    ('principal', 'parentlog.read'), ('principal', 'parentlog.manage'), ('principal', 'grading.manage'),
    ('teacher', 'jobcards.use'), ('teacher', 'parentlog.manage'),
    ('hr', 'planning.read'), ('hr', 'planning.manage'), ('hr', 'jobcards.use'),
    ('finance', 'planning.read'), ('finance', 'planning.manage'), ('finance', 'jobcards.use'),
    ('office', 'planning.read'), ('office', 'planning.manage'), ('office', 'jobcards.use'),
    ('office', 'parentlog.read'), ('office', 'parentlog.manage'),
    ('staff', 'jobcards.use')
  ) AS g(role_key, perm_key)
  JOIN roles r ON r.key = g.role_key
  JOIN permissions p ON p.key = g.perm_key
  ON CONFLICT DO NOTHING;

  -- Approving and rejecting is reserved to the Super Admin.
  DELETE FROM role_permissions rp
  USING roles r, permissions p
  WHERE rp.role_id = r.id AND rp.permission_id = p.id
    AND r.key <> 'super_admin'
    AND p.key IN ('approvals.decide', 'finance.approve', 'hr.approve', 'payroll.approve');

  UPDATE roles SET description = 'Full analytics, command centre and group dashboard; prepares and submits requests for Super Admin approval'
  WHERE key = 'principal';
END $$;
