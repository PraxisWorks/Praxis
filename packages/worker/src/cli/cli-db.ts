import postgres from "postgres";

/**
 * Read a required environment variable or exit with an error message.
 */
export function requiredEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return val;
}

/**
 * Create a postgres.js connection that sets `app.user_id` on every new
 * connection when `WORKER_USER_ID` is present in the environment.
 *
 * This is critical for RLS (Row-Level Security) policies to work. Without
 * this, `current_app_user_id()` returns NULL and every RLS-protected
 * query returns zero rows for local worker roles.
 *
 * Central workers (no WORKER_USER_ID) skip the onconnect hook and rely
 * on their admin role's BYPASSRLS privilege.
 */
export function createCliSql(databaseUrl: string): postgres.Sql {
  const userId = process.env.WORKER_USER_ID;

  // Inject app.user_id via the Postgres `options` connection parameter.
  // This is more reliable than the onconnect hook which can silently fail.
  let connStr = databaseUrl;
  if (userId) {
    const url = new URL(databaseUrl);
    url.searchParams.set("options", `-c app.user_id=${userId}`);
    connStr = url.toString();
  }

  return postgres(connStr, {
    max: 2,
    idle_timeout: 5,
    prepare: false,
  });
}
