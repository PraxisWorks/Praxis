import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as dotenv from "dotenv";
import { getConfigPath, getConfigDir, type PraxisConfig } from "./praxis-login.js";

export async function praxisStart(_args: string[]): Promise<void> {
  let config: PraxisConfig;

  try {
    const raw = await readFile(getConfigPath(), "utf-8");
    config = JSON.parse(raw) as PraxisConfig;
  } catch {
    console.error("Not logged in. Run `praxis login` first.");
    process.exit(1);
  }

  // Load tunable env vars from ~/.praxis/.env if it exists. Shell env still
  // wins (override: false), and the CWD .env that index.ts loads next only
  // fills in vars this file and the shell both left unset. Precedence:
  //   shell env  >  ~/.praxis/.env  >  CWD/.env  >  config defaults
  const praxisEnvPath = join(getConfigDir(), ".env");
  if (existsSync(praxisEnvPath)) {
    dotenv.config({ path: praxisEnvPath, override: false });
  }

  // Write PID file so `praxis stop` can find us
  const pidPath = join(getConfigDir(), "worker.pid");
  await writeFile(pidPath, String(process.pid), "utf-8");

  // Common env vars for all modes
  process.env["WORKER_ID"] = config.workerId;
  process.env["WORKER_NAME"] = config.workerName;
  process.env["WORKER_USER_ID"] = config.userId;
  process.env["NODE_ENV"] ??= "production";

  process.env["DATABASE_URL"] = config.databaseUrl;
  console.log(`Starting worker '${config.workerName}'...`);

  // Dynamically import the main worker module to start the service
  await import("../index.js");
}
