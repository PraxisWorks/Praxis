import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock drizzle-orm operators
vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  and: (...args: unknown[]) => ({ op: "and", args }),
}));

// Mock schema
vi.mock("../db/schema.js", () => ({
  sessions: {
    id: "sessions.id",
    workerId: "sessions.workerId",
    status: "sessions.status",
  },
}));

// Mock shared
vi.mock("@praxis2/shared", () => ({
  syncChannel: (entity: string) => `sync:${entity}`,
}));

// Mock logger
vi.mock("./logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock DB
const mockReturning = vi.fn();
const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });
const mockDb = { update: mockUpdate };

vi.mock("../db/index.js", () => ({
  getDb: () => mockDb,
}));

const { recoverOrphanedSessions } = await import("./orphanSessionRecovery.js");

function createMockPubsub() {
  return { publish: vi.fn().mockResolvedValue(undefined) };
}

describe("recoverOrphanedSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWhere.mockReturnValue({ returning: mockReturning });
    mockSet.mockReturnValue({ where: mockWhere });
    mockUpdate.mockReturnValue({ set: mockSet });
  });

  it("marks active sessions on a disconnected worker as paused", async () => {
    const orphanedSessions = [
      { id: "session-1", status: "paused", workerId: "worker-1" },
      { id: "session-2", status: "paused", workerId: "worker-1" },
    ];
    mockReturning.mockResolvedValue(orphanedSessions);

    const pubsub = createMockPubsub();
    await recoverOrphanedSessions("worker-1", pubsub as any);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "paused",
        metadata: { reason: "worker_disconnected" },
      }),
    );

    // Should filter by workerId AND status = "active"
    expect(mockWhere).toHaveBeenCalledWith(
      expect.objectContaining({
        op: "and",
        args: expect.arrayContaining([
          expect.objectContaining({ op: "eq", col: "sessions.workerId", val: "worker-1" }),
          expect.objectContaining({ op: "eq", col: "sessions.status", val: "active" }),
        ]),
      }),
    );
  });

  it("publishes sync events for each orphaned session", async () => {
    const orphanedSessions = [
      { id: "session-1", status: "paused", workerId: "worker-1" },
      { id: "session-2", status: "paused", workerId: "worker-1" },
    ];
    mockReturning.mockResolvedValue(orphanedSessions);

    const pubsub = createMockPubsub();
    await recoverOrphanedSessions("worker-1", pubsub as any);

    expect(pubsub.publish).toHaveBeenCalledTimes(2);
    expect(pubsub.publish).toHaveBeenCalledWith(
      "sync:session",
      expect.objectContaining({
        action: "updated",
        data: expect.objectContaining({ id: "session-1", status: "paused" }),
        timestamp: expect.any(Number),
      }),
    );
    expect(pubsub.publish).toHaveBeenCalledWith(
      "sync:session",
      expect.objectContaining({
        action: "updated",
        data: expect.objectContaining({ id: "session-2", status: "paused" }),
        timestamp: expect.any(Number),
      }),
    );
  });

  it("does not publish events when no orphaned sessions are found", async () => {
    mockReturning.mockResolvedValue([]);

    const pubsub = createMockPubsub();
    await recoverOrphanedSessions("worker-1", pubsub as any);

    expect(mockUpdate).toHaveBeenCalledTimes(1); // query still runs
    expect(pubsub.publish).not.toHaveBeenCalled();
  });

  it("only targets active sessions (not paused or completed)", async () => {
    mockReturning.mockResolvedValue([]);

    const pubsub = createMockPubsub();
    await recoverOrphanedSessions("worker-1", pubsub as any);

    // The where clause should filter for status = "active"
    expect(mockWhere).toHaveBeenCalledWith(
      expect.objectContaining({
        op: "and",
        args: expect.arrayContaining([
          expect.objectContaining({ op: "eq", col: "sessions.status", val: "active" }),
        ]),
      }),
    );
  });

  it("only targets sessions on the specified worker", async () => {
    mockReturning.mockResolvedValue([]);

    const pubsub = createMockPubsub();
    await recoverOrphanedSessions("worker-42", pubsub as any);

    // The where clause should filter for the specific workerId
    expect(mockWhere).toHaveBeenCalledWith(
      expect.objectContaining({
        op: "and",
        args: expect.arrayContaining([
          expect.objectContaining({ op: "eq", col: "sessions.workerId", val: "worker-42" }),
        ]),
      }),
    );
  });
});
