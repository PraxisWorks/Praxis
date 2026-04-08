import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerRepoCreateHandler, executeCommand } from "./repo-create.js";
import { EventEmitter } from "node:events";

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock("../logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mutable config so tests can simulate "no template configured anywhere"
// scenarios. Reset in beforeEach below.
const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    GH_ORG: "test-org" as string | undefined,
    TEMPLATE_REPO: "trpc-template" as string | undefined,
    WORKSPACE_ROOT: "/tmp/workspaces",
  },
}));

vi.mock("../config.js", () => ({
  getConfig: () => mockConfig,
}));

vi.mock("@praxis2/api/schema", () => ({
  rigs: { id: "rigs.id" },
  organizations: { id: "organizations.id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
}));

vi.mock("@praxis2/shared", () => ({
  REPO_CREATE: "repo.create",
  syncChannel: (entity: string) => `sync:${entity}`,
}));

const mockExistsSync = vi.fn();
const mockRmSync = vi.fn();
const mockMkdirSync = vi.fn();
vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  rmSync: (...args: unknown[]) => mockRmSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
}));

const mockSpawn = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// ─── DB mock via getDb() ───────────────────────────────────────────

let mockDb: ReturnType<typeof buildMockDb>;

vi.mock("../db.js", () => ({
  getDb: () => mockDb,
}));

// ─── Helpers ────────────────────────────────────────────────────────

function buildMockConnection() {
  let capturedHandler: ((job: { id: string; data: unknown }) => Promise<void>) | null = null;

  return {
    onJob: vi.fn().mockImplementation(
      (_queueName: string, handler: (job: { id: string; data: unknown }) => Promise<void>) => {
        capturedHandler = handler;
        return Promise.resolve();
      },
    ),
    publishSync: vi.fn().mockResolvedValue(undefined),
    getHandler: () => capturedHandler,
  };
}

function createMockChildProcess(exitCode = 0, stdoutData = "", stderrData = "", autoClose = true) {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = vi.fn();

  if (autoClose) {
    // Emit data and close on next tick so the promise can attach listeners
    process.nextTick(() => {
      if (stdoutData) child.stdout.emit("data", Buffer.from(stdoutData));
      if (stderrData) child.stderr.emit("data", Buffer.from(stderrData));
      child.emit("close", exitCode);
    });
  }

  return child;
}

/** Returns a factory that creates a fresh mock child process on each spawn call */
function mockSpawnFactory(exitCode = 0, stdoutData = "", stderrData = "") {
  return () => createMockChildProcess(exitCode, stdoutData, stderrData);
}

const REPO_ROW = {
  id: "repo-1",
  name: "my-app",
  repo: null,
  status: "creating",
  userId: "user-1",
  orgId: "org-1",
  bdPrefix: "MA",
  color: "#6366f1",
  description: null,
  workspacePath: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const ORG_ROW = {
  id: "org-1",
  templateRepo: null,
  // Explicitly set an init script so tests exercise the init path. The
  // production default is [] (no scripts) as of the bring-your-own-template
  // refactor — templates that want a post-clone script opt in at the org
  // level.
  initScripts: ["./scripts/init.sh"],
};

function buildMockDb(selectResult: unknown[] = [REPO_ROW]) {
  let selectCallCount = 0;
  const selectLimit = vi.fn().mockImplementation(() => {
    selectCallCount++;
    return Promise.resolve(selectCallCount <= 1 ? selectResult : [ORG_ROW]);
  });
  const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });

  const updateReturning = vi.fn().mockResolvedValue([{ ...REPO_ROW, status: "active", repo: "test-org/my-app" }]);
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

  return {
    select: vi.fn().mockReturnValue({ from: selectFrom }),
    update: vi.fn().mockReturnValue({ set: updateSet }),
    _selectLimit: selectLimit,
    _updateSet: updateSet,
    _updateWhere: updateWhere,
    _updateReturning: updateReturning,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("executeCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves with output on success", async () => {
    mockSpawn.mockImplementation(mockSpawnFactory(0, "hello\n"));

    const result = await executeCommand("echo", ["hello"], { cwd: "/tmp" });

    expect(result).toEqual({
      success: true,
      output: "hello",
      error: undefined,
      exitCode: 0,
    });
    expect(mockSpawn).toHaveBeenCalledWith("echo", ["hello"], expect.objectContaining({ cwd: "/tmp" }));
  });

  it("rejects with error on non-zero exit", async () => {
    mockSpawn.mockImplementation(mockSpawnFactory(1, "", "bad thing\n"));

    await expect(
      executeCommand("fail", [], { cwd: "/tmp", label: "fail" }),
    ).rejects.toThrow("fail exited with code 1");
  });

  it("rejects on spawn error", async () => {
    const child = createMockChildProcess(0, "", "", false);
    mockSpawn.mockReturnValue(child);
    process.nextTick(() => child.emit("error", new Error("ENOENT")));

    await expect(
      executeCommand("missing", [], { cwd: "/tmp" }),
    ).rejects.toThrow("ENOENT");
  });
});

describe("repo-create handler", () => {
  let connection: ReturnType<typeof buildMockConnection>;

  beforeEach(() => {
    vi.clearAllMocks();
    connection = buildMockConnection();
    mockDb = buildMockDb();
    mockExistsSync.mockReturnValue(true); // init scripts exist
    // Reset mockConfig defaults in case a prior test mutated it
    mockConfig.GH_ORG = "test-org";
    mockConfig.TEMPLATE_REPO = "trpc-template";
    // Default: all commands succeed. The gh-poll command returns a commit sha.
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === "api" && args[1]?.includes("/commits")) {
        return createMockChildProcess(0, "abc123\n");
      }
      return createMockChildProcess(0);
    });
  });

  it("registers a handler on the repo.create queue", async () => {
    await registerRepoCreateHandler(connection as any, "repo.create");

    expect(connection.onJob).toHaveBeenCalledWith("repo.create", expect.any(Function));
  });

  it("creates repo, runs init.sh, updates repo to active", async () => {
    await registerRepoCreateHandler(connection as any, "repo.create");
    const handler = connection.getHandler()!;

    await handler({ id: "job-1", data: { repoId: "repo-1" } });

    // Should spawn gh repo create from inside the canonical {repoId}
    // base dir so the clone target lands in {repoId}/repo
    expect(mockSpawn).toHaveBeenCalledWith(
      "gh",
      ["repo", "create", "test-org/my-app", "--template", "test-org/trpc-template", "--private"],
      expect.objectContaining({ cwd: "/tmp/workspaces/repo-1" }),
    );

    // Should poll for repo readiness (commits endpoint)
    expect(mockSpawn).toHaveBeenCalledWith(
      "gh",
      ["api", "repos/test-org/my-app/commits", "--jq", ".[0].sha"],
      expect.anything(),
    );

    // Should clone via SSH into the canonical {repoId}/repo path
    expect(mockSpawn).toHaveBeenCalledWith(
      "git",
      ["clone", "git@github.com:test-org/my-app.git", "repo"],
      expect.objectContaining({ cwd: "/tmp/workspaces/repo-1" }),
    );

    // Should spawn the template's init.sh from inside the cloned repo
    expect(mockSpawn).toHaveBeenCalledWith(
      "./scripts/init.sh",
      ["my-app"],
      expect.objectContaining({ cwd: "/tmp/workspaces/repo-1/repo" }),
    );

    // Should update repo with repo + workspace + active status
    expect(mockDb._updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: "test-org/my-app",
        workspacePath: "/tmp/workspaces/repo-1/repo",
        status: "active",
      }),
    );

    // Should publish sync event
    expect(connection.publishSync).toHaveBeenCalledWith(
      "sync:repo",
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("throws if repo not found in DB", async () => {
    mockDb = buildMockDb([]); // empty select result
    await registerRepoCreateHandler(connection as any, "repo.create");
    const handler = connection.getHandler()!;

    await expect(
      handler({ id: "job-1", data: { repoId: "repo-1" } }),
    ).rejects.toThrow("Repo repo-1 not found");
  });

  it("skips missing init scripts with a warning instead of failing the job", async () => {
    // Template exists (gh repo create / clone succeed) but the init script
    // file doesn't exist in the cloned template.
    mockExistsSync.mockImplementation((p: string) => !String(p).endsWith("init.sh"));

    await registerRepoCreateHandler(connection as any, "repo.create");
    const handler = connection.getHandler()!;

    // Job should complete successfully — missing script is non-fatal
    await handler({ id: "job-1", data: { repoId: "repo-1" } });

    // init.sh should NOT have been spawned
    expect(mockSpawn).not.toHaveBeenCalledWith(
      "./scripts/init.sh",
      expect.anything(),
      expect.anything(),
    );

    // Repo should still transition to active
    expect(mockDb._updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active" }),
    );
  });

  it("clones existing repo without template when repo.repo is set (+Add)", async () => {
    const EXISTING_REPO = { ...REPO_ROW, repo: "some-org/existing-project" };
    mockDb = buildMockDb([EXISTING_REPO]);

    await registerRepoCreateHandler(connection as any, "repo.create");
    const handler = connection.getHandler()!;

    await handler({ id: "job-1", data: { repoId: "repo-1" } });

    // Should NOT create repo from template
    expect(mockSpawn).not.toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["repo", "create"]),
      expect.anything(),
    );

    // Should NOT poll for template readiness
    expect(mockSpawn).not.toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["api"]),
      expect.anything(),
    );

    // Should clone the existing repo via SSH into {repoId}/repo
    expect(mockSpawn).toHaveBeenCalledWith(
      "git",
      ["clone", "git@github.com:some-org/existing-project.git", "repo"],
      expect.objectContaining({ cwd: "/tmp/workspaces/repo-1" }),
    );

    // Should NOT run init.sh (existing repo, not from template)
    expect(mockSpawn).not.toHaveBeenCalledWith(
      expect.stringContaining("init.sh"),
      expect.anything(),
      expect.anything(),
    );

    // Should update repo with the existing repo nwo
    expect(mockDb._updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: "some-org/existing-project",
        workspacePath: "/tmp/workspaces/repo-1/repo",
        status: "active",
      }),
    );
  });

  it("+Add succeeds when no template is configured anywhere (regression)", async () => {
    // Simulate the exact bug: user clicks +Add to connect an existing repo,
    // but neither the org nor the worker env has a template configured.
    // The pre-fix code threw "No template configured" before the +Add/+New
    // branch split, causing +Add to fail even though it doesn't need a
    // template at all.
    mockConfig.GH_ORG = undefined;
    mockConfig.TEMPLATE_REPO = undefined;
    const EXISTING_REPO = { ...REPO_ROW, repo: "some-org/existing-project" };
    mockDb = buildMockDb([EXISTING_REPO]);

    await registerRepoCreateHandler(connection as any, "repo.create");
    const handler = connection.getHandler()!;

    // Should not throw
    await handler({ id: "job-1", data: { repoId: "repo-1" } });

    // Should clone the existing repo via SSH into the canonical layout
    expect(mockSpawn).toHaveBeenCalledWith(
      "git",
      ["clone", "git@github.com:some-org/existing-project.git", "repo"],
      expect.objectContaining({ cwd: "/tmp/workspaces/repo-1" }),
    );

    // Should update repo to active without ever looking at templates
    expect(mockDb._updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active" }),
    );
  });

  it("+New still throws a clear error when no template is configured", async () => {
    // The flip side of the above test: +New legitimately needs a template,
    // so it should still fail with the "No template configured" error when
    // neither org nor worker env has one.
    mockConfig.GH_ORG = undefined;
    mockConfig.TEMPLATE_REPO = undefined;
    // REPO_ROW.repo is null by default, so this is the +New path

    await registerRepoCreateHandler(connection as any, "repo.create");
    const handler = connection.getHandler()!;

    await expect(
      handler({ id: "job-1", data: { repoId: "repo-1" } }),
    ).rejects.toThrow("No template configured");
  });

  it("normalizes GitHub URL to owner/repo when repo.repo is a full URL", async () => {
    const URL_REPO = { ...REPO_ROW, repo: "https://github.com/some-org/url-project/" };
    mockDb = buildMockDb([URL_REPO]);

    await registerRepoCreateHandler(connection as any, "repo.create");
    const handler = connection.getHandler()!;

    await handler({ id: "job-1", data: { repoId: "repo-1" } });

    // Should clone using normalized owner/repo into {repoId}/repo
    expect(mockSpawn).toHaveBeenCalledWith(
      "git",
      ["clone", "git@github.com:some-org/url-project.git", "repo"],
      expect.objectContaining({ cwd: "/tmp/workspaces/repo-1" }),
    );

    // Should store normalized nwo
    expect(mockDb._updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "some-org/url-project" }),
    );
  });

  it("sets repo to error status on failure and re-throws", async () => {
    mockSpawn.mockImplementation(mockSpawnFactory(1, "", "gh: repo already exists\n"));

    await registerRepoCreateHandler(connection as any, "repo.create");
    const handler = connection.getHandler()!;

    await expect(
      handler({ id: "job-1", data: { repoId: "repo-1" } }),
    ).rejects.toThrow("gh exited with code 1");

    // Should set error status
    expect(mockDb._updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );

    // Should publish error sync event
    expect(connection.publishSync).toHaveBeenCalledWith(
      "sync:repo",
      expect.objectContaining({
        data: { id: "repo-1", status: "error" },
      }),
    );
  });
});
