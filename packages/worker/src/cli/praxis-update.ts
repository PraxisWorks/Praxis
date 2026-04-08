import { execSync, spawn } from "node:child_process";

import { readPidFile, deletePidFile } from "./praxis-config.js";

declare const __PRAXIS_VERSION__: string;
const currentVersion =
  typeof __PRAXIS_VERSION__ !== "undefined" ? __PRAXIS_VERSION__ : "dev";

const VERSION_PATTERN = /^\d+\.\d+\.\d+/;

type FetchVersionResult =
  | { success: true; version: string }
  | { success: false; error: string };

/** Fetch the latest published version from the public npm registry */
export async function fetchLatestVersion(): Promise<FetchVersionResult> {
  let response: Response;
  try {
    response = await fetch("https://registry.npmjs.org/@praxwork/cli");
  } catch (err) {
    return {
      success: false,
      error: `Network error fetching latest version: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!response.ok) {
    return {
      success: false,
      error: `Registry returned HTTP ${response.status}. Try again later.`,
    };
  }

  let data: Record<string, unknown>;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    return {
      success: false,
      error: "Failed to parse registry response as JSON.",
    };
  }

  const distTags = data["dist-tags"] as Record<string, string> | undefined;
  const latest = distTags?.latest;
  if (!latest) {
    return {
      success: false,
      error: "Registry response did not contain a dist-tags.latest field.",
    };
  }

  if (!VERSION_PATTERN.test(latest)) {
    return {
      success: false,
      error: `Registry returned an invalid version string: "${latest}".`,
    };
  }

  return { success: true, version: latest };
}

/** Stop a running worker process if one exists. Returns true if a worker was stopped. */
async function stopRunningWorker(): Promise<boolean> {
  const pid = await readPidFile();
  if (pid === null) {
    return false;
  }

  try {
    process.kill(pid, 0);
  } catch {
    // Process not running, clean up stale pid file
    await deletePidFile();
    return false;
  }

  try {
    process.kill(pid, "SIGTERM");
    console.log(`Stopped running worker (PID ${pid}).`);
    await deletePidFile();
    return true;
  } catch (err) {
    console.error(
      `Warning: Failed to stop worker (PID ${pid}): ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/**
 * Install a specific version of the worker package globally from the
 * public npm registry.
 */
async function installVersion(version: string): Promise<void> {
  console.log(`Installing @praxwork/cli@${version}...`);

  execSync(`npm install -g @praxwork/cli@${version}`, {
    stdio: "inherit",
  });
}

/** Spawn a detached `praxis start` process that survives this process exiting */
function restartWorker(): void {
  const child = spawn("praxis", ["start"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  console.log("Worker restart initiated.");
}

export async function praxisUpdate(args: string[]): Promise<void> {
  const isCheck = args.includes("--check");

  console.log(`Current version: ${currentVersion}`);
  console.log("Checking for updates...");

  const result = await fetchLatestVersion();
  if (!result.success) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  const latest = result.version;
  console.log(`Latest version:  ${latest}`);

  if (currentVersion === latest) {
    console.log("Already up to date.");
    return;
  }

  if (isCheck) {
    console.log(`Update available: ${currentVersion} -> ${latest}`);
    return;
  }

  // Perform the update
  console.log(`Updating ${currentVersion} -> ${latest}...`);

  const workerWasRunning = await stopRunningWorker();

  try {
    await installVersion(latest);
  } catch (err) {
    console.error(
      `Error: npm install failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    console.error("The previous version may still be installed. Try running the update again.");
    process.exit(1);
  }

  console.log(`Updated to v${latest}.`);

  if (workerWasRunning) {
    restartWorker();
  }
}
