import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { getConfig } from "../config.js";
import { getLogger } from "../logger.js";

/**
 * Workspace Manager
 *
 * Manages git clones and worktrees for repo sessions.
 *
 * Directory layout under WORKSPACE_ROOT:
 *   <repo-id>/
 *     repo/              ← shared bare clone (or regular clone kept on main)
 *     sessions/
 *       <session-id>/    ← git worktree per working session
 *
 * Two modes:
 * 1. Shared (architect/spec/debug): uses the shared clone, pulled to latest main.
 *    Claude Code can read the codebase but sessions don't commit to it.
 *
 * 2. Per-session (working): creates a git worktree from the shared clone.
 *    Claude Code writes code in the worktree. Changes can be committed/pushed.
 */

function getRepoBaseDir(repoId: string): string {
  const config = getConfig();
  return join(config.WORKSPACE_ROOT, repoId);
}

/**
 * Normalize a git URL. Handles:
 * - Full HTTPS URLs (returned as-is)
 * - Full SSH URLs (returned as-is)
 * - GitHub shorthand "owner/repo" (expanded to HTTPS)
 *
 * If GH_TOKEN is set in the environment, uses authenticated HTTPS.
 */
function normalizeGitUrl(gitUrl: string): string {
  // Already a full URL
  if (gitUrl.startsWith("https://") || gitUrl.startsWith("http://") || gitUrl.startsWith("git@")) {
    return gitUrl;
  }

  // GitHub shorthand: "owner/repo" → SSH
  return `git@github.com:${gitUrl}.git`;
}

function getRepoCloneDir(repoId: string): string {
  return join(getRepoBaseDir(repoId), "repo");
}

function getSessionDir(repoId: string, sessionId: string): string {
  return join(getRepoBaseDir(repoId), "sessions", sessionId);
}

export interface SharedCloneResult {
  repoDir: string;
  warning?: string;
}

/**
 * Ensure the shared repo clone exists for a repo.
 * If not cloned yet, clones from the git URL.
 * If already cloned, fetches and hard-resets to origin/main.
 *
 * Returns { repoDir, warning? }. When git operations fail the warning
 * contains a human-readable message and repoDir still points to the
 * existing clone so the session can proceed on potentially stale code.
 */
export function ensureSharedClone(repoId: string, gitUrl: string): SharedCloneResult {
  const logger = getLogger();
  const repoDir = getRepoCloneDir(repoId);
  const cloneUrl = normalizeGitUrl(gitUrl);

  if (!existsSync(repoDir)) {
    logger.info({ repoId, gitUrl: gitUrl.replace(/\/\/[^@]+@/, "//***@") }, "Cloning repo");
    // Clone into {repoId}/repo. The base dir must exist; git creates the
    // target subdirectory itself. Do NOT pre-mkdir the target — doing so
    // would make `git clone <url> repo` create a nested
    // {repoId}/repo/repo/.git instead, leaving {repoId}/repo as an empty
    // non-git directory and breaking every subsequent git operation.
    mkdirSync(getRepoBaseDir(repoId), { recursive: true });
    execSync(`git clone ${cloneUrl} repo`, {
      cwd: getRepoBaseDir(repoId),
      stdio: "pipe",
      timeout: 120_000,
    });
    return { repoDir };
  }

  logger.info({ repoId }, "Fetching latest from origin");
  try {
    execSync("git fetch origin", {
      cwd: repoDir,
      stdio: "pipe",
      timeout: 60_000,
    });
    // Update local main ref without checking it out.
    // `git checkout main` fails when any worktree already has main checked out,
    // so we update the ref directly and base new worktrees on origin/main.
    try {
      execSync("git update-ref refs/heads/main refs/remotes/origin/main", {
        cwd: repoDir,
        stdio: "pipe",
        timeout: 15_000,
      });
    } catch {
      // If main ref doesn't exist locally yet or is checked out here, that's fine —
      // worktrees will be created from origin/main directly.
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ repoId, err }, "Failed to fetch latest, using existing state");
    return { repoDir, warning: message };
  }

  return { repoDir };
}

/**
 * Get the shared repo path for read-only sessions (architect/spec/debug).
 * Ensures it's cloned and up-to-date.
 */
export function getSharedWorkspace(repoId: string, gitUrl: string): SharedCloneResult {
  return ensureSharedClone(repoId, gitUrl);
}

/**
 * Create an isolated worktree for a working session.
 * The worktree branches from the current HEAD of the shared clone.
 *
 * Returns { sessionDir, warning? } — warning is set when the pull failed.
 */
export function createSessionWorktree(
  repoId: string,
  sessionId: string,
  gitUrl: string,
): SessionWorkspaceResult {
  const logger = getLogger();

  // Ensure shared clone is up-to-date first
  const { repoDir, warning: pullWarning } = ensureSharedClone(repoId, gitUrl);

  const sessionDir = getSessionDir(repoId, sessionId);
  const branchName = `session/${sessionId}`;

  logger.info({ repoId, sessionId, branchName }, "Creating session worktree");

  const sessionsParent = join(getRepoBaseDir(repoId), "sessions");
  mkdirSync(sessionsParent, { recursive: true });

  // If worktree already exists (previous failed attempt), reuse it
  if (existsSync(sessionDir)) {
    logger.info({ repoId, sessionId }, "Worktree already exists, reusing");
    return { workDir: sessionDir, warning: pullWarning };
  }

  // Clean up stale branch from a previous failed attempt before creating
  try {
    execSync(`git branch -D ${branchName}`, {
      cwd: repoDir,
      stdio: "pipe",
      timeout: 5_000,
    });
    logger.info({ repoId, sessionId }, "Deleted stale session branch from previous attempt");
  } catch {
    // Branch doesn't exist — expected on first attempt
  }

  // Base the worktree on origin/main so sessions always start from the latest
  // remote state, regardless of what branch the shared clone has checked out.
  execSync(`git worktree add ${sessionDir} -b ${branchName} origin/main`, {
    cwd: repoDir,
    stdio: "pipe",
    timeout: 30_000,
  });

  // NOTE: .tasks/ is not used. Task context is embedded directly in prompts
  // and tracked via `px` CLI commands that read/write Postgres.

  // Symlink .claude/settings.json so permissions carry over
  const settingsInRepo = join(repoDir, ".claude", "settings.json");
  const claudeDirInWorktree = join(sessionDir, ".claude");
  const settingsInWorktree = join(claudeDirInWorktree, "settings.json");
  if (existsSync(settingsInRepo) && !existsSync(settingsInWorktree)) {
    mkdirSync(claudeDirInWorktree, { recursive: true });
    symlinkSync(settingsInRepo, settingsInWorktree);
    logger.info({ repoId, sessionId }, "Symlinked .claude/settings.json into worktree");
  }

  // Symlink .mcp.json so claude-flow MCP server is available in worktrees
  const mcpInRepo = join(repoDir, ".mcp.json");
  const mcpInWorktree = join(sessionDir, ".mcp.json");
  if (existsSync(mcpInRepo) && !existsSync(mcpInWorktree)) {
    symlinkSync(mcpInRepo, mcpInWorktree);
    logger.info({ repoId, sessionId }, "Symlinked .mcp.json into worktree");
  }

  return { workDir: sessionDir, warning: pullWarning };
}

/**
 * Remove a session's worktree after the session ends.
 * Prunes the worktree reference from the shared clone.
 */
export function removeSessionWorktree(
  repoId: string,
  sessionId: string,
): void {
  const logger = getLogger();
  const sessionDir = getSessionDir(repoId, sessionId);
  const repoDir = getRepoCloneDir(repoId);

  if (!existsSync(sessionDir)) {
    return;
  }

  logger.info({ repoId, sessionId }, "Removing session worktree");

  try {
    execSync(`git worktree remove ${sessionDir} --force`, {
      cwd: repoDir,
      stdio: "pipe",
      timeout: 15_000,
    });
  } catch {
    // Fallback: just remove the directory and prune
    rmSync(sessionDir, { recursive: true, force: true });
    try {
      execSync("git worktree prune", {
        cwd: repoDir,
        stdio: "pipe",
        timeout: 10_000,
      });
    } catch {
      // Best effort
    }
  }
}

export interface SessionWorkspaceResult {
  workDir: string;
  warning?: string;
}

/**
 * Get the workspace path for a session based on its type.
 * - Non-mutating (architect/spec/debug): shared clone
 * - Mutating (working): per-session worktree
 *
 * If the repo has no gitUrl, falls back to WORKSPACE_ROOT.
 */
export function getSessionWorkspace(
  repoId: string,
  sessionId: string,
  sessionType: string,
  gitUrl: string | null,
): SessionWorkspaceResult {
  const logger = getLogger();

  if (!gitUrl) {
    return { workDir: getConfig().WORKSPACE_ROOT };
  }

  try {
    if (sessionType === "working" || sessionType === "repo") {
      return createSessionWorktree(repoId, sessionId, gitUrl);
    }
    const result = getSharedWorkspace(repoId, gitUrl);
    return { workDir: result.repoDir, warning: result.warning };
  } catch (err) {
    logger.warn(
      { repoId, sessionId, gitUrl, err },
      "Failed to set up git workspace, falling back to WORKSPACE_ROOT",
    );
    return { workDir: getConfig().WORKSPACE_ROOT };
  }
}
