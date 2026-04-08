-- Grant CREATE on pgboss schema to all existing per-user worker roles.
-- New roles provisioned after this fix already get CREATE via worker-login.ts.
-- pg-boss needs CREATE to make partition tables for each queue.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT rolname FROM pg_roles WHERE rolname LIKE 'praxis_worker_%'
  LOOP
    BEGIN
      EXECUTE format('GRANT USAGE, CREATE ON SCHEMA pgboss TO %I', r.rolname);
      EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA pgboss TO %I', r.rolname);
      EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA pgboss TO %I', r.rolname);
    EXCEPTION WHEN invalid_schema_name OR insufficient_privilege THEN
      RAISE NOTICE 'Cannot grant pgboss to % — skipping', r.rolname;
    END;
  END LOOP;
END $$;
