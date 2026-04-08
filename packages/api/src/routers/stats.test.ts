import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/index.js", () => ({
  getConnectionString: vi.fn(() => "postgresql://mock"),
  getDb: vi.fn(() => ({})),
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "mock-jwks"),
  jwtVerify: vi.fn().mockResolvedValue({
    payload: { sub: "user123", email: "test@example.com" },
    protectedHeader: { alg: "RS256" },
  }),
}));

vi.mock("../lib/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock("../jobs/index.js", () => ({
  enqueueJob: vi.fn().mockResolvedValue("job-123"),
}));

vi.mock("../lib/requireOrgMember.js", () => ({
  requireOrgMember: vi.fn().mockResolvedValue({ orgId: "mock", userId: "mock", role: "owner" }),
}));

vi.mock("../lib/requireAccessibleRepo.js", () => ({
  requireAccessibleRepo: vi.fn().mockResolvedValue({
    id: "770e8400-e29b-41d4-a716-446655440002",
    orgId: "mock-org",
    name: "Test Repo",
    status: "active",
  }),
}));

vi.mock("../lib/orgSyncFilter.js", () => ({
  getUserOrgIds: vi.fn().mockResolvedValue(new Set(["mock-org"])),
  shouldForwardOrgEvent: vi.fn().mockReturnValue(true),
}));

import { appRouter } from "./index.js";

describe("statsRouter", () => {
  const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
  const REPO_ID = "770e8400-e29b-41d4-a716-446655440002";

  const mockPubsub = {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    close: vi.fn(),
  };

  let resultQueue: unknown[];
  // Queue for where-terminal calls (awaited directly without .limit())
  let whereTerminalQueue: unknown[];

  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn(function (this: any) { return this; }),
    orderBy: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    limit: vi.fn(() => {
      const result = resultQueue.shift();
      return Promise.resolve(result ?? []);
    }),
    // Make mockDb thenable so `await db.select().from().where()` works
    // when where() is the terminal call (e.g. orgRigs query, groupBy queries).
    then: vi.fn((resolve: any) => {
      const result = whereTerminalQueue.shift();
      return Promise.resolve(result ?? []).then(resolve);
    }),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  };

  const createCaller = (authenticated = false) =>
    appRouter.createCaller({
      user: authenticated
        ? { sub: "user123", email: "test@example.com" }
        : null,
      db: mockDb as any,
      pubsub: mockPubsub as any,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    resultQueue = [];
    whereTerminalQueue = [];

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockImplementation(function (this: any) { return this; });
    mockDb.orderBy.mockReturnThis();
    mockDb.groupBy.mockReturnThis();
    mockDb.limit.mockImplementation(() => {
      const result = resultQueue.shift();
      return Promise.resolve(result ?? []);
    });
    mockDb.then.mockImplementation((resolve: any) => {
      const result = whereTerminalQueue.shift();
      return Promise.resolve(result ?? []).then(resolve);
    });
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValue([]);
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
  });

  // --- summary ---

  it("summary returns stats for a specific repo", async () => {
    // lookupUserId — role: "admin" bypasses permission resolution
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // requireAccessibleRepo is mocked (called twice: idea + task conditions)
    // ideaCounts query: select().from().where().groupBy() — terminal groupBy → then
    whereTerminalQueue.push([{ status: "draft", count: 3 }]);
    // taskCounts query: select().from().where().groupBy() — terminal groupBy → then
    whereTerminalQueue.push([{ status: "in_progress", count: 5 }]);
    // epicCounts query: select().from().where().groupBy() — terminal groupBy → then
    whereTerminalQueue.push([{ status: "draft", count: 2 }]);

    const caller = createCaller(true);
    const result = await caller.stats.summary({ repoId: REPO_ID });

    expect(result).toHaveProperty("ideas");
    expect(result).toHaveProperty("tasks");
    expect(result).toHaveProperty("epics");
    expect(result).toHaveProperty("totals");
  });

  it("summary requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.stats.summary({ repoId: null }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  it("summary throws FORBIDDEN when user lacks stats:read permission", async () => {
    // lookupUserId — non-admin user
    resultQueue.push([{ id: USER_ID, role: "user", roleId: null }]);
    // resolveUserPermissions: terminal where → pulled from whereTerminalQueue
    whereTerminalQueue.push([]); // no overrides → no permissions → FORBIDDEN

    const caller = createCaller(true);
    await expect(
      caller.stats.summary({ repoId: null }),
    ).rejects.toThrow("Missing permissions: stats:read");
  });

  // --- timeline ---

  it("timeline returns timeline data for a specific repo", async () => {
    // lookupUserId — role: "admin" bypasses permission resolution
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // requireAccessibleRepo is mocked (called twice: idea + task conditions)
    // ideaTimeline query: select().from().where().groupBy().orderBy() — terminal orderBy → then
    whereTerminalQueue.push([{ date: "2026-03-18", status: "draft", count: 2 }]);
    // epicTimeline query: select().from().where().groupBy().orderBy() — terminal orderBy → then
    whereTerminalQueue.push([{ date: "2026-03-18", status: "draft", count: 1 }]);
    // taskTimeline query: select().from().where().groupBy().orderBy() — terminal orderBy → then
    whereTerminalQueue.push([{ date: "2026-03-18", status: "in_progress", count: 3 }]);

    const caller = createCaller(true);
    const result = await caller.stats.timeline({ repoId: REPO_ID, days: 7 });

    expect(result).toHaveProperty("ideas");
    expect(result).toHaveProperty("epics");
    expect(result).toHaveProperty("tasks");
  });

  it("timeline requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.stats.timeline({ repoId: null, days: 30 }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  it("timeline throws FORBIDDEN when user lacks stats:read permission", async () => {
    // lookupUserId — non-admin user
    resultQueue.push([{ id: USER_ID, role: "user", roleId: null }]);
    // resolveUserPermissions: terminal where → pulled from whereTerminalQueue
    whereTerminalQueue.push([]); // no overrides → no permissions → FORBIDDEN

    const caller = createCaller(true);
    await expect(
      caller.stats.timeline({ repoId: null, days: 30 }),
    ).rejects.toThrow("Missing permissions: stats:read");
  });
});
