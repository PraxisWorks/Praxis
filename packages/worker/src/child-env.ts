import { getConfig } from "./config.js";

/**
 * Builds a PATH string for child processes, prepending common binary
 * directories and the optional CLAUDE_BIN_DIR config so that `claude`,
 * `gh`, `git`, `npx` etc. are discoverable on both macOS and Linux.
 */
export function buildChildPath(): string {
  let claudeBinDir: string | undefined;
  try {
    claudeBinDir = getConfig().CLAUDE_BIN_DIR;
  } catch {
    // Config may not be initialized yet in tests
  }

  const extra = [
    claudeBinDir,
    "/opt/homebrew/bin",                      // macOS Homebrew
    "/usr/local/bin",                         // common global installs
    `${process.env.HOME}/.local/bin`,         // pipx / user-local
    `${process.env.HOME}/.npm-global/bin`,    // npm global (custom prefix)
  ].filter(Boolean);

  return [...extra, process.env.PATH].join(":");
}

/**
 * Returns a base env object suitable for spawning child processes.
 * Merges process.env with the corrected PATH.
 */
export function buildChildEnv(extra?: Record<string, string>): Record<string, string | undefined> {
  return {
    ...process.env,
    ...(extra ?? {}),
    PATH: buildChildPath(),
  };
}
