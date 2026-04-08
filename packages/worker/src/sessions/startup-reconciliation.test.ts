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
    entityType: "idea",
    entityId: "e1",
    workerId: null,
    claimedBy: "some-worker",
    ...partial,
  };
}

const { autoResumeOrphanedSessions } = await import(
  "./startup-reconciliation.js"
);

describe("startup reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("auto-resumes orphaned active sessions by clearing claimedBy and enqueuing", async () => {
    const twoMinutesAgo = new Date(Date.now() - 120_000);
    const sessions = [
      makeSession({ id: "s1", repoId: "r1", entityType: "idea", entityId: "e1" }),
      makeSession({ id: "s2", repoId: "r2", entityType: "idea", entityId: "e2" }),
    ];
    const connection = createMockConnection({
      getWorkerLastSeen: vi.fn().mockResolvedValue(twoMinutesAgo),
      getOrphanedSessions: vi.fn().mockResolvedValue(sessions),
    });

    await autoResumeOrphanedSessions(connection);

    // Should have cleared claimedBy for both sessions
    expect(connection.updateSessionStatus).toHaveBeenCalledTimes(2);
    expect(connection.updateSessionStatus).toHaveBeenCalledWith("s1", "active", { clearClaim: true });
    expect(connection.updateSessionStatus).toHaveBeenCalledWith("s2", "active", { clearClaim: true });

    // Should have written system messages for both sessions
    expect(connection.writeMessage).toHaveBeenCalledTimes(2);

    // Should have published message sync events
    expect(connection.publishSync).toHaveBeenCalledWith(
      "sync:session:s1:messages",
      expect.objectContaining({
        action: "created",
        data: expect.objectContaining({ sessionId: "s1", role: "system" }),
      }),
    );
    expect(connection.publishSync).toHaveBeenCalledWith(
      "sync:session:s2:messages",
      expect.objectContaining({
        action: "created",
        data: expect.objectContaining({ sessionId: "s2", role: "system" }),
      }),
    );

    // Should NOT publish session status sync events
    expect(connection.publishSync).not.toHaveBeenCalledWith(
      "sync:session",
      expect.anything(),
    );

    // Should enqueue SESSION_START jobs for both sessions
    expect(connection.createQueue).toHaveBeenCalledTimes(2);
    expect(connection.sendJob).toHaveBeenCalledTimes(2);
    expect(connection.sendJob).toHaveBeenCalledWith(
      "session.start",
      expect.objectContaining({
        sessionId: "s1",
        repoId: "r1",
        type: "working",
        entityType: "idea",
        entityId: "e1",
        isResume: true,
        isAutoResume: true,
      }),
    );
  });

  it("does nothing when no orphaned sessions exist", async () => {
    const connection = createMockConnection({
      getWorkerLastSeen: vi.fn().mockResolvedValue(null),
      getOrphanedSessions: vi.fn().mockResolvedValue([]),
    });

    await autoResumeOrphanedSessions(connection);

    expect(connection.updateSessionStatus).not.toHaveBeenCalled();
    expect(connection.writeMessage).not.toHaveBeenCalled();
    expect(connection.publishSync).not.toHaveBeenCalled();
    expect(connection.sendJob).not.toHaveBeenCalled();
  });

  it("runs once, not on a polling interval", async () => {
    const connection = createMockConnection({
      getWorkerLastSeen: vi.fn().mockResolvedValue(null),
      getOrphanedSessions: vi.fn().mockResolvedValue([
        makeSession({ id: "s1" }),
      ]),
    });

    await autoResumeOrphanedSessions(connection);

    // Function should complete and return (not set up a polling interval)
    expect(connection.updateSessionStatus).toHaveBeenCalledTimes(1);
    expect(connection.sendJob).toHaveBeenCalledTimes(1);
  });

  it("passes workerId to getOrphanedSessions", async () => {
    const connection = createMockConnection({
      getWorkerLastSeen: vi.fn().mockResolvedValue(null),
      getOrphanedSessions: vi.fn().mockResolvedValue([]),
    });

    await autoResumeOrphanedSessions(connection, "worker-123");

    expect(connection.getOrphanedSessions).toHaveBeenCalledWith("worker-123");
  });

  it("passes null to getOrphanedSessions for central worker", async () => {
    const connection = createMockConnection({
      getWorkerLastSeen: vi.fn().mockResolvedValue(null),
      getOrphanedSessions: vi.fn().mockResolvedValue([]),
    });

    await autoResumeOrphanedSessions(connection);

    expect(connection.getOrphanedSessions).toHaveBeenCalledWith(null);
  });

  it("uses central UUID for getWorkerLastSeen when no workerId", async () => {
    const connection = createMockConnection({
      getWorkerLastSeen: vi.fn().mockResolvedValue(null),
      getOrphanedSessions: vi.fn().mockResolvedValue([]),
    });

    await autoResumeOrphanedSessions(connection);

    expect(connection.getWorkerLastSeen).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000000",
    );
  });

  it("uses worker-scoped queue when workerId is provided", async () => {
    const connection = createMockConnection({
      getWorkerLastSeen: vi.fn().mockResolvedValue(new Date(Date.now() - 60_000)),
      getOrphanedSessions: vi.fn().mockResolvedValue([
        makeSession({ id: "s1" }),
      ]),
    });

    await autoResumeOrphanedSessions(connection, "worker-456");

    expect(connection.createQueue).toHaveBeenCalledWith("session.start.worker-456");
    expect(connection.sendJob).toHaveBeenCalledWith(
      "session.start.worker-456",
      expect.objectContaining({ sessionId: "s1", isResume: true, isAutoResume: true }),
    );
  });

  it("formats downtime in system message", async () => {
    const twoMinutesAgo = new Date(Date.now() - 125_000); // 2m 5s
    const connection = createMockConnection({
      getWorkerLastSeen: vi.fn().mockResolvedValue(twoMinutesAgo),
      getOrphanedSessions: vi.fn().mockResolvedValue([
        makeSession({ id: "s1" }),
      ]),
    });

    await autoResumeOrphanedSessions(connection);

    expect(connection.writeMessage).toHaveBeenCalledWith(
      "s1",
      "system",
      expect.stringContaining("auto-resuming session"),
      "test-worker",
    );
    expect(connection.publishSync).toHaveBeenCalledWith(
      "sync:session:s1:messages",
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining("auto-resuming session"),
        }),
      }),
    );
  });

  it("handles unknown downtime when worker has no prior record", async () => {
    const connection = createMockConnection({
      getWorkerLastSeen: vi.fn().mockResolvedValue(null),
      getOrphanedSessions: vi.fn().mockResolvedValue([
        makeSession({ id: "s1" }),
      ]),
    });

    await autoResumeOrphanedSessions(connection);

    expect(connection.writeMessage).toHaveBeenCalledWith(
      "s1",
      "system",
      expect.stringContaining("unknown duration"),
      "test-worker",
    );
  });

  it("includes error sessions with claimedBy set in auto-resume", async () => {
    const connection = createMockConnection({
      getWorkerLastSeen: vi.fn().mockResolvedValue(new Date(Date.now() - 30_000)),
      getOrphanedSessions: vi.fn().mockResolvedValue([
        makeSession({ id: "s1", status: "error", entityType: "task", entityId: "b1" }),
      ]),
    });

    await autoResumeOrphanedSessions(connection);

    expect(connection.updateSessionStatus).toHaveBeenCalledTimes(1);
    expect(connection.updateSessionStatus).toHaveBeenCalledWith("s1", "error", { clearClaim: true });
    expect(connection.sendJob).toHaveBeenCalledWith(
      "session.start",
      expect.objectContaining({
        sessionId: "s1",
        isResume: true,
        isAutoResume: true,
      }),
    );
  });

  it("formats short downtime (seconds only)", async () => {
    const fiveSecondsAgo = new Date(Date.now() - 5_000);
    const connection = createMockConnection({
      getWorkerLastSeen: vi.fn().mockResolvedValue(fiveSecondsAgo),
      getOrphanedSessions: vi.fn().mockResolvedValue([
        makeSession({ id: "s1" }),
      ]),
    });

    await autoResumeOrphanedSessions(connection);

    expect(connection.writeMessage).toHaveBeenCalledWith(
      "s1",
      "system",
      expect.stringMatching(/after \d+s/),
      "test-worker",
    );
  });

  it("processes only sessions returned by getOrphanedSessions", async () => {
    const connection = createMockConnection({
      getWorkerLastSeen: vi.fn().mockResolvedValue(new Date(Date.now() - 60_000)),
      getOrphanedSessions: vi.fn().mockResolvedValue([
        makeSession({ id: "s1" }),
        makeSession({ id: "s2", status: "error", type: "spec", entityType: null, entityId: null }),
      ]),
    });

    await autoResumeOrphanedSessions(connection);

    expect(connection.updateSessionStatus).toHaveBeenCalledTimes(2);
    expect(connection.sendJob).toHaveBeenCalledTimes(2);
    expect(connection.writeMessage).toHaveBeenCalledTimes(2);
  });
});
