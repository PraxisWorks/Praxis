import { mkdir, readFile, writeFile, unlink, stat, chmod } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".praxis");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const PID_PATH = join(CONFIG_DIR, "worker.pid");

export interface PraxisConfig {
  workerId: string;
  workerName: string;
  apiUrl: string;
  userId: string;
  databaseUrl?: string;
}

/** Ensure config directory exists with 0700 permissions */
export async function ensureConfigDir(): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

/** Write config file with 0600 permissions (owner read/write only) */
export async function writeConfig(config: PraxisConfig): Promise<void> {
  await ensureConfigDir();
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

/** Read config file. Returns null if not found. */
export async function readConfig(): Promise<PraxisConfig | null> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as PraxisConfig;
  } catch {
    return null;
  }
}

/** Check if config file has secure permissions (0600). Returns warnings. */
export async function checkConfigPermissions(): Promise<string[]> {
  const warnings: string[] = [];
  try {
    const stats = await stat(CONFIG_PATH);
    const mode = stats.mode & 0o777;
    if (mode !== 0o600) {
      warnings.push(
        `Warning: Config file permissions are ${mode.toString(8)} (expected 600). ` +
          `Run: chmod 600 ${CONFIG_PATH}`,
      );
    }
  } catch {
    // File doesn't exist, no warning needed
  }
  return warnings;
}

/** Fix config file permissions to 0600 */
export async function fixConfigPermissions(): Promise<void> {
  await chmod(CONFIG_PATH, 0o600);
}

/** Securely delete config file (overwrite before unlinking) */
export async function secureDeleteConfig(): Promise<void> {
  try {
    // Overwrite with zeros before deleting
    const stats = await stat(CONFIG_PATH);
    const zeros = Buffer.alloc(stats.size, 0);
    await writeFile(CONFIG_PATH, zeros);
    await unlink(CONFIG_PATH);
  } catch {
    // If file doesn't exist, that's fine
    try {
      await unlink(CONFIG_PATH);
    } catch {
      // Already gone
    }
  }
}

/** Write PID file */
export async function writePidFile(pid: number): Promise<void> {
  await ensureConfigDir();
  await writeFile(PID_PATH, String(pid), { mode: 0o600 });
}

/** Read PID file. Returns null if not found. */
export async function readPidFile(): Promise<number | null> {
  try {
    const raw = await readFile(PID_PATH, "utf-8");
    const pid = parseInt(raw.trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/** Delete PID file */
export async function deletePidFile(): Promise<void> {
  try {
    await unlink(PID_PATH);
  } catch {
    // Already gone
  }
}

export type PopulateEnvResult =
  | { ok: true }
  | { ok: false; reason: "not-logged-in" };

/** Read config and populate process.env with only-if-missing semantics. */
export async function populateEnvFromConfig(): Promise<PopulateEnvResult> {
  const config = await readConfig();
  if (!config) {
    return { ok: false as const, reason: "not-logged-in" as const };
  }

  if (!config.databaseUrl) {
    return { ok: false as const, reason: "not-logged-in" as const };
  }

  const warnings = await checkConfigPermissions();
  for (const w of warnings) {
    console.warn(w);
  }

  process.env.DATABASE_URL ??= config.databaseUrl;
  process.env.WORKER_USER_ID ??= config.userId;
  process.env.WORKER_NAME ??= config.workerName;
  process.env.WORKER_ID ??= config.workerId;

  return { ok: true as const };
}

export { CONFIG_DIR, CONFIG_PATH, PID_PATH };
