import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock drizzle-orm operators
vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  and: (...args: unknown[]) => ({ op: "and", args }),
  lt: (col: unknown, val: unknown) => ({ op: "lt", col, val }),
  isNotNull: (col: unknown) => ({ op: "isNotNull", col }),
  desc: (col: unknown) => ({ op: "desc", col }),
}));

// Mock schema
vi.mock("../db/schema.js", () => ({
  workers: {
    id: "workers.id",
    status: "workers.status",
    lastSeenAt: "workers.lastSeenAt",
    apiKeyId: "workers.apiKeyId",
  },
  sessions: {
    id: "sessions.id",
    workerId: "sessions.workerId",
    status: "sessions.status",
    updatedAt: "sessions.updatedAt",
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

// Mock orphan recovery (tested separately in orphanSessionRecovery.test.ts)
const mockRecoverOrphanedSessions = vi.fn().mockResolvedValue(undefined);
vi.mock("./orphanSessionRecovery.js", () => ({
  recoverOrphanedSessions: (...args: unknown[]) => mockRecoverOrphanedSessions(...args),
}));

// Mock enqueueJob
const mockEnqueueJob = vi.fn().mockResolvedValue("job-id-123");
vi.mock("../jobs/index.js", () => ({
  enqueueJob: (...args: unknown[]) => mockEnqueueJob(...args),
}));

// ── Mock DB ──────────────────────────────────────────────────────────

/**
 * Creates a chainable + thenable mock that mimics Drizzle query builders.
 * When awaited directly, resolves to `data`. Also supports .limit(), .orderBy(),
 * .where(), and .from() chaining.
 */
function createQueryResult(data: unknown[]) {
  const obj: Record<string, unknown> = {
    limit: vi.fn().mockImplementation(() => createQueryResult(data)),
    orderBy: vi.fn().mockImplementation(() => createQueryResult(data)),
    where: vi.fn().mockImplementation(() => createQueryResult(data)),
    from: vi.fn().mockImplementation(() => createQueryResult(data)),
    then: (resolve: (val: unknown[]) => void, reject?: (err: unknown) => void) => {
      return Promise.resolve(data).then(resolve, reject);
    },
  };
  return obj;
}

// The update chain: db.update(table).set({}).where({}).returning()
const mockReturning = vi.fn();
const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockReturning });
const mockSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

// The select chain: uses dynamic mocking per test via selectResults queue
let selectResults: unknown[][] = [];
let selectCallIndex = 0;

const mockSelect = vi.fn().mockImplementation(() => {
  return {
    from: vi.fn().mockImplementation(() => {
      const idx = selectCallIndex++;
      const data = idx < selectResults.length ? selectResults[idx] : [];
      return createQueryResult(data);
    }),
  };
});

const mockDb = {
  update: mockUpdate,
  select: mockSelect,
};

vi.mock("../db/index.js", () => ({
  getDb: () => mockDb,
}));

const { checkStaleWorkers, checkByokIdleWorkers } = await import("./staleWorkerCheck.js");

function createMockPubsub() {
  return { publish: vi.fn().mockResolvedValue(undefined) };
}

// ── Existing stale worker tests ──────────────────────────────────────

function resetSelectMock() {
  mockSelect.mockImplementation(() => ({
    from: vi.fn().mockImplementation(() => {
      const idx = selectCallIndex++;
      const data = idx < selectResults.length ? selectResults[idx] : [];
      return createQueryResult(data);
    }),
  }));
}

describe("checkStaleWorkers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectCallIndex = 0;
    selectResults = [];
    // Reset the update mock chain
    mockUpdateWhere.mockReturnValue({ returning: mockReturning });
    mockSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdate.mockReturnValue({ set: mockSet });
    // Reset select mock
    resetSelectMock();
    mockRecoverOrphanedSessions.mockResolvedValue(undefined);
    mockEnqueueJob.mockResolvedValue("job-id-123");
  });

  it("marks workers with lastSeenAt older than 2 minutes as offline", async () => {
    const staleWorker = {
      id: "worker-1",
      name: "stale-worker",
      status: "offline",
      lastSeenAt: new Date(Date.now() - 3 * 60 * 1000), // 3 minutes ago
    };
    mockReturning.mockResolvedValue([staleWorker]);
    // BYOK idle check: no online BYOK workers
    selectResults = [[]];

    const pubsub = createMockPubsub();
    await checkStaleWorkers(pubsub as any);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "offline" }),
    );
    expect(mockReturning).toHaveBeenCalledTimes(1);

    expect(pubsub.publish).toHaveBeenCalledTimes(1);
    expect(pubsub.publish).toHaveBeenCalledWith(
      "sync:worker",
      expect.objectContaining({
        action: "updated",
        data: staleWorker,
        timestamp: expect.any(Number),
      }),
    );

    // Should also recover orphaned sessions on the stale worker
    expect(mockRecoverOrphanedSessions).toHaveBeenCalledTimes(1);
    expect(mockRecoverOrphanedSessions).toHaveBeenCalledWith("worker-1", pubsub);
  });

  it("does not publish events when no stale workers are found", async () => {
    mockReturning.mockResolvedValue([]);
    selectResults = [[]];

    const pubsub = createMockPubsub();
    await checkStaleWorkers(pubsub as any);

    expect(mockUpdate).toHaveBeenCalledTimes(1); // query still runs
    expect(pubsub.publish).not.toHaveBeenCalled();
  });

  it("publishes a sync event for each stale worker", async () => {
    const staleWorkers = [
      { id: "worker-1", name: "w1", status: "offline", lastSeenAt: new Date(Date.now() - 5 * 60 * 1000) },
      { id: "worker-2", name: "w2", status: "offline", lastSeenAt: new Date(Date.now() - 10 * 60 * 1000) },
    ];
    mockReturning.mockResolvedValue(staleWorkers);
    selectResults = [[]];

    const pubsub = createMockPubsub();
    await checkStaleWorkers(pubsub as any);

    expect(pubsub.publish).toHaveBeenCalledTimes(2);

    expect(pubsub.publish).toHaveBeenCalledWith(
      "sync:worker",
      expect.objectContaining({
        action: "updated",
        data: expect.objectContaining({ id: "worker-1" }),
      }),
    );
    expect(pubsub.publish).toHaveBeenCalledWith(
      "sync:worker",
      expect.objectContaining({
        action: "updated",
        data: expect.objectContaining({ id: "worker-2" }),
      }),
    );
  });

  it("uses a 2-minute cutoff threshold", async () => {
    mockReturning.mockResolvedValue([]);
    selectResults = [[]];

    const pubsub = createMockPubsub();

    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);

    await checkStaleWorkers(pubsub as any);

    // The set() call should set status to offline
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "offline" }),
    );

    // The where() call should use the lt operator with lastSeenAt and cutoff
    expect(mockUpdateWhere).toHaveBeenCalledWith(
      expect.objectContaining({
        op: "and",
        args: expect.arrayContaining([
          expect.objectContaining({ op: "eq", col: "workers.status", val: "online" }),
          expect.objectContaining({ op: "lt", col: "workers.lastSeenAt" }),
        ]),
      }),
    );

    vi.restoreAllMocks();
  });

  it("also invokes the BYOK idle check", async () => {
    mockReturning.mockResolvedValue([]);
    selectResults = [[]];

    const pubsub = createMockPubsub();
    await checkStaleWorkers(pubsub as any);

    // The select chain was called once (for online BYOK workers query)
    expect(mockSelect).toHaveBeenCalled();
  });
});

// ── BYOK idle worker tests ──────────────────────────────────────────

describe("checkByokIdleWorkers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectCallIndex = 0;
    selectResults = [];
    resetSelectMock();
    mockEnqueueJob.mockResolvedValue("job-id-123");
  });

  it("does not enqueue teardown for non-BYOK workers (apiKeyId = null)", async () => {
    // The isNotNull(workers.apiKeyId) filter means non-BYOK workers are
    // excluded from the query results. Return empty.
    selectResults = [[]];

    await checkByokIdleWorkers();

    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it("does not enqueue teardown for BYOK workers with active sessions", async () => {
    const byokWorker = {
      id: "byok-worker-1",
      apiKeyId: "key-1",
      status: "online",
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
    };

    selectResults = [
      [byokWorker],           // 1: online BYOK workers
      [{ id: "session-1" }],  // 2: active sessions check → has one
    ];

    await checkByokIdleWorkers();

    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it("enqueues teardown for BYOK worker idle 15+ minutes with no active sessions", async () => {
    const byokWorker = {
      id: "byok-worker-1",
      apiKeyId: "key-1",
      status: "online",
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
    };

    selectResults = [
      [byokWorker],                                                        // 1: online BYOK workers
      [],                                                                   // 2: active sessions → none
      [{ updatedAt: new Date(Date.now() - 20 * 60 * 1000) }],             // 3: latest session → 20 min ago
    ];

    await checkByokIdleWorkers();

    expect(mockEnqueueJob).toHaveBeenCalledTimes(1);
    expect(mockEnqueueJob).toHaveBeenCalledWith(
      "byok-teardown-worker",
      { apiKeyId: "key-1" },
    );
  });

  it("does not enqueue teardown for BYOK worker idle less than 15 minutes", async () => {
    const byokWorker = {
      id: "byok-worker-1",
      apiKeyId: "key-1",
      status: "online",
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
    };

    selectResults = [
      [byokWorker],                                                       // 1: online BYOK workers
      [],                                                                  // 2: active sessions → none
      [{ updatedAt: new Date(Date.now() - 5 * 60 * 1000) }],            // 3: latest session → 5 min ago
    ];

    await checkByokIdleWorkers();

    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it("uses worker createdAt as fallback when no sessions exist", async () => {
    const byokWorker = {
      id: "byok-worker-1",
      apiKeyId: "key-1",
      status: "online",
      createdAt: new Date(Date.now() - 30 * 60 * 1000), // Created 30 min ago
    };

    selectResults = [
      [byokWorker],  // 1: online BYOK workers
      [],            // 2: active sessions → none
      [],            // 3: latest session → none (empty)
    ];

    await checkByokIdleWorkers();

    // Worker created 30 min ago with no sessions => idle => teardown
    expect(mockEnqueueJob).toHaveBeenCalledTimes(1);
    expect(mockEnqueueJob).toHaveBeenCalledWith(
      "byok-teardown-worker",
      { apiKeyId: "key-1" },
    );
  });

  it("does not teardown a recently created BYOK worker with no sessions", async () => {
    const byokWorker = {
      id: "byok-worker-1",
      apiKeyId: "key-1",
      status: "online",
      createdAt: new Date(Date.now() - 5 * 60 * 1000), // Created 5 min ago
    };

    selectResults = [
      [byokWorker],  // 1: online BYOK workers
      [],            // 2: active sessions → none
      [],            // 3: latest session → none
    ];

    await checkByokIdleWorkers();

    // Worker created 5 min ago — not idle long enough
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it("processes multiple idle BYOK workers independently", async () => {
    const byokWorker1 = {
      id: "byok-worker-1",
      apiKeyId: "key-1",
      status: "online",
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
    };
    const byokWorker2 = {
      id: "byok-worker-2",
      apiKeyId: "key-2",
      status: "online",
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
    };

    selectResults = [
      [byokWorker1, byokWorker2],                                        // 1: online BYOK workers
      [],                                                                  // 2: worker-1 active sessions → none
      [{ updatedAt: new Date(Date.now() - 20 * 60 * 1000) }],           // 3: worker-1 latest session → 20 min ago
      [{ id: "session-active" }],                                         // 4: worker-2 active sessions → has one
    ];

    await checkByokIdleWorkers();

    // Only worker-1 should be torn down; worker-2 has active sessions
    expect(mockEnqueueJob).toHaveBeenCalledTimes(1);
    expect(mockEnqueueJob).toHaveBeenCalledWith(
      "byok-teardown-worker",
      { apiKeyId: "key-1" },
    );
  });
});
