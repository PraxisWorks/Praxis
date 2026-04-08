import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
vi.mock("../logger.js", () => ({
  getLogger: () => mockLogger,
}));

const mockGetConfig = vi.fn();
const mockGetRigInitOptions = vi.fn();
vi.mock("../config.js", () => ({
  getConfig: () => mockGetConfig(),
  getRigInitOptions: (c: unknown) => mockGetRigInitOptions(c),
}));

const mockExecSync = vi.fn();
vi.mock("node:child_process", () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();
vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
}));

// ─── Import after mocks ─────────────────────────────────────────────

import { ensureRepoInitialized } from "./repo-init.js";

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Configure mockExistsSync to return specific values per path pattern.
 * Falls back to `defaultValue` for unmatched paths.
 */
function setupExistsSync(
  overrides: Record<string, boolean>,
  defaultValue = false,
): void {
  mockExistsSync.mockImplementation((path: string) => {
    for (const [pattern, value] of Object.entries(overrides)) {
      if (path.includes(pattern)) return value;
    }
    return defaultValue;
  });
}

/**
 * Configure mockExecSync to return different values based on command string.
 */
function setupExecSync(
  overrides: Record<string, string | Error> = {},
): void {
  mockExecSync.mockImplementation((cmd: string) => {
    for (const [pattern, result] of Object.entries(overrides)) {
      if (cmd.includes(pattern)) {
        if (result instanceof Error) throw result;
        return Buffer.from(result);
      }
    }
    return Buffer.from("");
  });
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("ensureRepoInitialized", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: claude-flow enabled, no scripts (matches current behavior)
    mockGetConfig.mockReturnValue({});
    mockGetRigInitOptions.mockReturnValue({ claudeFlow: true, scripts: [] });
  });

  describe("daemon management", () => {
    it("starts daemon when status shows STOPPED", async () => {
      setupExistsSync({
        "config.yaml": true,  // claude-flow already initialized
        "CLAUDE.md": true,    // CLAUDE.md exists
        ".claude": true,      // .claude dir exists
        "settings.json": true, // settings.json exists
        ".mcp.json": true,    // .mcp.json exists
      });
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes("CLAUDE.md")) return "## Task Tracking (Praxis)";
        if (path.includes("settings.json")) return JSON.stringify({ permissions: { deny: ["Read(./.env)", "Read(./.env.*)"] } });
        if (path.includes(".mcp.json")) return JSON.stringify({ mcpServers: { "claude-flow": {} } });
        return "";
      });

      setupExecSync({
        "daemon status": "Status: ○ STOPPED",
        "daemon start": "Daemon started",
      });

      await ensureRepoInitialized("/repo", "my-repo");

      // Should check daemon status
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining("daemon status"),
        expect.objectContaining({ cwd: "/repo" }),
      );

      // Should start daemon since it was STOPPED
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining("daemon start"),
        expect.objectContaining({ cwd: "/repo" }),
      );
    });

    it("skips daemon start when already RUNNING", async () => {
      setupExistsSync({
        "config.yaml": true,
        "CLAUDE.md": true,
        ".claude": true,
        "settings.json": true,
        ".mcp.json": true,
      });
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes("CLAUDE.md")) return "## Task Tracking (Praxis)";
        if (path.includes("settings.json")) return JSON.stringify({ permissions: { deny: ["Read(./.env)", "Read(./.env.*)"] } });
        if (path.includes(".mcp.json")) return JSON.stringify({ mcpServers: { "claude-flow": {} } });
        return "";
      });

      setupExecSync({
        "daemon status": "Status: ● RUNNING (background)",
      });

      await ensureRepoInitialized("/repo", "my-repo");

      // Should check status
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining("daemon status"),
        expect.objectContaining({ cwd: "/repo" }),
      );

      // Should NOT start daemon
      expect(mockExecSync).not.toHaveBeenCalledWith(
        expect.stringContaining("daemon start"),
        expect.anything(),
      );
    });

    it("handles daemon start failure as non-fatal", async () => {
      setupExistsSync({
        "config.yaml": true,
        "CLAUDE.md": true,
        ".claude": true,
        "settings.json": true,
        ".mcp.json": true,
      });
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes("CLAUDE.md")) return "## Task Tracking (Praxis)";
        if (path.includes("settings.json")) return JSON.stringify({ permissions: { deny: ["Read(./.env)", "Read(./.env.*)"] } });
        if (path.includes(".mcp.json")) return JSON.stringify({ mcpServers: { "claude-flow": {} } });
        return "";
      });

      setupExecSync({
        "daemon status": new Error("npx not found"),
      });

      // Should NOT throw — daemon failure is non-fatal
      await expect(
        ensureRepoInitialized("/repo", "my-repo"),
      ).resolves.toBeUndefined();
    });
  });

  describe("claude-flow init", () => {
    it("runs claude-flow init when config.yaml is missing", async () => {
      setupExistsSync({
        "config.yaml": false,
        "CLAUDE.md": false,
        ".claude": false,
        "settings.json": false,
        ".mcp.json": false,
      });
      setupExecSync({
        "daemon status": "Status: ● RUNNING (background)",
      });

      await ensureRepoInitialized("/repo", "my-repo");

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining("init --force --yes"),
        expect.objectContaining({ cwd: "/repo" }),
      );
    });

    it("skips claude-flow init when config.yaml exists", async () => {
      setupExistsSync({
        "config.yaml": true,
        "CLAUDE.md": false,
        ".claude": false,
        "settings.json": false,
        ".mcp.json": false,
      });
      setupExecSync({
        "daemon status": "Status: ● RUNNING (background)",
      });

      await ensureRepoInitialized("/repo", "my-repo");

      expect(mockExecSync).not.toHaveBeenCalledWith(
        expect.stringContaining("init --force --yes"),
        expect.anything(),
      );
    });
  });

  describe("CLAUDE.md", () => {
    it("creates CLAUDE.md when missing", async () => {
      setupExistsSync({
        "config.yaml": true,
        "CLAUDE.md": false,
        ".claude": false,
        "settings.json": false,
        ".mcp.json": false,
      });
      setupExecSync({
        "daemon status": "Status: ● RUNNING (background)",
      });

      await ensureRepoInitialized("/repo", "my-repo");

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("CLAUDE.md"),
        expect.stringContaining("## Task Tracking (Praxis)"),
      );
    });

    it("appends tasks section when CLAUDE.md exists without it", async () => {
      setupExistsSync({
        "config.yaml": true,
        "CLAUDE.md": true,
        ".claude": false,
        "settings.json": false,
        ".mcp.json": false,
      });
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes("CLAUDE.md")) return "# My Project\n";
        return "";
      });
      setupExecSync({
        "daemon status": "Status: ● RUNNING (background)",
      });

      await ensureRepoInitialized("/repo", "my-repo");

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("CLAUDE.md"),
        expect.stringContaining("# My Project"),
      );
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("CLAUDE.md"),
        expect.stringContaining("## Task Tracking (Praxis)"),
      );
    });
  });

  describe("attribution", () => {
    it("patches attribution when missing from existing settings.json", async () => {
      setupExistsSync({
        "config.yaml": true,
        "CLAUDE.md": true,
        ".claude": true,
        "settings.json": true,
        ".mcp.json": true,
      });
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes("CLAUDE.md")) return "## Task Tracking (Praxis)";
        if (path.includes("settings.json")) return JSON.stringify({
          permissions: { deny: ["Read(./.env)", "Read(./.env.*)"] },
        });
        if (path.includes(".mcp.json")) return JSON.stringify({ mcpServers: { "claude-flow": {} } });
        return "";
      });
      setupExecSync({ "daemon status": "Status: ● RUNNING (background)" });

      await ensureRepoInitialized("/repo", "my-repo");

      const settingsWrite = mockWriteFileSync.mock.calls.find(
        ([p]: [string]) => p.includes("settings.json"),
      );
      expect(settingsWrite).toBeDefined();
      const written = JSON.parse(settingsWrite![1]);
      expect(written.attribution).toEqual({
        commit: "Co-Authored-By: praxis <praxisworksapp@gmail.com>",
        pr: "Generated with [praxis](https://prax.work)",
      });
    });

    it("overwrites non-Praxis attribution (e.g. claude-flow defaults)", async () => {
      setupExistsSync({
        "config.yaml": true,
        "CLAUDE.md": true,
        ".claude": true,
        "settings.json": true,
        ".mcp.json": true,
      });
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes("CLAUDE.md")) return "## Task Tracking (Praxis)";
        if (path.includes("settings.json")) return JSON.stringify({
          permissions: { deny: ["Read(./.env)", "Read(./.env.*)"] },
          attribution: {
            commit: "Co-Authored-By: claude-flow <ruv@ruv.net>",
            pr: "🤖 Generated with [claude-flow](https://github.com/ruvnet/claude-flow)",
          },
        });
        if (path.includes(".mcp.json")) return JSON.stringify({ mcpServers: { "claude-flow": {} } });
        return "";
      });
      setupExecSync({ "daemon status": "Status: ● RUNNING (background)" });

      await ensureRepoInitialized("/repo", "my-repo");

      const settingsWrite = mockWriteFileSync.mock.calls.find(
        ([p]: [string]) => p.includes("settings.json"),
      );
      expect(settingsWrite).toBeDefined();
      const written = JSON.parse(settingsWrite![1]);
      expect(written.attribution.commit).toBe("Co-Authored-By: praxis <praxisworksapp@gmail.com>");
      expect(written.attribution.pr).toContain("prax.work");
    });

    it("includes attribution in writeDefaultSettings for new projects", async () => {
      setupExistsSync({
        "config.yaml": true,
        "CLAUDE.md": true,
        ".claude": true,
        "settings.json": false,
        ".mcp.json": true,
      });
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes("CLAUDE.md")) return "## Task Tracking (Praxis)";
        if (path.includes(".mcp.json")) return JSON.stringify({ mcpServers: { "claude-flow": {} } });
        return "";
      });
      setupExecSync({ "daemon status": "Status: ● RUNNING (background)" });

      await ensureRepoInitialized("/repo", "my-repo");

      const settingsWrite = mockWriteFileSync.mock.calls.find(
        ([p]: [string]) => p.includes("settings.json"),
      );
      expect(settingsWrite).toBeDefined();
      const written = JSON.parse(settingsWrite![1]);
      expect(written.attribution).toEqual({
        commit: "Co-Authored-By: praxis <praxisworksapp@gmail.com>",
        pr: "Generated with [praxis](https://prax.work)",
      });
    });

    it("does not rewrite settings.json when attribution is already correct", async () => {
      setupExistsSync({
        "config.yaml": true,
        "CLAUDE.md": true,
        ".claude": true,
        "settings.json": true,
        ".mcp.json": true,
      });
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes("CLAUDE.md")) return "## Task Tracking (Praxis)";
        if (path.includes("settings.json")) return JSON.stringify({
          permissions: { deny: ["Read(./.env)", "Read(./.env.*)"] },
          attribution: {
            commit: "Co-Authored-By: praxis <praxisworksapp@gmail.com>",
            pr: "Generated with [praxis](https://prax.work)",
          },
        });
        if (path.includes(".mcp.json")) return JSON.stringify({ mcpServers: { "claude-flow": {} } });
        return "";
      });
      setupExecSync({ "daemon status": "Status: ● RUNNING (background)" });

      await ensureRepoInitialized("/repo", "my-repo");

      const settingsWrite = mockWriteFileSync.mock.calls.find(
        ([p]: [string]) => p.includes("settings.json"),
      );
      expect(settingsWrite).toBeUndefined();
    });
  });

  describe(".mcp.json", () => {
    it("creates .mcp.json with claude-flow when missing", async () => {
      setupExistsSync({
        "config.yaml": true,
        "CLAUDE.md": true,
        ".claude": true,
        "settings.json": true,
        ".mcp.json": false,
      });
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes("CLAUDE.md")) return "## Task Tracking (Praxis)";
        if (path.includes("settings.json")) return JSON.stringify({ permissions: { deny: ["Read(./.env)", "Read(./.env.*)"] } });
        return "";
      });
      setupExecSync({
        "daemon status": "Status: ● RUNNING (background)",
      });

      await ensureRepoInitialized("/repo", "my-repo");

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining(".mcp.json"),
        expect.stringContaining("claude-flow"),
      );
    });
  });

  describe("claudeFlow gating", () => {
    it("skips claude-flow init, .mcp.json, and daemon when claudeFlow=false", async () => {
      mockGetRigInitOptions.mockReturnValue({ claudeFlow: false, scripts: [] });
      setupExistsSync({
        "config.yaml": false,
        "CLAUDE.md": false,
        ".claude": false,
        "settings.json": false,
        ".mcp.json": false,
      });
      setupExecSync({});

      await ensureRepoInitialized("/repo", "my-rig");

      // Step 0 (claude-flow init) should NOT run
      expect(mockExecSync).not.toHaveBeenCalledWith(
        expect.stringContaining("init --force --yes"),
        expect.anything(),
      );

      // Step 4 (.mcp.json) should NOT be written
      const mcpWrite = mockWriteFileSync.mock.calls.find(
        ([p]: [string]) => p.includes(".mcp.json"),
      );
      expect(mcpWrite).toBeUndefined();

      // Step 5 (daemon) should NOT run
      expect(mockExecSync).not.toHaveBeenCalledWith(
        expect.stringContaining("daemon status"),
        expect.anything(),
      );
    });

    it("still runs CLAUDE.md and settings.json when claudeFlow=false", async () => {
      mockGetRigInitOptions.mockReturnValue({ claudeFlow: false, scripts: [] });
      setupExistsSync({
        "config.yaml": false,
        "CLAUDE.md": false,
        ".claude": false,
        "settings.json": false,
        ".mcp.json": false,
      });
      setupExecSync({});

      await ensureRepoInitialized("/repo", "my-rig");

      // Step 1: CLAUDE.md should be created
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("CLAUDE.md"),
        expect.stringContaining("## Task Tracking (Praxis)"),
      );

      // Step 3: settings.json should be created
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("settings.json"),
        expect.any(String),
      );
    });
  });

  describe("custom scripts", () => {
    it("executes scripts with repoDir as cwd", async () => {
      mockGetRigInitOptions.mockReturnValue({
        claudeFlow: false,
        scripts: ["/usr/local/bin/setup.sh"],
      });
      setupExistsSync({
        "CLAUDE.md": true,
        ".claude": true,
        "settings.json": true,
      });
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes("CLAUDE.md")) return "## Task Tracking (Praxis)";
        if (path.includes("settings.json")) return JSON.stringify({
          permissions: { deny: ["Read(./.env)", "Read(./.env.*)"] },
          attribution: {
            commit: "Co-Authored-By: praxis <praxisworksapp@gmail.com>",
            pr: "Generated with [praxis](https://prax.work)",
          },
        });
        return "";
      });
      setupExecSync({});

      await ensureRepoInitialized("/repo", "my-rig");

      expect(mockExecSync).toHaveBeenCalledWith(
        "/usr/local/bin/setup.sh",
        expect.objectContaining({
          cwd: "/repo",
          timeout: 60_000,
          stdio: "pipe",
        }),
      );
    });

    it("handles script failure as non-fatal", async () => {
      mockGetRigInitOptions.mockReturnValue({
        claudeFlow: false,
        scripts: ["/opt/fail.sh"],
      });
      setupExistsSync({
        "CLAUDE.md": true,
        ".claude": true,
        "settings.json": true,
      });
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes("CLAUDE.md")) return "## Task Tracking (Praxis)";
        if (path.includes("settings.json")) return JSON.stringify({
          permissions: { deny: ["Read(./.env)", "Read(./.env.*)"] },
          attribution: {
            commit: "Co-Authored-By: praxis <praxisworksapp@gmail.com>",
            pr: "Generated with [praxis](https://prax.work)",
          },
        });
        return "";
      });
      setupExecSync({
        "/opt/fail.sh": new Error("script failed"),
      });

      await expect(
        ensureRepoInitialized("/repo", "my-rig"),
      ).resolves.toBeUndefined();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ script: "/opt/fail.sh" }),
        "rigInit script failed (non-fatal)",
      );
    });

    it("expands ~ in script paths to homedir", async () => {
      mockGetRigInitOptions.mockReturnValue({
        claudeFlow: false,
        scripts: ["~/scripts/init.sh"],
      });
      setupExistsSync({
        "CLAUDE.md": true,
        ".claude": true,
        "settings.json": true,
      });
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes("CLAUDE.md")) return "## Task Tracking (Praxis)";
        if (path.includes("settings.json")) return JSON.stringify({
          permissions: { deny: ["Read(./.env)", "Read(./.env.*)"] },
          attribution: {
            commit: "Co-Authored-By: praxis <praxisworksapp@gmail.com>",
            pr: "Generated with [praxis](https://prax.work)",
          },
        });
        return "";
      });
      setupExecSync({});

      await ensureRepoInitialized("/repo", "my-rig");

      // The resolved path should start with homedir, not ~/
      const scriptCall = mockExecSync.mock.calls.find(
        ([cmd]: [string]) => cmd.includes("scripts/init.sh"),
      );
      expect(scriptCall).toBeDefined();
      expect(scriptCall![0]).not.toContain("~");
      expect(scriptCall![0]).toMatch(/^\/.*\/scripts\/init\.sh$/);
    });

    it("rejects relative script paths with a warning", async () => {
      mockGetRigInitOptions.mockReturnValue({
        claudeFlow: false,
        scripts: ["relative/script.sh"],
      });
      setupExistsSync({
        "CLAUDE.md": true,
        ".claude": true,
        "settings.json": true,
      });
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes("CLAUDE.md")) return "## Task Tracking (Praxis)";
        if (path.includes("settings.json")) return JSON.stringify({
          permissions: { deny: ["Read(./.env)", "Read(./.env.*)"] },
          attribution: {
            commit: "Co-Authored-By: praxis <praxisworksapp@gmail.com>",
            pr: "Generated with [praxis](https://prax.work)",
          },
        });
        return "";
      });
      setupExecSync({});

      await ensureRepoInitialized("/repo", "my-rig");

      // Should NOT execute the relative path
      expect(mockExecSync).not.toHaveBeenCalledWith(
        "relative/script.sh",
        expect.anything(),
      );

      // Should log a warning
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ script: "relative/script.sh" }),
        "Skipping rigInit script: path must be absolute",
      );
    });

    it("defaults to current behavior when rigInit is undefined", async () => {
      // Default mock already returns claudeFlow: true, scripts: []
      setupExistsSync({
        "config.yaml": false,
        "CLAUDE.md": false,
        ".claude": false,
        "settings.json": false,
        ".mcp.json": false,
      });
      setupExecSync({
        "daemon status": "Status: ● RUNNING (background)",
      });

      await ensureRepoInitialized("/repo", "my-rig");

      // claude-flow init should run (config.yaml missing)
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining("init --force --yes"),
        expect.objectContaining({ cwd: "/repo" }),
      );

      // .mcp.json should be created
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining(".mcp.json"),
        expect.stringContaining("claude-flow"),
      );
    });
  });
});
