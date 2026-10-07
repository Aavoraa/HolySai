-- =============================================================================
-- 111 OWNER OVERVIEW
-- The Super Admin owns the school, so their landing page is the Owner Overview
-- (money, management activity and what has changed since their last sign-in)
-- rather than the Principal's day-to-day Command Center.
--
-- Fresh installs get this from config/rbac.ts via the seed; this migration
-- brings existing databases into line.
-- =============================================================================

UPDATE roles SET home_route = '/overview' WHERE key = 'super_admin';

-- The overview reads each owner's previous sign-in from the audit trail:
--   WHERE user_id = ? AND action = 'login' ORDER BY created_at DESC OFFSET 1
-- ix_audit_logs_user covers (user_id, created_at DESC); this partial index keeps
-- that lookup cheap once the table holds years of non-login activity.
CREATE INDEX IF NOT EXISTS ix_audit_logs_login
  ON audit_logs (user_id, created_at DESC)
  WHERE action = 'login';
