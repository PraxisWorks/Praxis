-- Set app.user_id as a role-level default on all existing per-user worker roles.
--
-- RLS policies use current_setting('app.user_id', true) to scope rows.
-- Previously we relied on a client-side postgres.js onconnect hook to call
-- set_config('app.user_id', ...) on each connection, but this proved unreliable.
--
-- ALTER ROLE ... SET makes PostgreSQL set the GUC automatically on every
-- connection by that role — no client cooperation needed.
--
-- The userId is extracted from the role name: praxis_worker_<uuid_with_underscores>
-- We look up the corresponding worker row to find the actual userId.
DO $$
DECLARE
  r RECORD;
  uid uuid;
BEGIN
  FOR r IN
    SELECT w.user_id, pg_roles.rolname
    FROM pg_roles
    JOIN workers w ON 'praxis_worker_' || replace(w.user_id::text, '-', '_') = pg_roles.rolname
    WHERE pg_roles.rolname LIKE 'praxis_worker_%'
      AND w.user_id IS NOT NULL
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER ROLE %I SET app.user_id = %L',
        r.rolname,
        r.user_id::text
      );
      RAISE NOTICE 'Set app.user_id on role %', r.rolname;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'Cannot alter role % (managed Postgres) — skipping', r.rolname;
    END;
  END LOOP;
END $$;
