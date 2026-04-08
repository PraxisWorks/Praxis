/**
 * Permission scoping for session types.
 *
 * Non-working sessions use --permission-mode dontAsk --allowedTools to restrict
 * what the Claude CLI can do. Working sessions keep --dangerously-skip-permissions
 * since they need full tool access.
 */

type SessionType = "spec" | "architecture" | "debug" | "working" | "repo";

/**
 * Returns the CLI args array for permissions based on session type.
 *
 * - spec/architecture: read-only + write to .praxis/** + bash
 * - debug/working: full access via --dangerously-skip-permissions
 */
export function getPermissionArgs(type: SessionType): string[] {
  if (type === "working" || type === "debug" || type === "repo") {
    return ["--dangerously-skip-permissions"];
  }

  const tools = getAllowedTools(type);
  // Pass each tool as a separate variadic arg — comma-joined strings break
  // Bash(pattern) entries that contain spaces (the CLI splits on both commas
  // and spaces when they appear in a single string).
  return ["--permission-mode", "dontAsk", "--allowedTools", ...tools];
}

export function getAllowedTools(type: SessionType): string[] {
  const readOnly = ["Read", "Glob", "Grep"];
  const praxisWrite = ["Write(.praxis/**)", "Edit(.praxis/**)"];
  switch (type) {
    case "spec":
      return [...readOnly, ...praxisWrite, "Bash"];
    case "architecture":
      return [...readOnly, ...praxisWrite, "Bash"];
    case "debug":
    case "working":
    case "repo":
      return []; // full access via --dangerously-skip-permissions
  }
}
