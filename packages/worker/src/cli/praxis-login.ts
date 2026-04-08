import { mkdir, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

/** Parse named flags from argv. Returns a map of --key value pairs. Boolean flags get value "true". */
export function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      // Check if next arg is a value (not another flag)
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        flags[key] = args[i + 1];
        i++; // skip the value
      } else {
        // Boolean flag (e.g. --db)
        flags[key] = "true";
      }
    }
  }
  return flags;
}

export interface PraxisConfig {
  workerId: string;
  workerName: string;
  apiUrl: string;
  userId: string;
  databaseUrl?: string;
}

export function getConfigDir(): string {
  return join(homedir(), ".praxis");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

export async function praxisLogin(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const token = flags["token"];
  const name = flags["name"];
  const url = flags["url"];

  if (!token || !name || !url) {
    console.error("Usage: praxis login --token <token> --name <name> --url <api-url>");
    process.exit(1);
  }

  let response: Response;
  try {
    response = await fetch(`${url}/api/worker/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, name }),
    });
  } catch (err) {
    console.error(
      `Error: Failed to connect to ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  if (response.status !== 201) {
    let errorMsg = `Server returned ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) errorMsg = body.error;
    } catch {
      // ignore parse errors
    }
    console.error(`Error: ${errorMsg}`);
    process.exit(1);
  }

  const data = (await response.json()) as {
    workerId: string;
    workerName: string;
    userId: string;
    databaseUrl?: string;
  };

  if (!data.databaseUrl) {
    console.error("Error: Server did not return database credentials. Is the API up to date?");
    process.exit(1);
  }

  const config: PraxisConfig = {
    workerId: data.workerId,
    workerName: data.workerName,
    apiUrl: url,
    userId: data.userId,
    databaseUrl: data.databaseUrl,
  };

  const configDir = getConfigDir();
  const configPath = getConfigPath();

  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  await chmod(configPath, 0o600);

  console.log(`Logged in as '${data.workerName}' (worker: ${data.workerId})`);
}
