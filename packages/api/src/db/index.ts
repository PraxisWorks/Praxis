import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Sql } from "postgres";
import * as schema from "./schema.js";
import { getEnv } from "../lib/env.js";

let cachedDb: ReturnType<typeof drizzle<typeof schema>> | null = null;
let cachedSql: Sql | null = null;

export function getConnectionString(): string {
  return getEnv().DATABASE_URL;
}

/**
 * Returns a raw postgres.js `Sql` instance for executing DDL or other raw SQL
 * that cannot go through Drizzle. The instance is cached and reused across
 * calls (same underlying connection pool as getDb).
 */
export function getSql(): Sql {
  if (!cachedSql) {
    cachedSql = postgres(getConnectionString(), {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return cachedSql;
}

export function getDb() {
  if (!cachedDb) {
    // Re-use the cached Sql instance so we share one connection pool.
    const client = getSql();
    cachedDb = drizzle(client, { schema });
  }
  return cachedDb;
}
