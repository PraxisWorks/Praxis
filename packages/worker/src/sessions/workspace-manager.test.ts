import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock("../logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("../config.js", () => ({
  getConfig: () => ({
    WORKSPACE_ROOT: "/tmp/workspaces",
  }),
}));

const mockExecSync = vi.fn();
vi.mock("node:child_process", () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

const mockExistsSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockRmSync = vi.fn();
const mockSymlinkSync = vi.fn();
vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  rmSync: (...args: unknown[]) => mockRmSync(...args),
  symlinkSync: (...args: unknown[]) => mockSymlinkSync(...args),
}));

// ─── Import after mocks ─────────────────────────────────────────────

import { ensureSharedClone, getSessionWorkspace, createSessionWorktree } from "./workspace-manager.js";

// ─── Helpers ────────────────────────────────────────────────────────

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

// ─── Tests: ensureSharedClone ───────────────────────────────────────

describe("ensureSharedClone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clones fresh when repo does not exist", () => {
    setupExistsSync({ repo: false });

    const result = ensureSharedClone("rig-1", "owner/repo");

    expect(result.repoDir).toContain("rig-1/repo");
    expect(result.warning).toBeUndefined();
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining("git clone"),
      expect.objectContaining({ timeout: 120_000 }),
    );
  });

  it("fetches and updates ref when repo already exists", () => {
    setupExistsSync({ repo: true });

    const result = ensureSharedClone("rig-1", "owner/repo");

    expect(result.repoDir).toContain("rig-1/repo");
    expect(result.warning).toBeUndefined();

    // Verify: fetch + update-ref (no checkout needed)
    const commands = mockExecSync.mock.calls.map((c: unknown[]) => c[0]);
    expect(commands).toEqual([
      "git fetch origin",
      "git update-ref refs/heads/main refs/remotes/origin/main",
    ]);
  });

  it("returns warning when git operations fail (pull failure)", () => {
    setupExistsSync({ repo: true });
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "git fetch origin") {
        throw new Error("Could not resolve host");
      }
      return Buffer.from("");
    });

    const result = ensureSharedClone("rig-1", "owner/repo");

    expect(result.repoDir).toContain("rig-1/repo");
    expect(result.warning).toBe("Could not resolve host");
  });

  it("succeeds even when update-ref fails (worktrees use origin/main directly)", () => {
    setupExistsSync({ repo: true });
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.startsWith("git update-ref")) {
        throw new Error("cannot lock ref");
      }
      return Buffer.from("");
    });

    const result = ensureSharedClone("rig-1", "owner/repo");

    expect(result.repoDir).toContain("rig-1/repo");
    // update-ref failure is silently swallowed — not a warning
    expect(result.warning).toBeUndefined();
  });

  it("does not return warning on fresh clone", () => {
    setupExistsSync({ repo: false });

    const result = ensureSharedClone("rig-1", "https://github.com/owner/repo.git");

    expect(result.warning).toBeUndefined();
    expect(mockExecSync).toHaveBeenCalledTimes(1); // Only the clone
  });

  it("runs `git clone <url> repo` from the base dir (not the target dir)", () => {
    // Regression: a previous bug pre-mkdir'd the target {repoId}/repo and
    // then ran `git clone <url> repo` with cwd={repoId}/repo, which made
    // git create a nested {repoId}/repo/repo/.git. The function returned
    // {repoId}/repo, which had no .git, so every subsequent git operation
    // ("git fetch origin" / "git worktree add") failed with "not a git
    // repository" and the session silently fell back to WORKSPACE_ROOT.
    //
    // This test pins the correct behavior: clone runs with cwd =
    // {repoId} (the base dir), with target "repo", so .git lands at
    // {repoId}/repo/.git as the rest of the workspace manager expects.
    setupExistsSync({ repo: false });

    ensureSharedClone("rig-1", "owner/repo");

    const cloneCall = mockExecSync.mock.calls.find(
      ([cmd]) => typeof cmd === "string" && cmd.includes("git clone"),
    );
    expect(cloneCall).toBeDefined();
    const [cmd, opts] = cloneCall as [string, { cwd: string }];
    // Command should target "repo" subdir, not a full path
    expect(cmd).toContain(" repo");
    // cwd must be the base dir {repoId}, NOT the target {repoId}/repo
    expect(opts.cwd).toMatch(/\/rig-1$/);
    expect(opts.cwd).not.toMatch(/\/rig-1\/repo$/);
  });
});

// ─── Tests: getSessionWorkspace ─────────────────────────────────────

describe("getSessionWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns WORKSPACE_ROOT with no warning when gitUrl is null", () => {
    const result = getSessionWorkspace("rig-1", "s1", "working", null);

    expect(result.workDir).toBe("/tmp/workspaces");
    expect(result.warning).toBeUndefined();
  });

  it("propagates warning from shared workspace for spec sessions", () => {
    setupExistsSync({ repo: true });
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "git fetch origin") {
        throw new Error("Network unreachable");
      }
      return Buffer.from("");
    });

    const result = getSessionWorkspace("rig-1", "s1", "spec", "owner/repo");

    expect(result.workDir).toContain("rig-1/repo");
    expect(result.warning).toBe("Network unreachable");
  });

  it("falls back to WORKSPACE_ROOT on fatal error", () => {
    setupExistsSync({ repo: false });
    mockExecSync.mockImplementation(() => {
      throw new Error("Permission denied");
    });

    const result = getSessionWorkspace("rig-1", "s1", "spec", "owner/repo");

    expect(result.workDir).toBe("/tmp/workspaces");
    expect(result.warning).toBeUndefined();
  });
});

// ─── Tests: createSessionWorktree ───────────────────────────────────

describe("createSessionWorktree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("propagates pull warning through worktree creation", () => {
    // repo exists, but fetch fails → warning; worktree dir does not exist
    mockExistsSync.mockImplementation((path: string) => {
      if (path.includes("repo")) return true;
      // sessionDir, settings, mcp don't exist
      return false;
    });

    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "git fetch origin") {
        throw new Error("Timeout fetching");
      }
      return Buffer.from("");
    });

    const result = createSessionWorktree("rig-1", "s1", "owner/repo");

    expect(result.workDir).toContain("sessions/s1");
    expect(result.warning).toBe("Timeout fetching");
  });

  it("returns no warning on successful pull and worktree creation", () => {
    mockExistsSync.mockImplementation((path: string) => {
      if (path.includes("repo")) return true;
      return false;
    });
    mockExecSync.mockReturnValue(Buffer.from(""));

    const result = createSessionWorktree("rig-1", "s1", "owner/repo");

    expect(result.workDir).toContain("sessions/s1");
    expect(result.warning).toBeUndefined();
  });

  it("reuses existing worktree and still propagates warning", () => {
    mockExistsSync.mockImplementation((path: string) => {
      // Both repo and session dir exist
      if (path.includes("repo") || path.includes("sessions/s1")) return true;
      return false;
    });
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "git fetch origin") {
        throw new Error("DNS failure");
      }
      return Buffer.from("");
    });

    const result = createSessionWorktree("rig-1", "s1", "owner/repo");

    expect(result.workDir).toContain("sessions/s1");
    expect(result.warning).toBe("DNS failure");
  });
});
