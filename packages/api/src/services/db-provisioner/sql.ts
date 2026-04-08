import { randomBytes } from "node:crypto";
import type { DbProvisioner } from "./types.js";
import { getDb, getConnectionString } from "../../db/index.js";
import { getEnv } from "../../lib/env.js";
import { getLogger } from "../../lib/logger.js";

export function createSqlProvisioner(_config: Record<string, never>): DbProvisioner {
  return {
    async createUser(userId: string, publicHost?: string) {
      const db = getDb();
      const roleName = `praxis_worker_${userId.replace(/-/g, "_")}`;
      const password = randomBytes(32).toString("hex");

      // Create or update the LOGIN role with a fresh password.
      // NOBYPASSRLS ensures Postgres RLS policies are enforced for this role.
      await db.execute(
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${roleName}') THEN CREATE ROLE "${roleName}" LOGIN NOBYPASSRLS PASSWORD '${password}'; ELSE ALTER ROLE "${roleName}" LOGIN NOBYPASSRLS PASSWORD '${password}'; END IF; END $$;`,
      );

      // Set app.user_id as a role-level default so every connection by this role
      // automatically has it set. On managed Postgres (e.g. DigitalOcean) this
      // requires superuser which is not available. The worker's postgres.js
      // onconnect hook calls set_config('app.user_id', ...) per-session as a
      // reliable fallback, so this is non-fatal.
      try {
        await db.execute(
          `ALTER ROLE "${roleName}" SET app.user_id = '${userId}';`,
        );
      } catch (err) {
        getLogger().info(
          { err, roleName },
          "ALTER ROLE SET app.user_id not permitted (managed DB) — relying on client-side set_config",
        );
      }

      // Grant access to application tables in public schema
      await db.execute(`GRANT USAGE ON SCHEMA public TO "${roleName}";`);
      await db.execute(`GRANT ALL ON ALL TABLES IN SCHEMA public TO "${roleName}";`);
      await db.execute(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "${roleName}";`);
      await db.execute(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${roleName}";`);
      await db.execute(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "${roleName}";`);

      // Grant access to pg-boss schema (created by pg-boss on first start).
      // CREATE is required because pg-boss creates partition tables for each queue.
      try {
        await db.execute(`GRANT USAGE, CREATE ON SCHEMA pgboss TO "${roleName}";`);
        await db.execute(`GRANT ALL ON ALL TABLES IN SCHEMA pgboss TO "${roleName}";`);
        await db.execute(`GRANT ALL ON ALL SEQUENCES IN SCHEMA pgboss TO "${roleName}";`);
        await db.execute(`ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT ALL ON TABLES TO "${roleName}";`);
        await db.execute(`ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT ALL ON SEQUENCES TO "${roleName}";`);

        // pg-boss's create_queue() does ALTER TABLE pgboss.job ATTACH PARTITION,
        // which requires table ownership — GRANT ALL is not enough.
        // Setting SECURITY DEFINER on pgboss functions makes them execute as
        // the admin role that owns them, so workers can create queues without
        // needing ownership of the tables.
        await db.execute(`
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
          END $$;
        `);
      } catch (err) {
        // pgboss schema may not exist yet if worker hasn't started once; non-fatal
        getLogger().warn({ err, roleName }, "Failed to grant pgboss schema access (non-fatal)");
      }

      // Build connection string from server's DATABASE_URL with per-user credentials.
      // DB_PUBLIC_HOST overrides the hostname for remote workers (e.g. when the
      // server's DATABASE_URL uses an internal hostname). Falls back to the
      // request hostname, then the DATABASE_URL hostname.
      const serverUrl = new URL(getConnectionString());
      serverUrl.username = roleName;
      serverUrl.password = password;
      const env = getEnv();
      const dbPublicHost = env.DB_PUBLIC_HOST;
      if (dbPublicHost) {
        serverUrl.hostname = dbPublicHost;
        // Managed databases (e.g. DigitalOcean) use a CA cert not in the
        // system trust store. Use sslmode=require which both postgres.js and
        // the pg driver treat as "SSL on, rejectUnauthorized=false".
        serverUrl.searchParams.set("sslmode", "require");
      } else if (publicHost) {
        serverUrl.hostname = publicHost;
      }
      const publicPort = env.DB_PUBLIC_PORT;
      if (publicPort) {
        serverUrl.port = publicPort;
      }

      getLogger().info({ roleName, userId }, "Provisioned per-user DB LOGIN role");
      return { databaseUrl: serverUrl.toString() };
    },
  };
}
