import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { getConfigPath, getConfigDir, type PraxisConfig } from "./praxis-login.js";

export async function praxisStatus(_args: string[]): Promise<void> {
  let config: PraxisConfig;

  try {
    const raw = await readFile(getConfigPath(), "utf-8");
    config = JSON.parse(raw) as PraxisConfig;
  } catch {
    console.log("Not logged in");
    return;
  }

  console.log(`Worker ID:   ${config.workerId}`);
  console.log(`Worker Name: ${config.workerName}`);
  console.log(`API URL:     ${config.apiUrl}`);

  // Check running status via PID file
  const pidPath = join(getConfigDir(), "worker.pid");
  let running = false;

  try {
    const pidStr = await readFile(pidPath, "utf-8");
    const pid = parseInt(pidStr.trim(), 10);
    if (!isNaN(pid)) {
      process.kill(pid, 0); // throws if process doesn't exist
      running = true;
    }
  } catch {
    // PID file missing or process not running
  }

  console.log(`Status:      ${running ? "Running" : "Stopped"}`);

  // Check config file permissions
  try {
    const configPath = getConfigPath();
    const info = await stat(configPath);
    const mode = info.mode & 0o777;
    if (mode !== 0o600) {
      console.log(
        "Warning: Config file permissions are too open",
      );
    }
  } catch {
    // ignore stat errors
  }
}
