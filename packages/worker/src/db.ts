import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export type DrizzleDb = ReturnType<typeof drizzle>;

let cachedDb: DrizzleDb | null = null;
let cachedSql: postgres.Sql | null = null;

export function initDb(connectionString: string, userId?: string): DrizzleDb {
  // Inject app.user_id via the Postgres `options` connection parameter.
  // This is more reliable than the onconnect hook which can silently fail.
  let connStr = connectionString;
  if (userId) {
    const url = new URL(connectionString);
    url.searchParams.set("options", `-c app.user_id=${userId}`);
    connStr = url.toString();
  }
  cachedSql = postgres(connStr, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  cachedDb = drizzle(cachedSql);
  return cachedDb;
}

export function getDb(): DrizzleDb {
  if (!cachedDb) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return cachedDb;
}

export async function closeDb(): Promise<void> {
  if (cachedSql) {
    await cachedSql.end();
    cachedSql = null;
    cachedDb = null;
  }
}
