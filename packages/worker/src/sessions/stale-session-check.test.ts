import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkerConnection, WorkerSession } from "../connection/types.js";

// Mock logger
vi.mock("../logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock config
vi.mock("../config.js", () => ({
  getConfig: () => ({ WORKER_NAME: "test-worker" }),
}));

// Mock shared
vi.mock("@praxis2/shared", () => ({
  syncChannel: (entity: string) => `sync:${entity}`,
  SESSION_START: "session.start",
  workerQueue: (name: string, id: string) => `${name}.${id}`,
}));

function createMockConnection(overrides: Partial<WorkerConnection> = {}): WorkerConnection {
  return {
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
    updateSessionStatus: vi.fn().mockResolvedValue(undefined),
    writeMessage: vi.fn().mockResolvedValue("msg-id"),
    upsertSpec: vi.fn().mockResolvedValue(undefined),
    upsertDeployment: vi.fn().mockResolvedValue(undefined),
    publishSync: vi.fn().mockResolvedValue(undefined),
    subscribeSync: vi.fn().mockResolvedValue(() => {}),
    register: vi.fn().mockResolvedValue(undefined),
    heartbeat: vi.fn().mockResolvedValue(undefined),
    markOffline: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeSession(partial: Partial<WorkerSession> & { id: string }): WorkerSession {
  return {
    status: "active",
    prompt: null,
    metadata: null,
    repoId: "r1",
    type: "working",
    entityType: "task",
    entityId: "e1",
    workerId: null,
    claimedBy: "some-worker",
    ...partial,
  };
}

function createMockSessionManager(aliveIds: string[] = []) {
  return {
    isAlive: vi.fn((id: string) => aliveIds.includes(id)),
  };
}

const { checkStaleSessions } = await import("./stale-session-check.js");

describe("checkStaleSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("auto-resumes stale sessions when process is dead", async () => {
    const sessions = [
      makeSession({ id: "s1", repoId: "r1" }),
      makeSession({ id: "s2", repoId: "r2" }),
    ];
    const connection = createMockConnection({
      getOrphanedSessions: vi.fn().mockResolvedValue(sessions),
    });
    const sessionManager = createMockSessionManager([]); // no alive sessions

    await checkStaleSessions(connection, sessionManager as any);

    // Should have cleared claimedBy for both sessions
    expect(connection.updateSessionStatus).toHaveBeenCalledTimes(2);
    expect(connection.updateSessionStatus).toHaveBeenCalledWith("s1", "active", { clearClaim: true });
    expect(connection.updateSessionStatus).toHaveBeenCalledWith("s2", "active", { clearClaim: true });

    // Should enqueue auto-resume jobs
    expect(connection.sendJob).toHaveBeenCalledTimes(2);
  });

  it("does NOT mark working sessions as stale if PID is tracked", async () => {
    const connection = createMockConnection({
      getOrphanedSessions: vi.fn().mockResolvedValue([
        makeSession({ id: "s1" }),
      ]),
    });
    const sessionManager = createMockSessionManager(["s1"]); // s1 is alive

    await checkStaleSessions(connection, sessionManager as any);

    expect(connection.updateSessionStatus).not.toHaveBeenCalled();
    expect(connection.writeMessage).not.toHaveBeenCalled();
    expect(connection.publishSync).not.toHaveBeenCalled();
    expect(connection.sendJob).not.toHaveBeenCalled();
  });

  it("does nothing when no orphaned sessions exist", async () => {
    const connection = createMockConnection({
      getOrphanedSessions: vi.fn().mockResolvedValue([]),
    });
    const sessionManager = createMockSessionManager([]);

    await checkStaleSessions(connection, sessionManager as any);

    expect(connection.updateSessionStatus).not.toHaveBeenCalled();
    expect(connection.writeMessage).not.toHaveBeenCalled();
    expect(connection.publishSync).not.toHaveBeenCalled();
    expect(connection.sendJob).not.toHaveBeenCalled();
  });

  it("writes system message for stale sessions", async () => {
    const connection = createMockConnection({
      getOrphanedSessions: vi.fn().mockResolvedValue([
        makeSession({ id: "s1" }),
      ]),
    });
    const sessionManager = createMockSessionManager([]);

    await checkStaleSessions(connection, sessionManager as any);

    expect(connection.writeMessage).toHaveBeenCalledWith(
      "s1",
      "system",
      expect.stringContaining("auto-resuming"),
      "test-worker",
    );
  });

  it("passes workerId to getOrphanedSessions", async () => {
    const connection = createMockConnection({
      getOrphanedSessions: vi.fn().mockResolvedValue([]),
    });
    const sessionManager = createMockSessionManager([]);

    await checkStaleSessions(connection, sessionManager as any, "worker-456");

    expect(connection.getOrphanedSessions).toHaveBeenCalledWith("worker-456");
  });

  it("passes null to getOrphanedSessions for central worker", async () => {
    const connection = createMockConnection({
      getOrphanedSessions: vi.fn().mockResolvedValue([]),
    });
    const sessionManager = createMockSessionManager([]);

    await checkStaleSessions(connection, sessionManager as any);

    expect(connection.getOrphanedSessions).toHaveBeenCalledWith(null);
  });

  it("publishes message sync event but not session status sync", async () => {
    const connection = createMockConnection({
      getOrphanedSessions: vi.fn().mockResolvedValue([
        makeSession({ id: "s1" }),
      ]),
    });
    const sessionManager = createMockSessionManager([]);

    await checkStaleSessions(connection, sessionManager as any);

    // Should NOT publish session status sync
    expect(connection.publishSync).not.toHaveBeenCalledWith(
      "sync:session",
      expect.anything(),
    );

    // Should publish message sync
    expect(connection.publishSync).toHaveBeenCalledWith(
      "sync:session:s1:messages",
      expect.objectContaining({
        action: "created",
        data: expect.objectContaining({
          sessionId: "s1",
          role: "system",
        }),
      }),
    );
  });

  it("enqueues auto-resume job for stale sessions", async () => {
    const connection = createMockConnection({
      getOrphanedSessions: vi.fn().mockResolvedValue([
        makeSession({ id: "s1" }),
      ]),
    });
    const sessionManager = createMockSessionManager([]);

    await checkStaleSessions(connection, sessionManager as any);

    expect(connection.createQueue).toHaveBeenCalledWith("session.start");
    expect(connection.sendJob).toHaveBeenCalledWith(
      "session.start",
      expect.objectContaining({
        sessionId: "s1",
        isResume: true,
        isAutoResume: true,
      }),
    );
  });

  it("uses worker-specific queue when workerId is provided", async () => {
    const connection = createMockConnection({
      getOrphanedSessions: vi.fn().mockResolvedValue([
        makeSession({ id: "s1" }),
      ]),
    });
    const sessionManager = createMockSessionManager([]);

    await checkStaleSessions(connection, sessionManager as any, "worker-789");

    expect(connection.createQueue).toHaveBeenCalledWith("session.start.worker-789");
    expect(connection.sendJob).toHaveBeenCalledWith(
      "session.start.worker-789",
      expect.objectContaining({
        sessionId: "s1",
        isResume: true,
        isAutoResume: true,
      }),
    );
  });
});
