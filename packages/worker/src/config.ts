import { join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";

const DEFAULT_WORKSPACE_ROOT = join(homedir(), ".praxis", "workspaces");

const ConfigSchema = z.object({
  /** PostgreSQL connection string. */
  DATABASE_URL: z.string(),
  ANTHROPIC_API_KEY: z.string().optional(),
  WORKSPACE_ROOT: z.string().default(DEFAULT_WORKSPACE_ROOT),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  // GitHub org + template repo used when a user +New's a repo and their org
  // hasn't set a per-org templateRepo. Optional: if neither org nor worker
  // env provides a template, +New fails with a clear "no template configured"
  // error instead of silently trying to clone an unreachable default.
  GH_ORG: z.string().optional(),
  TEMPLATE_REPO: z.string().optional(),
  GIT_SHA: z.string().optional(),
  DEPLOY_TIMESTAMP: z.string().optional(),
  // ── Storage ──────────────────────────────────────────────────
  STORAGE_PROVIDER: z.enum(["local", "s3"]).optional(),
  STORAGE_LOCAL_DIR: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_ENDPOINT: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  // ── Worker Identity ────────────────────────────────────────────────
  WORKER_ID: z.string().uuid().optional(),
  WORKER_NAME: z.string().default("central"),
  WORKER_USER_ID: z.string().uuid().optional(),
  // ── Claude binary ────────────────────────────────────────────────
  /** Directory containing the `claude` binary, prepended to PATH for child processes. */
  CLAUDE_BIN_DIR: z.string().optional(),
  /** Name or path of the Claude CLI binary. Defaults to "claude". */
  CLAUDE_COMMAND: z.string().min(1).default("claude"),
  /** Model identifier passed to `claude --model`. */
  CLAUDE_MODEL: z
    .string()
    .max(100)
    .regex(/^[a-z0-9-]+$/, "Invalid model identifier")
    .default("opus"),
  // ── Rig Initialization ───────────────────────────────────────────
  /**
   * Whether claude-flow init/daemon/mcp steps run on session start.
   * Defaults to 'false' — ruflo is an opt-in orchestrator layer, not a
   * required dependency. Workers that want ruflo set this to 'true'.
   */
  RIG_INIT_CLAUDE_FLOW: z.enum(["true", "false"]).optional(),
  /** JSON-encoded string[] of custom script paths to run after rig init. */
  RIG_INIT_SCRIPTS: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

let cachedConfig: Config | null = null;

export function validateConfig(env: Record<string, string | undefined>): Config {
  return ConfigSchema.parse(env);
}

export function initConfig(env: Record<string, string | undefined>): Config {
  cachedConfig = validateConfig(env);
  return cachedConfig;
}

export function getConfig(): Config {
  if (!cachedConfig) {
    throw new Error("Config not initialized. Call initConfig() first.");
  }
  return cachedConfig;
}

export interface RigInitOptions {
  claudeFlow: boolean;
  scripts: string[];
}

/**
 * Parse rig-init options from the worker config env vars.
 * Returns sensible defaults when env vars are absent (preserving current behavior).
 */
export function getRigInitOptions(config: Config): RigInitOptions {
  // Opt-in: ruflo only runs when explicitly enabled.
  const claudeFlow = config.RIG_INIT_CLAUDE_FLOW === "true";

  let scripts: string[] = [];
  if (config.RIG_INIT_SCRIPTS) {
    const parsed: unknown = JSON.parse(config.RIG_INIT_SCRIPTS);
    if (!Array.isArray(parsed) || !parsed.every((s) => typeof s === "string")) {
      throw new Error("RIG_INIT_SCRIPTS must be a JSON array of strings");
    }
    scripts = parsed as string[];
  }

  return { claudeFlow, scripts };
}
