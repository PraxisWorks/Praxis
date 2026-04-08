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
  getLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn() })),
}));

vi.mock("../jobs/index.js", () => ({
  enqueueJob: vi.fn().mockResolvedValue("job-123"),
}));

vi.mock("../services/storage/index.js", () => ({
  getStorageAdapter: vi.fn(() => ({
    upload: vi.fn().mockResolvedValue({ storageKey: "test-key", sizeBytes: 100 }),
    download: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
    getUrl: vi.fn(() => "http://test.com/file"),
  })),
}));

vi.mock("../lib/requireOrgMember.js", () => ({
  requireOrgMember: vi.fn().mockResolvedValue({ orgId: "mock", userId: "mock", role: "owner" }),
}));

vi.mock("../lib/requireAccessibleRepo.js", () => ({
  requireAccessibleRepo: vi.fn().mockResolvedValue({
    id: "660e8400-e29b-41d4-a716-446655440001",
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

describe("idea.list phase progress subqueries", () => {
  const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
  const REPO_ID = "660e8400-e29b-41d4-a716-446655440001";
  const IDEA_ID = "770e8400-e29b-41d4-a716-446655440002";

  const mockPubsub = {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    close: vi.fn(),
  };

  let resultQueue: unknown[];
  let whereTerminalQueue: unknown[];

  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn(function (this: any) { return this; }),
    orderBy: vi.fn().mockResolvedValue([]),
    limit: vi.fn(() => {
      const result = resultQueue.shift();
      return Promise.resolve(result ?? []);
    }),
    then: vi.fn((resolve: any) => {
      const result = whereTerminalQueue.shift();
      return Promise.resolve(result ?? []).then(resolve);
    }),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };

  const createCaller = () =>
    appRouter.createCaller({
      user: { sub: "user123", email: "test@example.com" },
      db: mockDb as any,
      pubsub: mockPubsub as any,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    resultQueue = [];
    whereTerminalQueue = [];

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.leftJoin.mockReturnThis();
    mockDb.where.mockImplementation(function (this: any) { return this; });
    mockDb.orderBy.mockResolvedValue([]);
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
    mockDb.delete.mockReturnThis();
  });

  it("returns latestPhaseNumber and latestPhaseName when present", async () => {
    const mockRow = {
      id: IDEA_ID,
      repoId: REPO_ID,
      userId: USER_ID,
      title: "Test idea",
      description: "desc",
      status: "planning",
      source: "human",
      tags: [],
      size: null,
      order: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      repoColor: null,
      repoName: "Test Repo",
      repoIcon: null,
      planId: null,
      planStatus: null,
      topEpicId: null,
      completedTaskCount: 2,
      totalTaskCount: 5,
      latestPhaseNumber: 3,
      latestPhaseName: "Architecture",
    };

    // lookupUserId middleware
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // list query (terminal is orderBy)
    mockDb.orderBy.mockResolvedValueOnce([mockRow]);

    const caller = createCaller();
    const result = await caller.idea.list({ repoId: REPO_ID });

    expect(result).toHaveLength(1);
    expect(result[0].latestPhaseNumber).toBe(3);
    expect(result[0].latestPhaseName).toBe("Architecture");
  });

  it("returns latestPhaseNumber 0 and null name when no phases exist", async () => {
    const mockRow = {
      id: IDEA_ID,
      repoId: REPO_ID,
      userId: USER_ID,
      title: "Fresh idea",
      description: "no phases yet",
      status: "new",
      source: "human",
      tags: [],
      size: null,
      order: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      repoColor: null,
      repoName: "Test Repo",
      repoIcon: null,
      planId: null,
      planStatus: null,
      topEpicId: null,
      completedTaskCount: 0,
      totalTaskCount: 0,
      latestPhaseNumber: 0,
      latestPhaseName: null,
    };

    // lookupUserId middleware
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // list query (terminal is orderBy)
    mockDb.orderBy.mockResolvedValueOnce([mockRow]);

    const caller = createCaller();
    const result = await caller.idea.list({ repoId: REPO_ID });

    expect(result).toHaveLength(1);
    expect(result[0].latestPhaseNumber).toBe(0);
    expect(result[0].latestPhaseName).toBeNull();
  });
});
