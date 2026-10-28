-- "Today" is the school's day (docs/ASSUMPTIONS.md: Asia/Kolkata). Managed Postgres
-- (Supabase, RDS) runs in UTC, so current_date and date casts would put 00:00-05:30 IST
-- on the previous day. The API also sets the zone on each connection; this role default
-- covers connections that bypass that (transaction-mode poolers, psql, other tools).
-- A host that refuses it must not block the deploy.
DO $$
BEGIN
  EXECUTE format('ALTER ROLE %I SET timezone = %L', current_user, 'Asia/Kolkata');
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Could not set the default time zone for role %; the API sets it per connection', current_user;
END $$;
