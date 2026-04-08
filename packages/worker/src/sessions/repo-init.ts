import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getLogger } from "../logger.js";
import { buildChildEnv } from "../child-env.js";
import { getConfig, getRigInitOptions, type RigInitOptions } from "../config.js";

const TASKS_CLAUDE_MD_SECTION = `## Task Tracking (Praxis)

All work items are tracked in the Praxis database via the \`praxis\` CLI.
Do NOT use \`bd\` commands — they track a different system.

### Quick Reference
\`\`\`
$PX_CLI_RUNNER $PX_CLI task ready --parent <id>   # What's actionable now
$PX_CLI_RUNNER $PX_CLI task show <id>              # Full details
$PX_CLI_RUNNER $PX_CLI task list --parent <id>     # List children
$PX_CLI_RUNNER $PX_CLI task start <id>             # Claim work
$PX_CLI_RUNNER $PX_CLI task complete <id>          # Mark done
$PX_CLI_RUNNER $PX_CLI epic complete <id>          # Mark epic done
$PX_CLI_RUNNER $PX_CLI idea create --title <title> --description <desc> [--repo-id <uuid>]   # Suggest backlog item
\`\`\`

### Rules
- Use \`task start\` when beginning work on a task
- Use \`task complete\` after work is tested, committed, and pushed
- Complete leaf tasks → group tasks → epic (bottom-up)
- Use \`idea create\` for backlog items and future suggestions — not for work being done now`;

/** Lazy — evaluated after config is initialized, not at import time. */
const getExecEnv = () => buildChildEnv();

/**
 * Ensure a repo's shared clone has claude-flow, CLAUDE.md,
 * settings.json, and .mcp.json initialized.
 * Idempotent — safe to call on every session start.
 */
export async function ensureRepoInitialized(
  repoDir: string,
  repoName: string,
): Promise<void> {
  const logger = getLogger();

  let rigInit: RigInitOptions;
  try {
    rigInit = getRigInitOptions(getConfig());
  } catch {
    // Config not initialized (e.g. in tests) — use defaults
    rigInit = { claudeFlow: true, scripts: [] };
  }

  // 0. claude-flow init — skip if already initialized or claudeFlow disabled
  if (rigInit.claudeFlow) {
    const cfConfig = join(repoDir, ".claude-flow", "config.yaml");
    if (!existsSync(cfConfig)) {
      logger.info({ repoDir }, "Initializing claude-flow");
      try {
        execSync("npx -y @claude-flow/cli@latest init --force --yes", {
          cwd: repoDir,
          stdio: "pipe",
          timeout: 60_000,
          env: getExecEnv(),
        });
      } catch (err) {
        logger.warn({ err, repoDir }, "claude-flow init failed (npx may not be available)");
      }
    }
  } else {
    logger.info({ repoDir }, "Skipping claude-flow init (rigInit.claudeFlow=false)");
  }

  // 1. CLAUDE.md tasks section — skip if already present
  const claudeMd = join(repoDir, "CLAUDE.md");
  if (existsSync(claudeMd)) {
    const content = readFileSync(claudeMd, "utf-8");
    if (!content.includes("## Task Tracking (Praxis)")) {
      writeFileSync(claudeMd, content.trimEnd() + "\n\n" + TASKS_CLAUDE_MD_SECTION + "\n");
      logger.info({ repoDir }, "Appended tasks section to CLAUDE.md");
    }
  } else {
    writeFileSync(claudeMd, TASKS_CLAUDE_MD_SECTION + "\n");
    logger.info({ repoDir }, "Created CLAUDE.md with tasks section");
  }

  // 3. .claude/settings.json — create if missing, patch if exists
  const claudeDir = join(repoDir, ".claude");
  const settingsPath = join(claudeDir, "settings.json");

  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  if (existsSync(settingsPath)) {
    try {
      const raw = readFileSync(settingsPath, "utf-8");
      const settings = JSON.parse(raw);

      let changed = false;

      if (!settings.permissions) settings.permissions = {};
      if (!settings.permissions.deny) settings.permissions.deny = [];
      if (!settings.permissions.deny.includes("Read(./.env)")) {
        settings.permissions.deny.push("Read(./.env)");
        changed = true;
      }
      if (!settings.permissions.deny.includes("Read(./.env.*)")) {
        settings.permissions.deny.push("Read(./.env.*)");
        changed = true;
      }

      // Ensure attribution block uses Praxis values
      if (
        !settings.attribution ||
        settings.attribution.commit !== PRAXIS_ATTRIBUTION.commit ||
        settings.attribution.pr !== PRAXIS_ATTRIBUTION.pr
      ) {
        settings.attribution = { ...PRAXIS_ATTRIBUTION };
        changed = true;
      }

      // Remove stale bd references if present
      if (settings.permissions.allow) {
        const bdIdx = settings.permissions.allow.indexOf("Bash(bd *)");
        if (bdIdx !== -1) {
          settings.permissions.allow.splice(bdIdx, 1);
          changed = true;
        }
      }
      if (settings.env?.BD_ACTOR) {
        delete settings.env.BD_ACTOR;
        changed = true;
      }

      if (changed) {
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
        logger.info({ repoDir }, "Patched .claude/settings.json");
      }
    } catch (err) {
      logger.warn({ err, repoDir }, "Failed to patch settings.json, will overwrite");
      writeDefaultSettings(settingsPath);
    }
  } else {
    writeDefaultSettings(settingsPath);
    logger.info({ repoDir }, "Created .claude/settings.json");
  }

  // 4. .mcp.json — ensure claude-flow MCP server is registered (claude-flow only)
  if (rigInit.claudeFlow) {
    const mcpJsonPath = join(repoDir, ".mcp.json");
    if (existsSync(mcpJsonPath)) {
      try {
        const raw = readFileSync(mcpJsonPath, "utf-8");
        const mcp = JSON.parse(raw);
        if (!mcp.mcpServers?.["claude-flow"]) {
          if (!mcp.mcpServers) mcp.mcpServers = {};
          mcp.mcpServers["claude-flow"] = {
            command: "npx",
            args: ["-y", "@claude-flow/cli@latest"],
          };
          writeFileSync(mcpJsonPath, JSON.stringify(mcp, null, 2) + "\n");
          logger.info({ repoDir }, "Patched .mcp.json with claude-flow");
        }
      } catch (err) {
        logger.warn({ err, repoDir }, "Failed to patch .mcp.json");
      }
    } else {
      const mcp = {
        mcpServers: {
          "claude-flow": {
            command: "npx",
            args: ["-y", "@claude-flow/cli@latest"],
          },
        },
      };
      writeFileSync(mcpJsonPath, JSON.stringify(mcp, null, 2) + "\n");
      logger.info({ repoDir }, "Created .mcp.json with claude-flow");
    }

    // 5. claude-flow daemon — start if not already running
    try {
      const status = execSync("npx -y @claude-flow/cli@latest daemon status", {
        cwd: repoDir,
        stdio: "pipe",
        timeout: 30_000,
        env: getExecEnv(),
      }).toString();

      if (!status.includes("RUNNING")) {
        logger.info({ repoDir }, "Starting claude-flow daemon");
        execSync("npx -y @claude-flow/cli@latest daemon start", {
          cwd: repoDir,
          stdio: "pipe",
          timeout: 30_000,
          env: getExecEnv(),
        });
        logger.info({ repoDir }, "claude-flow daemon started");
      }
    } catch (err) {
      logger.warn({ err, repoDir }, "claude-flow daemon start failed (non-fatal)");
    }
  } else {
    logger.info({ repoDir }, "Skipping .mcp.json and daemon (rigInit.claudeFlow=false)");
  }

  // 6. Run custom rigInit scripts
  for (const rawScript of rigInit.scripts) {
    const script = rawScript.startsWith("~/")
      ? join(homedir(), rawScript.slice(2))
      : rawScript;

    if (!script.startsWith("/")) {
      logger.warn({ script, repoDir }, "Skipping rigInit script: path must be absolute");
      continue;
    }

    try {
      logger.info({ script, repoDir }, "Running rigInit script");
      execSync(script, {
        cwd: repoDir,
        stdio: "pipe",
        timeout: 60_000,
        env: getExecEnv(),
      });
      logger.info({ script, repoDir }, "rigInit script completed");
    } catch (err) {
      logger.warn({ err, script, repoDir }, "rigInit script failed (non-fatal)");
    }
  }
}

const PRAXIS_ATTRIBUTION = {
  commit: "Co-Authored-By: praxis <praxisworksapp@gmail.com>",
  pr: "Generated with [praxis](https://prax.work)",
};

function writeDefaultSettings(settingsPath: string): void {
  const settings = {
    permissions: {
      deny: ["Read(./.env)", "Read(./.env.*)"],
    },
    attribution: { ...PRAXIS_ATTRIBUTION },
  };
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}
