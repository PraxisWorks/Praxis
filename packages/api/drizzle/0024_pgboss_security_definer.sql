-- pg-boss's create_queue() does ALTER TABLE pgboss.job ATTACH PARTITION,
-- which requires table ownership. Per-user worker roles are not owners,
-- so calling create_queue fails with "must be owner of table job".
--
-- Setting SECURITY DEFINER on all pgboss functions makes them execute as
-- the admin role that owns them, letting workers create queues without
-- needing ownership. This is safe because pg-boss functions only operate
-- on the pgboss schema.
DO $$ DECLARE
  func RECORD;
BEGIN
  FOR func IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'pgboss'
  LOOP
    EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER', func.sig);
  END LOOP;
EXCEPTION WHEN invalid_schema_name THEN
  -- pgboss schema may not exist yet; skip silently
  NULL;
END $$;
