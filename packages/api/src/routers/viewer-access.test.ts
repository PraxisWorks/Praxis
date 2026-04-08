import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/index.js", () => ({
  getConnectionString: vi.fn(() => "postgresql://mock"),
  getDb: vi.fn(() => ({})),
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "mock-jwks"),
  jwtVerify: vi.fn().mockResolvedValue({
    payload: { sub: "user123", email: "viewer@example.com" },
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
    upload: vi.fn(),
    download: vi.fn(),
    delete: vi.fn(),
    getUrl: vi.fn(() => "http://test.com/file"),
  })),
}));

vi.mock("../lib/requireOrgMember.js", () => ({
  requireOrgMember: vi.fn().mockResolvedValue({ orgId: "mock", userId: "mock", role: "member" }),
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

describe("viewer-access", () => {
  const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
  const ROLE_ID = "aa0e8400-e29b-41d4-a716-446655440099";
  const REPO_ID = "660e8400-e29b-41d4-a716-446655440001";
  const IDEA_ID = "770e8400-e29b-41d4-a716-446655440002";
  const SPEC_ID = "880e8400-e29b-41d4-a716-446655440003";

  const READ_PERMISSIONS = [
    "idea:read",
    "task:read",
    "plan:read",
    "repo:read",
    "session:read",
    "stats:read",
    "spec:read",
  ];

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
    groupBy: vi.fn().mockReturnThis(),
    as: vi.fn().mockReturnValue({
      sessionId: "sessionId",
      lastMessageAt: "lastMessageAt",
    }),
  };

  const createCaller = () =>
    appRouter.createCaller({
      user: { sub: "user123", email: "viewer@example.com" },
      db: mockDb as any,
      pubsub: mockPubsub as any,
    });

  /**
   * Push the standard mock responses for a viewer user through the
   * permission resolution pipeline:
   * 1. lookupUserId (limit-terminal) -> viewer user with roleId
   * 2. rolePermissions query (where-terminal) -> 7 read permissions
   * 3. userPermissionOverrides query (where-terminal) -> empty
   */
  function pushViewerAuth() {
    // protectedProcedure: db.select().from(users).where().limit(1)
    resultQueue.push([{ id: USER_ID, role: "user", roleId: ROLE_ID }]);
    // resolveUserPermissions: rolePermissions query (terminal where -> then)
    whereTerminalQueue.push(READ_PERMISSIONS.map((p) => ({ permissionKey: p })));
    // resolveUserPermissions: userPermissionOverrides query (terminal where -> then)
    whereTerminalQueue.push([]);
  }

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
    mockDb.groupBy.mockReturnThis();
    mockDb.as.mockReturnValue({
      sessionId: "sessionId",
      lastMessageAt: "lastMessageAt",
    });
  });

  // ---------------------------------------------------------------
  // Viewer CAN access read endpoints
  // ---------------------------------------------------------------

  describe("viewer can access read endpoints", () => {
    it("viewer can call idea.list", async () => {
      pushViewerAuth();
      // requireAccessibleRepo is mocked
      // idea.list query (terminal is orderBy)
      const mockIdea = {
        id: IDEA_ID,
        repoId: REPO_ID,
        userId: USER_ID,
        title: "Test Idea",
        description: "A test idea",
        status: "new",
        source: "human",
        tags: [],
        size: null,
        order: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        repoColor: "#6366f1",
        repoName: "Test Repo",
        repoIcon: null,
        planId: null,
        planStatus: null,
        topEpicId: null,
        completedTaskCount: 0,
        totalTaskCount: 0,
      };
      mockDb.orderBy.mockResolvedValueOnce([mockIdea]);

      const caller = createCaller();
      const result = await caller.idea.list({ repoId: REPO_ID });

      expect(result).toEqual([mockIdea]);
    });

    it("viewer can call idea.getById", async () => {
      pushViewerAuth();
      // getById lookup (limit-terminal)
      const mockIdea = {
        id: IDEA_ID,
        repoId: REPO_ID,
        userId: USER_ID,
        title: "Test Idea",
        description: "A test idea",
        status: "new",
        source: "human",
        tags: [],
        size: null,
        order: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      resultQueue.push([mockIdea]);
      // requireAccessibleRepo is mocked

      const caller = createCaller();
      const result = await caller.idea.getById({ id: IDEA_ID });

      expect(result).toEqual(mockIdea);
    });

    it("viewer can call repo.list", async () => {
      pushViewerAuth();
      // getUserOrgIds is mocked -> Set(["mock-org"])
      // orgRigs query: select().from(rigs).where(inArray) -- terminal where -> then
      whereTerminalQueue.push([{ id: REPO_ID }]);
      // list query: terminal is orderBy
      const mockRepo = {
        id: REPO_ID,
        orgId: "mock-org",
        name: "Test Repo",
        status: "active",
        createdAt: new Date(),
      };
      mockDb.orderBy.mockResolvedValueOnce([mockRepo]);

      const caller = createCaller();
      const result = await caller.repo.list();

      expect(result).toEqual([mockRepo]);
    });

    it("viewer can call stats.summary", async () => {
      pushViewerAuth();
      // requireAccessibleRepo is mocked (stats uses it when repoId is provided)
      // ideaCounts query: select().from(ideas).where().groupBy() -- terminal groupBy -> then
      // Note: groupBy is the terminal call here, which chains to then()
      // The stats router uses complex query chains:
      //   db.select().from(ideas).where(and(...)).groupBy(ideas.status)
      // groupBy returns mockDb (this), which is thenable via .then()
      whereTerminalQueue.push([{ status: "new", count: 3 }]);
      // taskCounts query: terminal groupBy -> then
      whereTerminalQueue.push([{ status: "ready", count: 5 }]);
      // epicCounts query: terminal groupBy -> then
      whereTerminalQueue.push([{ status: "ready", count: 1 }]);

      const caller = createCaller();
      const result = await caller.stats.summary({ repoId: REPO_ID });

      expect(result).toHaveProperty("ideas");
      expect(result).toHaveProperty("tasks");
      expect(result).toHaveProperty("epics");
      expect(result).toHaveProperty("totals");
    });

    it("viewer can call spec.getByRepo", async () => {
      pushViewerAuth();
      // requireAccessibleRepo is mocked
      // spec lookup (limit-terminal)
      const mockSpec = {
        id: SPEC_ID,
        repoId: REPO_ID,
        title: "Project Spec",
        content: "# Overview",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      resultQueue.push([mockSpec]);

      const caller = createCaller();
      const result = await caller.spec.getByRepo({ repoId: REPO_ID });

      expect(result).toEqual(mockSpec);
    });

    it("viewer can call plan.getByIdea", async () => {
      pushViewerAuth();
      // idea lookup (limit-terminal)
      const mockIdea = {
        id: IDEA_ID,
        repoId: REPO_ID,
        userId: USER_ID,
        title: "Test Idea",
        status: "new",
      };
      resultQueue.push([mockIdea]);
      // requireAccessibleRepo is mocked
      // plan lookup (limit-terminal)
      const mockPlan = {
        id: "990e8400-e29b-41d4-a716-446655440010",
        ideaId: IDEA_ID,
        status: "draft",
        proposal: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      resultQueue.push([mockPlan]);

      const caller = createCaller();
      const result = await caller.plan.getByIdea({ ideaId: IDEA_ID });

      expect(result).toEqual(mockPlan);
    });

    it("viewer can call session.list", async () => {
      pushViewerAuth();
      // getUserOrgIds is mocked -> Set(["mock-org"])
      // orgRigs query: select().from(rigs).where(inArray) -- terminal where -> then
      whereTerminalQueue.push([{ id: REPO_ID }]);
      // subquery: select().from(sessionMessages).groupBy().as() -- handled by mock chain
      // main query: select().from(sessions).leftJoin()...where().orderBy().limit()
      // orderBy must return this (not a Promise) so .limit() can chain
      mockDb.orderBy.mockReturnValueOnce(mockDb);
      // terminal is limit()
      resultQueue.push([]);

      const caller = createCaller();
      const result = await caller.session.list({});

      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------
  // Viewer CANNOT access write endpoints without read permission
  // (write endpoints use protectedProcedure, not requirePermission,
  //  so this section verifies viewer is denied from endpoints that
  //  DO require permissions the viewer does not have)
  // ---------------------------------------------------------------

  describe("viewer is denied on endpoints requiring non-read permissions", () => {
    it("viewer cannot call session.startDebug (requires session:create:debug)", async () => {
      // lookupUserId -> viewer user
      resultQueue.push([{ id: USER_ID, role: "user", roleId: ROLE_ID }]);
      // resolveUserPermissions: rolePermissions -> only read perms (no session:create:debug)
      whereTerminalQueue.push(READ_PERMISSIONS.map((p) => ({ permissionKey: p })));
      // resolveUserPermissions: userPermissionOverrides -> empty
      whereTerminalQueue.push([]);

      const caller = createCaller();
      await expect(
        caller.session.startDebug({
          repoId: REPO_ID,
          entityType: "task",
          entityId: "770e8400-e29b-41d4-a716-446655440099",
        }),
      ).rejects.toThrow("Missing permissions");
    });

    it("viewer cannot call session.startWork (requires session:create:working)", async () => {
      // lookupUserId -> viewer user
      resultQueue.push([{ id: USER_ID, role: "user", roleId: ROLE_ID }]);
      // resolveUserPermissions: rolePermissions -> only read perms
      whereTerminalQueue.push(READ_PERMISSIONS.map((p) => ({ permissionKey: p })));
      // resolveUserPermissions: userPermissionOverrides -> empty
      whereTerminalQueue.push([]);

      const caller = createCaller();
      await expect(
        caller.session.startWork({
          repoId: REPO_ID,
          entityType: "task",
          entityId: "770e8400-e29b-41d4-a716-446655440099",
        }),
      ).rejects.toThrow("Missing permissions");
    });

    it("viewer cannot call session.startRepoSession (requires session:create:repo)", async () => {
      // lookupUserId -> viewer user
      resultQueue.push([{ id: USER_ID, role: "user", roleId: ROLE_ID }]);
      // resolveUserPermissions: rolePermissions -> only read perms
      whereTerminalQueue.push(READ_PERMISSIONS.map((p) => ({ permissionKey: p })));
      // resolveUserPermissions: userPermissionOverrides -> empty
      whereTerminalQueue.push([]);

      const caller = createCaller();
      await expect(
        caller.session.startRepoSession({
          repoId: REPO_ID,
        }),
      ).rejects.toThrow("Missing permissions");
    });
  });
});
