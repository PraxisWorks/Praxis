import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

// ─── Hoisted mock variables ───
const { mockPush, mockFlush, mockStop } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockFlush: vi.fn().mockResolvedValue(undefined),
  mockStop: vi.fn(),
}));

// ─── Mocks ───

// Mock logger
vi.mock("../logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock stream-json-parser instead of output-buffer
vi.mock("./stream-json-parser.js", () => ({
  StreamJsonParser: vi.fn().mockImplementation(() => ({
    push: mockPush,
    flush: mockFlush,
    stop: mockStop,
  })),
}));

// Mock syncChannel
vi.mock("@praxis2/shared", () => ({
  syncChannel: (entity: string) => `sync:${entity}`,
}));

// Mock schema imports
vi.mock("@praxis2/api/schema", () => ({
  sessions: { id: "sessions.id" },
  sessionMessages: { id: "session_messages.id" },
}));

// Mock drizzle-orm eq
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ col, val })),
}));

// Mock getDb so createParser() doesn't throw "Database not initialized"
vi.mock("../db.js", () => ({
  getDb: () => ({
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
  }),
}));

// Mock spawn
const mockSpawn = vi.fn();
vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, spawn: (...args: any[]) => mockSpawn(...args) };
});

// WorkerConnection mock builder
function createMockConnection() {
  return {
    writeMessage: vi.fn().mockResolvedValue("msg-id"),
    updateSessionStatus: vi.fn().mockResolvedValue(undefined),
    publishSync: vi.fn().mockResolvedValue(undefined),
    // Remaining interface methods (not used by SessionManager directly)
    startJobProcessing: vi.fn().mockResolvedValue(undefined),
    stopJobProcessing: vi.fn().mockResolvedValue(undefined),
    createQueue: vi.fn().mockResolvedValue(undefined),
    onJob: vi.fn().mockResolvedValue(undefined),
    sendJob: vi.fn().mockResolvedValue(undefined),
    getSession: vi.fn().mockResolvedValue(null),
    getRepo: vi.fn().mockResolvedValue(null),
    getTask: vi.fn().mockResolvedValue(null),
    getTaskAncestors: vi.fn().mockResolvedValue([]),
    getTaskDescendants: vi.fn().mockResolvedValue([]),
    getTaskDependencies: vi.fn().mockResolvedValue([]),
    getSpec: vi.fn().mockResolvedValue(null),
    getIdea: vi.fn().mockResolvedValue(null),
    getSessionMessages: vi.fn().mockResolvedValue([]),
    getFile: vi.fn().mockResolvedValue({ data: Buffer.from("") }),
    getOrgSessionSettings: vi.fn().mockResolvedValue({ aiInstructions: null, systemInstructions: null }),
    getWorkerRepoInitSettings: vi.fn().mockResolvedValue(null),
    getOrphanedSessions: vi.fn().mockResolvedValue([]),
    getWorkerLastSeen: vi.fn().mockResolvedValue(null),
    claimSession: vi.fn().mockResolvedValue(true),
    upsertSpec: vi.fn().mockResolvedValue(undefined),
    upsertDeployment: vi.fn().mockResolvedValue(undefined),
    subscribeSync: vi.fn().mockResolvedValue(() => {}),
    register: vi.fn().mockResolvedValue(undefined),
    heartbeat: vi.fn().mockResolvedValue(undefined),
    markOffline: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

// Fake child process builder
function createFakeChildProcess(pid = 12345): ChildProcess {
  const proc = new EventEmitter() as unknown as ChildProcess;
  const stdin = new EventEmitter() as any;
  stdin.write = vi.fn();
  stdin.end = vi.fn();
  stdin.destroyed = false;
  (proc as any).stdin = stdin;
  (proc as any).stdout = new EventEmitter();
  (proc as any).stderr = new EventEmitter();
  (proc as any).pid = pid;
  (proc as any).exitCode = null;
  (proc as any).killed = false;
  (proc as any).kill = vi.fn((signal?: string) => {
    if (signal === "SIGKILL") {
      (proc as any).killed = true;
    }
    return true;
  });
  return proc;
}

// Import after mocks
const { SessionManager } = await import("./session-manager.js");

describe("SessionManager", () => {
  let connection: ReturnType<typeof createMockConnection>;
  let manager: InstanceType<typeof SessionManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    connection = createMockConnection();
    manager = new SessionManager(connection as any, "test-worker");
  });

  afterEach(async () => {
    // Don't use restoreAllMocks — it strips vi.mock implementations
  });

  describe("start", () => {
    it("spawns claude CLI with stream-json format and --session-id", async () => {
      const fakeProc = createFakeChildProcess();
      mockSpawn.mockReturnValue(fakeProc);

      await manager.start("s1", "implement auth", "/home/user/project");

      expect(mockSpawn).toHaveBeenCalledWith(
        "claude",
        [
          "--print",
          "--verbose",
          "--output-format", "stream-json",
          "--input-format", "stream-json",
          "--session-id", "s1",
          "--dangerously-skip-permissions",
        ],
        expect.objectContaining({
          cwd: "/home/user/project",
          stdio: ["pipe", "pipe", "pipe"],
        }),
      );
    });

    it("sends the initial prompt via stdin as stream-json", async () => {
      const fakeProc = createFakeChildProcess();
      mockSpawn.mockReturnValue(fakeProc);

      await manager.start("s1", "implement auth", "/home/user/project");

      const expectedMsg = JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "text", text: "implement auth" }] },
      }) + "\n";
      expect(fakeProc.stdin!.write).toHaveBeenCalledWith(expectedMsg);
    });

    it("merges env vars into the spawned process environment", async () => {
      const fakeProc = createFakeChildProcess();
      mockSpawn.mockReturnValue(fakeProc);

      await manager.start("s1", "test", "/tmp", { CUSTOM_VAR: "value" });

      const callEnv = mockSpawn.mock.calls[0][2].env;
      expect(callEnv.CUSTOM_VAR).toBe("value");
      expect(callEnv.PATH).toBeDefined();
    });

    it("throws when session ID is already running", async () => {
      const fakeProc = createFakeChildProcess();
      mockSpawn.mockReturnValue(fakeProc);

      await manager.start("s1", "task", "/tmp");

      await expect(manager.start("s1", "task", "/tmp")).rejects.toThrow(
        "already running",
      );
    });

    it("writes launch system message to session_messages", async () => {
      const fakeProc = createFakeChildProcess(12345);
      mockSpawn.mockReturnValue(fakeProc);

      await manager.start("s1", "task", "/tmp");

      expect(connection.writeMessage).toHaveBeenCalledWith(
        "s1",
        "system",
        expect.stringContaining("pid: 12345"),
        "test-worker",
      );
    });

    it("publishes launch message to scoped channel", async () => {
      const fakeProc = createFakeChildProcess();
      mockSpawn.mockReturnValue(fakeProc);

      await manager.start("s1", "task", "/tmp");

      expect(connection.publishSync).toHaveBeenCalledWith(
        "sync:session:s1:messages",
        expect.objectContaining({
          action: "created",
          data: expect.objectContaining({
            sessionId: "s1",
            role: "system",
            content: "Session launched",
          }),
        }),
      );
    });

    it("pipes stdout data to stream-json parser", async () => {
      const fakeProc = createFakeChildProcess();
      mockSpawn.mockReturnValue(fakeProc);

      await manager.start("s1", "task", "/tmp");
      fakeProc.stdout!.emit("data", Buffer.from('{"type":"assistant"}\n'));

      expect(mockPush).toHaveBeenCalledWith('{"type":"assistant"}\n');
    });

    it("updates session to error on process exit with non-zero code", async () => {
      const fakeProc = createFakeChildProcess();
      mockSpawn.mockReturnValue(fakeProc);

      await manager.start("s1", "task", "/tmp");
      fakeProc.emit("exit", 1, null);

      await vi.waitFor(() => {
        expect(connection.updateSessionStatus).toHaveBeenCalledWith(
          "s1",
          "error",
          expect.anything(),
        );
      });
    });

    it("does not mark completed on exit code 0 (stream-json stays active)", async () => {
      const fakeProc = createFakeChildProcess();
      mockSpawn.mockReturnValue(fakeProc);

      await manager.start("s1", "task", "/tmp");
      fakeProc.emit("exit", 0, null);

      // Wait a tick for the async handler to run
      await new Promise((r) => setTimeout(r, 10));

      // In stream-json mode, exit code 0 does NOT set status to completed
      expect(connection.updateSessionStatus).not.toHaveBeenCalledWith(
        "s1",
        "completed",
        expect.anything(),
      );
    });

    it("updates session to error on spawn error", async () => {
      const fakeProc = createFakeChildProcess();
      mockSpawn.mockReturnValue(fakeProc);

      await manager.start("s1", "task", "/tmp");
      fakeProc.emit("error", new Error("spawn claude ENOENT"));

      await vi.waitFor(() => {
        expect(connection.updateSessionStatus).toHaveBeenCalledWith(
          "s1",
          "error",
          expect.anything(),
        );
      });
    });

    it("removes session from internal map after process exit", async () => {
      const fakeProc = createFakeChildProcess();
      mockSpawn.mockReturnValue(fakeProc);

      await manager.start("s1", "task", "/tmp");
      expect(manager.getActiveCount()).toBe(1);

      fakeProc.emit("exit", 0, null);

      await vi.waitFor(() => {
        expect(manager.getActiveCount()).toBe(0);
      });
    });
  });

  describe("resume", () => {
    it("spawns claude CLI with stream-json format and --resume flag", async () => {
      const fakeProc = createFakeChildProcess();
      mockSpawn.mockReturnValue(fakeProc);

      await manager.resume("s1", "/home/user/project");

      expect(mockSpawn).toHaveBeenCalledWith(
        "claude",
        [
          "--print",
          "--verbose",
          "--output-format", "stream-json",
          "--input-format", "stream-json",
          "--resume", "s1",
          "--dangerously-skip-permissions",
        ],
        expect.objectContaining({
          cwd: "/home/user/project",
          stdio: ["pipe", "pipe", "pipe"],
        }),
      );
    });

    it("throws when session ID is already running", async () => {
      const fakeProc = createFakeChildProcess();
      mockSpawn.mockReturnValue(fakeProc);

      await manager.start("s1", "task", "/tmp");

      await expect(manager.resume("s1", "/tmp")).rejects.toThrow(
        "already running",
      );
    });

    it("writes resume system message to session_messages", async () => {
      const fakeProc = createFakeChildProcess(99999);
      mockSpawn.mockReturnValue(fakeProc);

      await manager.resume("s1", "/tmp");

      expect(connection.writeMessage).toHaveBeenCalledWith(
        "s1",
        "system",
        expect.stringContaining("resumed"),
        "test-worker",
      );
    });
  });

  describe("sendInput", () => {
    it("writes stream-json message to stdin when process is alive", async () => {
      const fakeProc = createFakeChildProcess();
      mockSpawn.mockReturnValue(fakeProc);

      await manager.start("s1", "task", "/tmp");
      await manager.sendInput("s1", "hello");

      const expectedMsg = JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "text", text: "hello" }] },
      }) + "\n";
      // First call is the initial prompt from start(), second is from sendInput
      expect(fakeProc.stdin!.write).toHaveBeenCalledWith(expectedMsg);
    });

    it("throws when session has no stored context", async () => {
      await expect(manager.sendInput("nonexistent", "hello")).rejects.toThrow(
        "no stored context",
      );
    });
  });

  describe("stop", () => {
    it("sends SIGTERM to the process after closing stdin", async () => {
      vi.useFakeTimers();
      const fakeProc = createFakeChildProcess();
      mockSpawn.mockReturnValue(fakeProc);

      await manager.start("s1", "task", "/tmp");
      const stopPromise = manager.stop("s1");

      // Advance past the 500ms stdin close delay so SIGTERM is sent
      vi.advanceTimersByTime(600);

      expect(fakeProc.kill).toHaveBeenCalledWith("SIGTERM");

      // Simulate process exiting after SIGTERM
      fakeProc.emit("exit", 0, "SIGTERM");
      await stopPromise;
      vi.useRealTimers();
    });

    it("sends SIGKILL after 5 second timeout if process does not exit", async () => {
      vi.useFakeTimers();
      const fakeProc = createFakeChildProcess();
      (fakeProc as any).exitCode = null;
      (fakeProc as any).killed = false;
      mockSpawn.mockReturnValue(fakeProc);

      await manager.start("s1", "task", "/tmp");
      const stopPromise = manager.stop("s1");

      // Advance past the 500ms stdin close delay, then past 5 second timeout
      vi.advanceTimersByTime(5500);

      expect(fakeProc.kill).toHaveBeenCalledWith("SIGKILL");

      // Clean up
      fakeProc.emit("exit", null, "SIGKILL");
      await stopPromise;
      vi.useRealTimers();
    });

    it("does nothing if session is not found", async () => {
      await manager.stop("nonexistent");
    });
  });

  describe("isAlive", () => {
    it("returns true when process is running", async () => {
      const fakeProc = createFakeChildProcess();
      (fakeProc as any).exitCode = null;
      (fakeProc as any).killed = false;
      mockSpawn.mockReturnValue(fakeProc);

      await manager.start("s1", "task", "/tmp");
      expect(manager.isAlive("s1")).toBe(true);
    });

    it("returns false when process has exited", async () => {
      const fakeProc = createFakeChildProcess();
      mockSpawn.mockReturnValue(fakeProc);

      await manager.start("s1", "task", "/tmp");
      (fakeProc as any).exitCode = 0;

      expect(manager.isAlive("s1")).toBe(false);
    });

    it("returns false when session is not in the map", () => {
      expect(manager.isAlive("nonexistent")).toBe(false);
    });
  });

  describe("getActiveCount", () => {
    it("returns 0 when no sessions are running", () => {
      expect(manager.getActiveCount()).toBe(0);
    });

    it("returns correct count with multiple sessions", async () => {
      const fakeProc1 = createFakeChildProcess(1);
      const fakeProc2 = createFakeChildProcess(2);
      mockSpawn.mockReturnValueOnce(fakeProc1).mockReturnValueOnce(fakeProc2);

      await manager.start("s1", "task1", "/tmp");
      await manager.start("s2", "task2", "/tmp");

      expect(manager.getActiveCount()).toBe(2);
    });
  });

  describe("shutdownAll", () => {
    it("stops all active sessions", async () => {
      vi.useFakeTimers();
      const fakeProc1 = createFakeChildProcess(1);
      const fakeProc2 = createFakeChildProcess(2);
      mockSpawn.mockReturnValueOnce(fakeProc1).mockReturnValueOnce(fakeProc2);

      await manager.start("s1", "task1", "/tmp");
      await manager.start("s2", "task2", "/tmp");

      const shutdownPromise = manager.shutdownAll();

      // Advance past the 500ms stdin close delay so SIGTERM is sent
      vi.advanceTimersByTime(600);

      expect(fakeProc1.kill).toHaveBeenCalledWith("SIGTERM");
      expect(fakeProc2.kill).toHaveBeenCalledWith("SIGTERM");

      // Emit exit events after kill
      fakeProc1.emit("exit", 0, "SIGTERM");
      fakeProc2.emit("exit", 0, "SIGTERM");

      await shutdownPromise;
      vi.useRealTimers();
    });
  });
});
