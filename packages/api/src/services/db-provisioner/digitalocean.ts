import type { DbProvisioner } from "./types.js";
import { getDb, getConnectionString } from "../../db/index.js";
import { getEnv } from "../../lib/env.js";
import { getLogger } from "../../lib/logger.js";

export type DigitalOceanProvisionerConfig = {
  apiToken: string;
  clusterId: string;
};

const DO_API_BASE = "https://api.digitalocean.com/v2/databases";

export function createDigitalOceanProvisioner(config: DigitalOceanProvisionerConfig): DbProvisioner {
  const { apiToken, clusterId } = config;

  function headers(json = true): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${apiToken}`,
    };
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  async function createDoUser(roleName: string): Promise<string> {
    const createRes = await fetch(
      `${DO_API_BASE}/${clusterId}/users`,
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ name: roleName }),
      },
    );

    if (createRes.ok) {
      const body = (await createRes.json()) as { user: { name: string; password: string } };
      return body.user.password;
    }

    // User already exists — reset their password to get a new one
    if (createRes.status === 409) {
      const resetRes = await fetch(
        `${DO_API_BASE}/${clusterId}/users/${roleName}/reset_auth`,
        {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({}),
        },
      );

      if (resetRes.ok) {
        const body = (await resetRes.json()) as { user: { name: string; password: string } };
        return body.user.password;
      }

      const resetText = await resetRes.text();
      throw new Error(
        `Failed to reset auth for DO user ${roleName}: ${resetRes.status} ${resetText}`,
      );
    }

    const createText = await createRes.text();
    throw new Error(
      `Failed to create DO user ${roleName}: ${createRes.status} ${createText}`,
    );
  }

  async function grantPermissions(roleName: string, userId: string): Promise<void> {
    const db = getDb();

    // Set app.user_id as a role-level default for RLS.
    // On managed Postgres (e.g. DigitalOcean) this requires superuser which
    // is not available. The worker's postgres.js onconnect hook calls
    // set_config('app.user_id', ...) per-session as a reliable fallback,
    // so this is non-fatal.
    try {
      await db.execute(`ALTER ROLE "${roleName}" SET app.user_id = '${userId}';`);
    } catch (err) {
      getLogger().info(
        { err, roleName },
        "ALTER ROLE SET app.user_id not permitted (managed DB) — relying on client-side set_config",
      );
    }

    // Grant public schema
    await db.execute(`GRANT USAGE ON SCHEMA public TO "${roleName}";`);
    await db.execute(`GRANT ALL ON ALL TABLES IN SCHEMA public TO "${roleName}";`);
    await db.execute(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "${roleName}";`);
    await db.execute(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${roleName}";`);
    await db.execute(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "${roleName}";`);

    // pgboss grants (non-fatal if schema doesn't exist)
    try {
      await db.execute(`GRANT USAGE, CREATE ON SCHEMA pgboss TO "${roleName}";`);
      await db.execute(`GRANT ALL ON ALL TABLES IN SCHEMA pgboss TO "${roleName}";`);
      await db.execute(`GRANT ALL ON ALL SEQUENCES IN SCHEMA pgboss TO "${roleName}";`);
      await db.execute(`ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT ALL ON TABLES TO "${roleName}";`);
      await db.execute(`ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT ALL ON SEQUENCES TO "${roleName}";`);

      // SECURITY DEFINER for pgboss functions
      await db.execute(`
        DO $$ DECLARE func RECORD; BEGIN
          FOR func IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'pgboss'
          LOOP EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER', func.sig); END LOOP;
        END $$;
      `);
    } catch (err) {
      getLogger().warn({ err, roleName }, "Failed to grant pgboss schema access (non-fatal)");
    }
  }

  function buildConnectionString(roleName: string, password: string, publicHost?: string): string {
    const serverUrl = new URL(getConnectionString());
    serverUrl.username = roleName;
    serverUrl.password = password;
    const env = getEnv();
    const dbPublicHost = env.DB_PUBLIC_HOST;
    if (dbPublicHost) {
      serverUrl.hostname = dbPublicHost;
      serverUrl.searchParams.set("sslmode", "require");
    } else if (publicHost) {
      serverUrl.hostname = publicHost;
    }
    const publicPort = env.DB_PUBLIC_PORT;
    if (publicPort) serverUrl.port = publicPort;
    return serverUrl.toString();
  }

  return {
    async createUser(userId: string, publicHost?: string) {
      const roleName = `praxis_worker_${userId.replace(/-/g, "_")}`;

      const password = await createDoUser(roleName);
      await grantPermissions(roleName, userId);
      const databaseUrl = buildConnectionString(roleName, password, publicHost);

      getLogger().info({ roleName, userId }, "Provisioned DO database user");
      return { databaseUrl };
    },

    async deleteUser(userId: string) {
      const roleName = `praxis_worker_${userId.replace(/-/g, "_")}`;

      const res = await fetch(
        `${DO_API_BASE}/${clusterId}/users/${roleName}`,
        {
          method: "DELETE",
          headers: headers(false),
        },
      );

      if (res.status === 204 || res.status === 404) {
        return;
      }

      const text = await res.text();
      getLogger().warn(
        { roleName, status: res.status, body: text },
        "Failed to delete DO database user (non-fatal)",
      );
    },
  };
}
