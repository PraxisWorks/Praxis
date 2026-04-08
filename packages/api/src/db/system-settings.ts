import { eq } from "drizzle-orm";
import { getDb } from "./index.js";
import { systemSettings } from "./schema.js";

/** Known system setting keys with their expected value types. */
export type SystemSettingKey = "default_role_id";

const DEFAULTS: Record<SystemSettingKey, string> = {
  default_role_id: "",
};

/**
 * Read a system setting. Returns the stored value or the built-in default
 * if the key has never been set.
 */
export async function readSetting(key: SystemSettingKey): Promise<string> {
  const db = getDb();
  const [row] = await db
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, key))
    .limit(1);

  return row?.value ?? DEFAULTS[key];
}

/** Convenience: read a boolean setting. */
export async function readBooleanSetting(key: SystemSettingKey): Promise<boolean> {
  const value = await readSetting(key);
  return value === "true";
}

/**
 * Write (upsert) a system setting.
 */
export async function writeSetting(key: SystemSettingKey, value: string): Promise<void> {
  const db = getDb();
  await db
    .insert(systemSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

/**
 * Read all system settings as a key→value record.
 */
export async function readAllSettings(): Promise<Record<string, string>> {
  const db = getDb();
  const rows = await db.select().from(systemSettings);
  const result: Record<string, string> = { ...DEFAULTS };
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}
