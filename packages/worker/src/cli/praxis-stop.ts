import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { getConfigPath, getConfigDir } from "./praxis-login.js";

export async function praxisStop(_args: string[]): Promise<void> {
  // Verify logged in
  try {
    await readFile(getConfigPath(), "utf-8");
  } catch {
    console.error("Not logged in. Run `praxis login` first.");
    process.exit(1);
  }

  const pidPath = join(getConfigDir(), "worker.pid");
  let pidStr: string;

  try {
    pidStr = await readFile(pidPath, "utf-8");
  } catch {
    console.log("No worker process running");
    return;
  }

  const pid = parseInt(pidStr.trim(), 10);
  if (isNaN(pid)) {
    console.log("No worker process running");
    await cleanupPidFile(pidPath);
    return;
  }

  try {
    // Check if process exists (signal 0 doesn't kill, just checks)
    process.kill(pid, 0);
  } catch {
    console.log("No worker process running");
    await cleanupPidFile(pidPath);
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    console.log(`Stopping worker (PID ${pid})...`);
    await cleanupPidFile(pidPath);
  } catch (err) {
    console.error(
      `Error stopping worker: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}

async function cleanupPidFile(pidPath: string): Promise<void> {
  try {
    await unlink(pidPath);
  } catch {
    // ignore — file may already be gone
  }
}
