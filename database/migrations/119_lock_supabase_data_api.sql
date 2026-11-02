-- Supabase publishes the public schema through its Data API (PostgREST) and grants the
-- anon and authenticated roles full access to new tables by default. Holy Sai never uses
-- that API: every read and write goes through the backend, which enforces RBAC and data
-- scope. Left as is, anyone holding the project's (publishable) anon key could read every
-- table directly, so close it: revoke the API roles' privileges, stop future tables from
-- inheriting them, and enable RLS with no policies as a second lock.
-- The backend connects as the table owner, which bypasses RLS, so the app is unaffected.
-- On plain PostgreSQL (Docker, local) the API roles do not exist and only RLS is enabled.
DO $$
DECLARE
  t record;
  r text;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
  END LOOP;

  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $$;
