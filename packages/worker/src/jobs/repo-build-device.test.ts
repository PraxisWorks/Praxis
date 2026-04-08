import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerRepoBuildDeviceHandler } from "./repo-build-device.js";
import { EventEmitter } from "node:events";

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock("../logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@praxis2/api/schema", () => ({
  rigs: { id: "rigs.id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
}));

vi.mock("@praxis2/shared", () => ({
  REPO_BUILD_DEVICE: "repo.build-device",
  syncChannel: (entity: string) => `sync:${entity}`,
}));

vi.mock("../config.js", () => ({
  getConfig: () => ({ WORKSPACE_ROOT: "/tmp/workspaces" }),
}));

const mockExistsSync = vi.fn();
vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  rmSync: vi.fn(),
}));

const mockSpawn = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

function buildMockDb(selectResult: unknown[] = [REPO_ROW]) {
  const selectLimit = vi.fn().mockResolvedValue(selectResult);
  const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });

  return {
    select: vi.fn().mockReturnValue({ from: selectFrom }),
  };
}

let mockDb: ReturnType<typeof buildMockDb>;

vi.mock("../db.js", () => ({
  getDb: () => mockDb,
}));

// ─── Helpers ────────────────────────────────────────────────────────

function createMockChildProcess(exitCode = 0, stdoutData = "", stderrData = "") {
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

  process.nextTick(() => {
    if (stdoutData) child.stdout.emit("data", Buffer.from(stdoutData));
    if (stderrData) child.stderr.emit("data", Buffer.from(stderrData));
    child.emit("close", exitCode);
  });

  return child;
}

type JobHandler = (job: { id: string; data: unknown }) => Promise<void>;

function buildMockConnection() {
  let capturedHandler: JobHandler | null = null;
  return {
    onJob: vi.fn().mockImplementation(
      (_queueName: string, handler: JobHandler) => {
        capturedHandler = handler;
        return Promise.resolve();
      },
    ),
    publishSync: vi.fn().mockResolvedValue(undefined),
    getHandler: () => capturedHandler,
  };
}

const REPO_ROW = {
  id: "repo-1",
  name: "my-app",
  repo: "test-org/my-app",
  status: "active",
  userId: "user-1",
  bdPrefix: "MA",
  color: "#6366f1",
  description: null,
  workspacePath: "/tmp/workspaces/my-app",
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── Tests ──────────────────────────────────────────────────────────

describe("repo-build-device handler", () => {
  let connection: ReturnType<typeof buildMockConnection>;

  beforeEach(() => {
    vi.clearAllMocks();
    connection = buildMockConnection();
    mockDb = buildMockDb();
    mockExistsSync.mockReturnValue(true);
    mockSpawn.mockImplementation(() => createMockChildProcess(0));
  });

  it("registers a handler on the repo.build-device queue", async () => {
    await registerRepoBuildDeviceHandler(connection as any, "repo.build-device");
    expect(connection.onJob).toHaveBeenCalledWith("repo.build-device", expect.any(Function));
  });

  it("runs build-device.sh and publishes sync event on success", async () => {
    await registerRepoBuildDeviceHandler(connection as any, "repo.build-device");
    const handler = connection.getHandler()!;

    await handler({ id: "job-1", data: { repoId: "repo-1" } });

    expect(mockSpawn).toHaveBeenCalledWith(
      "./scripts/build-device.sh",
      [],
      expect.objectContaining({ cwd: "/tmp/workspaces/my-app" }),
    );

    expect(connection.publishSync).toHaveBeenCalledWith(
      "sync:repo",
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("does not throw when build-device.sh fails (non-fatal)", async () => {
    mockSpawn.mockImplementation(() => createMockChildProcess(1, "", "build failed\n"));

    await registerRepoBuildDeviceHandler(connection as any, "repo.build-device");
    const handler = connection.getHandler()!;

    // Should not throw
    await handler({ id: "job-1", data: { repoId: "repo-1" } });

    // Should still publish sync event
    expect(connection.publishSync).toHaveBeenCalled();
  });

  it("skips gracefully when build-device.sh does not exist", async () => {
    mockExistsSync.mockReturnValue(false);

    await registerRepoBuildDeviceHandler(connection as any, "repo.build-device");
    const handler = connection.getHandler()!;

    await handler({ id: "job-1", data: { repoId: "repo-1" } });

    // Should not spawn any child process
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("throws if repo not found", async () => {
    mockDb = buildMockDb([]);

    await registerRepoBuildDeviceHandler(connection as any, "repo.build-device");
    const handler = connection.getHandler()!;

    await expect(
      handler({ id: "job-1", data: { repoId: "repo-1" } }),
    ).rejects.toThrow("Repo repo-1 not found");
  });
});
