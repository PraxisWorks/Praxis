import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/index.js", () => ({
  getConnectionString: vi.fn(() => "postgresql://mock"),
  getDb: vi.fn(() => ({})),
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "mock-jwks"),
  jwtVerify: vi.fn().mockResolvedValue({
    payload: { sub: "user123", email: "admin@example.com" },
    protectedHeader: { alg: "RS256" },
  }),
}));

vi.mock("../lib/logger.js", () => ({
  getLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn() })),
}));

vi.mock("../jobs/index.js", () => ({
  enqueueJob: vi.fn().mockResolvedValue("job-123"),
}));

vi.mock("../middleware/requirePermission.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware/requirePermission.js")>();
  return {
    ...actual,
    resolveUserPermissions: vi.fn().mockResolvedValue(new Set<string>()),
  };
});

import { appRouter } from "./index.js";

describe("adminRouter.getUserStats", () => {
  const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
  const TARGET_USER_ID = "660e8400-e29b-41d4-a716-446655440001";

  const mockAdminUser = {
    id: USER_ID,
    sub: "user123",
    email: "admin@example.com",
    name: "Admin User",
    role: "admin",
    roleId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPubsub = {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    close: vi.fn(),
  };

  /**
   * Queue-based mock DB following the project pattern from permission.test.ts.
   *
   * - `resultQueue`  feeds `.limit()` calls (terminal for queries that end in .limit())
   * - `orderByQueue` feeds the `.then()` thenable on mockDb (terminal for queries
   *    that end in .orderBy(), .groupBy(), or bare .where() awaited directly)
   */
  let resultQueue: unknown[];
  let orderByQueue: unknown[];

  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn(function (this: any) { return this; }),
    groupBy: vi.fn(function (this: any) { return this; }),
    limit: vi.fn(() => {
      const result = resultQueue.shift();
      return Promise.resolve(result ?? []);
    }),
    then: vi.fn((resolve: any) => {
      const result = orderByQueue.shift();
      return Promise.resolve(result ?? []).then(resolve);
    }),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };

  const createAdminCaller = () =>
    appRouter.createCaller({
      user: { sub: "user123", email: "admin@example.com" },
      db: mockDb as any,
      pubsub: mockPubsub as any,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    resultQueue = [];
    orderByQueue = [];

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockImplementation(function (this: any) { return this; });
    mockDb.groupBy.mockImplementation(function (this: any) { return this; });
    mockDb.limit.mockImplementation(() => {
      const result = resultQueue.shift();
      return Promise.resolve(result ?? []);
    });
    mockDb.then.mockImplementation((resolve: any) => {
      const result = orderByQueue.shift();
      return Promise.resolve(result ?? []).then(resolve);
    });
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValue([]);
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.delete.mockReturnThis();
  });

  it("returns correct session counts grouped by type", async () => {
    const mockUser = {
      id: TARGET_USER_ID,
      lastLoginAt: new Date("2025-03-01"),
      createdAt: new Date("2024-01-01"),
    };
    const lastSessionDate = new Date("2025-03-15");

    // protectedProcedure: lookupUserId → admin user
    resultQueue.push([mockAdminUser]);
    // getUserStats query 1: select().from(users).where().limit(1) → target user
    resultQueue.push([mockUser]);
    // getUserStats query 2: select({type,count}).from(sessions).where().groupBy() → session counts
    orderByQueue.push([
      { type: "working", count: 5 },
      { type: "debug", count: 2 },
    ]);
    // getUserStats query 3: select({lastSessionAt}).from(sessions).where() → last session
    orderByQueue.push([{ lastSessionAt: lastSessionDate }]);

    const caller = createAdminCaller();
    const result = await caller.admin.getUserStats({ userId: TARGET_USER_ID });

    expect(result.totalSessions).toBe(7);
    expect(result.sessionsByType).toEqual({ working: 5, debug: 2 });
    expect(result.lastSessionAt).toEqual(lastSessionDate);
    expect(result.lastLoginAt).toEqual(mockUser.lastLoginAt);
    expect(result.createdAt).toEqual(mockUser.createdAt);
  });

  it("returns zero counts for user with no sessions", async () => {
    const mockUser = {
      id: TARGET_USER_ID,
      lastLoginAt: null,
      createdAt: new Date("2024-01-01"),
    };

    // protectedProcedure: lookupUserId → admin user
    resultQueue.push([mockAdminUser]);
    // getUserStats query 1: user exists
    resultQueue.push([mockUser]);
    // getUserStats query 2: no session counts
    orderByQueue.push([]);
    // getUserStats query 3: no last session
    orderByQueue.push([{ lastSessionAt: null }]);

    const caller = createAdminCaller();
    const result = await caller.admin.getUserStats({ userId: TARGET_USER_ID });

    expect(result.totalSessions).toBe(0);
    expect(result.sessionsByType).toEqual({});
    expect(result.lastSessionAt).toBeNull();
    expect(result.lastLoginAt).toBeNull();
    expect(result.createdAt).toEqual(mockUser.createdAt);
  });

  it("requires admin permission (FORBIDDEN when no dbUser)", async () => {
    // protectedProcedure: lookupUserId → no user found (dbUser = null)
    resultQueue.push([]);

    const caller = createAdminCaller();

    await expect(
      caller.admin.getUserStats({ userId: TARGET_USER_ID }),
    ).rejects.toThrow("User account required");
  });

  it("throws NOT_FOUND for non-existent target user", async () => {
    const nonExistentId = "990e8400-e29b-41d4-a716-446655440099";

    // protectedProcedure: lookupUserId → admin user
    resultQueue.push([mockAdminUser]);
    // getUserStats query 1: user does not exist
    resultQueue.push([]);

    const caller = createAdminCaller();

    await expect(
      caller.admin.getUserStats({ userId: nonExistentId }),
    ).rejects.toThrow("User not found");
  });
});
