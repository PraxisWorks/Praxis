import {
  readConfig,
  secureDeleteConfig,
  readPidFile,
  deletePidFile,
} from "./praxis-config.js";

export async function runLogout(): Promise<void> {
  const config = await readConfig();

  if (!config) {
    console.log("Not logged in.");
    return;
  }

  // Check if worker is running and stop it
  const pid = await readPidFile();
  if (pid) {
    try {
      process.kill(pid, 0); // Check if process exists
      console.log(`Stopping running worker (PID ${pid})...`);
      process.kill(pid, "SIGTERM");
      // Give it a moment to shut down
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch {
      // Process doesn't exist, that's fine
    }
    await deletePidFile();
  }

  // Securely delete config
  await secureDeleteConfig();
  console.log(`Logged out worker '${config.workerName}' (${config.workerId}).`);
  console.log("Config file securely deleted.");
}
