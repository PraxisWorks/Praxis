import { sql } from "drizzle-orm";
import { getLogger } from "../logger.js";
import type { DrizzleDb } from "../db.js";

export interface DbRigInitSettings {
  mode: "ruflo" | "custom";
  scripts?: string[];
}

/**
 * Fetch rig init settings for a worker from the DB.
 * Returns null if no settings are stored (defaults apply).
 */
export async function getWorkerRigInitSettings(
  db: DrizzleDb,
  workerId: string,
): Promise<DbRigInitSettings | null> {
  const logger = getLogger();
  try {
    const rows = await db.execute(
      sql`SELECT repo_init_settings FROM workers WHERE id = ${workerId} LIMIT 1`,
    );
    const row = (rows as unknown as Array<{ repo_init_settings?: unknown }>)[0];
    if (!row?.repo_init_settings) return null;
    return row.repo_init_settings as DbRigInitSettings;
  } catch (err) {
    logger.warn({ err, workerId }, "Failed to fetch worker rig init settings");
    return null;
  }
}
