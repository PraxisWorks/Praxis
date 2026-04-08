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

describe("ideaRouter", () => {
  const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
  const REPO_ID = "660e8400-e29b-41d4-a716-446655440001";
  const IDEA_ID = "770e8400-e29b-41d4-a716-446655440002";

  const mockIdea = {
    id: IDEA_ID,
    repoId: REPO_ID,
    userId: USER_ID,
    title: "Add auth",
    description: "Implement authentication",
    status: "new",
    source: "human",
    tags: [],
    size: null,
    order: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPubsub = {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    close: vi.fn(),
  };

  let resultQueue: unknown[];
  // Queue for where()-terminal calls (awaited directly without .limit())
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
    // Make mockDb thenable so `await db.select().from().where()` works
    // when where() is the terminal call (e.g. orgRepos query).
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

  // --- list ---

  it("list returns ideas for a repo", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // requireAccessibleRepo is mocked — no resultQueue entry needed
    // list query (terminal is orderBy)
    mockDb.orderBy.mockResolvedValueOnce([mockIdea]);

    const caller = createCaller(true);
    const result = await caller.idea.list({ repoId: REPO_ID });
    expect(result).toEqual([mockIdea]);
  });

  it("list returns ideas from all repos when repoId is null", async () => {
    const REPO_ID_2 = "660e8400-e29b-41d4-a716-446655440099";
    const idea2 = {
      ...mockIdea,
      id: "770e8400-e29b-41d4-a716-446655440099",
      repoId: REPO_ID_2,
      repoColor: "#22c55e",
      repoName: "Repo 2",
      repoIcon: null,
    };

    // lookupUserId
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // getUserOrgIds is mocked
    // orgRepos query: select().from(repos).where() — terminal where, resolved via then()
    whereTerminalQueue.push([{ id: REPO_ID }, { id: REPO_ID_2 }]);
    // list query (terminal is orderBy via leftJoin chain)
    mockDb.orderBy.mockResolvedValueOnce([
      { ...mockIdea, repoColor: "#6366f1", repoName: "Test Repo", repoIcon: null },
      idea2,
    ]);

    const caller = createCaller(true);
    const result = await caller.idea.list({ repoId: null });
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveProperty("repoColor");
    expect(result[0]).toHaveProperty("repoName");
    expect(result[0]).toHaveProperty("repoIcon");
  });

  it("list with repoId null and status filter returns filtered ideas", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // orgRepos query (terminal where)
    whereTerminalQueue.push([{ id: REPO_ID }]);
    // list query
    mockDb.orderBy.mockResolvedValueOnce([
      { ...mockIdea, status: "planning", repoColor: "#6366f1", repoName: "Test Repo", repoIcon: null },
    ]);

    const caller = createCaller(true);
    const result = await caller.idea.list({ repoId: null, status: "planning" });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("planning");
  });

  it("list requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.idea.list({ repoId: REPO_ID }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // --- read permission gates ---

  it("list throws FORBIDDEN when user lacks idea:read permission", async () => {
    // lookupUserId — non-admin user with no roleId (no permissions resolved)
    resultQueue.push([{ id: USER_ID, role: "user", roleId: null }]);
    // resolveUserPermissions: userPermissionOverrides query (terminal where → then)
    whereTerminalQueue.push([]); // no overrides

    const caller = createCaller(true);
    await expect(
      caller.idea.list({ repoId: REPO_ID }),
    ).rejects.toThrow("Missing permissions: idea:read");
  });

  it("getById throws FORBIDDEN when user lacks idea:read permission", async () => {
    resultQueue.push([{ id: USER_ID, role: "user", roleId: null }]);
    whereTerminalQueue.push([]); // no overrides

    const caller = createCaller(true);
    await expect(
      caller.idea.getById({ id: IDEA_ID }),
    ).rejects.toThrow("Missing permissions: idea:read");
  });

  it("listAttachments throws FORBIDDEN when user lacks idea:read permission", async () => {
    resultQueue.push([{ id: USER_ID, role: "user", roleId: null }]);
    whereTerminalQueue.push([]); // no overrides

    const caller = createCaller(true);
    await expect(
      caller.idea.listAttachments({ ideaId: IDEA_ID }),
    ).rejects.toThrow("Missing permissions: idea:read");
  });

  it("list returns null/0 enriched fields for idea with no plan", async () => {
    const enrichedIdea = {
      ...mockIdea,
      repoColor: "#6366f1",
      repoName: "Test Repo",
      repoIcon: null,
      planId: null,
      planStatus: null,
      topEpicId: null,
      completedTaskCount: 0,
      totalTaskCount: 0,
    };

    // lookupUserId
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // requireAccessibleRepo is mocked
    // list query (terminal is orderBy)
    mockDb.orderBy.mockResolvedValueOnce([enrichedIdea]);

    const caller = createCaller(true);
    const result = await caller.idea.list({ repoId: REPO_ID });
    expect(result[0]).toHaveProperty("planId", null);
    expect(result[0]).toHaveProperty("planStatus", null);
    expect(result[0]).toHaveProperty("topEpicId", null);
    expect(result[0]).toHaveProperty("completedTaskCount", 0);
    expect(result[0]).toHaveProperty("totalTaskCount", 0);
  });

  it("list returns planId and planStatus for idea with draft plan", async () => {
    const PLAN_ID = "aa0e8400-e29b-41d4-a716-446655440020";
    const enrichedIdea = {
      ...mockIdea,
      repoColor: "#6366f1",
      repoName: "Test Repo",
      repoIcon: null,
      planId: PLAN_ID,
      planStatus: "draft",
      topEpicId: null,
      completedTaskCount: 0,
      totalTaskCount: 0,
    };

    // lookupUserId
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // requireAccessibleRepo is mocked
    // list query (terminal is orderBy)
    mockDb.orderBy.mockResolvedValueOnce([enrichedIdea]);

    const caller = createCaller(true);
    const result = await caller.idea.list({ repoId: REPO_ID });
    expect(result[0]).toHaveProperty("planId", PLAN_ID);
    expect(result[0]).toHaveProperty("planStatus", "draft");
    expect(result[0]).toHaveProperty("topEpicId", null);
    expect(result[0]).toHaveProperty("completedTaskCount", 0);
    expect(result[0]).toHaveProperty("totalTaskCount", 0);
  });

  it("list returns topEpicId and task counts for idea with accepted plan", async () => {
    const PLAN_ID = "aa0e8400-e29b-41d4-a716-446655440021";
    const EPIC_ID = "bb0e8400-e29b-41d4-a716-446655440030";
    const enrichedIdea = {
      ...mockIdea,
      status: "planned",
      repoColor: "#6366f1",
      repoName: "Test Repo",
      repoIcon: null,
      planId: PLAN_ID,
      planStatus: "accepted",
      topEpicId: EPIC_ID,
      completedTaskCount: 0,
      totalTaskCount: 5,
    };

    // lookupUserId
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // requireAccessibleRepo is mocked
    // list query (terminal is orderBy)
    mockDb.orderBy.mockResolvedValueOnce([enrichedIdea]);

    const caller = createCaller(true);
    const result = await caller.idea.list({ repoId: REPO_ID });
    expect(result[0]).toHaveProperty("planId", PLAN_ID);
    expect(result[0]).toHaveProperty("planStatus", "accepted");
    expect(result[0]).toHaveProperty("topEpicId", EPIC_ID);
    expect(result[0]).toHaveProperty("completedTaskCount", 0);
    expect(result[0]).toHaveProperty("totalTaskCount", 5);
  });

  it("list returns correct completedTaskCount when some tasks are complete", async () => {
    const PLAN_ID = "aa0e8400-e29b-41d4-a716-446655440022";
    const EPIC_ID = "bb0e8400-e29b-41d4-a716-446655440031";
    const enrichedIdea = {
      ...mockIdea,
      status: "planned",
      repoColor: "#6366f1",
      repoName: "Test Repo",
      repoIcon: null,
      planId: PLAN_ID,
      planStatus: "accepted",
      topEpicId: EPIC_ID,
      completedTaskCount: 3,
      totalTaskCount: 7,
    };

    // lookupUserId
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // requireAccessibleRepo is mocked
    // list query (terminal is orderBy)
    mockDb.orderBy.mockResolvedValueOnce([enrichedIdea]);

    const caller = createCaller(true);
    const result = await caller.idea.list({ repoId: REPO_ID });
    expect(result[0]).toHaveProperty("planId", PLAN_ID);
    expect(result[0]).toHaveProperty("planStatus", "accepted");
    expect(result[0]).toHaveProperty("topEpicId", EPIC_ID);
    expect(result[0]).toHaveProperty("completedTaskCount", 3);
    expect(result[0]).toHaveProperty("totalTaskCount", 7);
  });

  // --- create ---

  it("create inserts idea and publishes sync", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // requireAccessibleRepo is mocked
    // MAX(order) query
    resultQueue.push([{ maxOrder: -1 }]);
    // insert().values().returning()
    mockDb.returning.mockResolvedValueOnce([mockIdea]);

    const caller = createCaller(true);
    const result = await caller.idea.create({
      repoId: REPO_ID,
      title: "Add auth",
      description: "Implement authentication",
    });

    expect(result).toEqual(mockIdea);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:idea",
      expect.objectContaining({ action: "created" }),
    );
  });

  it("create requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.idea.create({
        repoId: REPO_ID,
        title: "Auth",
        description: "Desc",
      }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // --- update ---

  it("update modifies idea and publishes sync", async () => {
    const updatedIdea = { ...mockIdea, title: "Updated" };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // Fetch existing idea
    resultQueue.push([mockIdea]);
    // requireAccessibleRepo is mocked
    // update().set().where().returning()
    mockDb.returning.mockResolvedValue([updatedIdea]);

    const caller = createCaller(true);
    const result = await caller.idea.update({
      id: IDEA_ID,
      data: { title: "Updated" },
    });

    expect(result).toEqual(updatedIdea);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:idea",
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("update throws NOT_FOUND for missing idea", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // Fetch existing — not found
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.idea.update({ id: IDEA_ID, data: { title: "X" } }),
    ).rejects.toThrow("Idea not found");
  });

  it("update rejects title change when idea is not in 'new' status", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // Fetch existing idea — status is 'planning'
    resultQueue.push([{ ...mockIdea, status: "planning" }]);
    // requireAccessibleRepo is mocked

    const caller = createCaller(true);
    await expect(
      caller.idea.update({ id: IDEA_ID, data: { title: "New title" } }),
    ).rejects.toThrow("Title, description, and size can only be edited when the idea is in 'new' status");
  });

  it("update rejects description change when idea is not in 'new' status", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // Fetch existing idea — status is 'complete'
    resultQueue.push([{ ...mockIdea, status: "complete" }]);
    // requireAccessibleRepo is mocked

    const caller = createCaller(true);
    await expect(
      caller.idea.update({ id: IDEA_ID, data: { description: "New desc" } }),
    ).rejects.toThrow("Title, description, and size can only be edited when the idea is in 'new' status");
  });

  it("update allows status change on non-new idea", async () => {
    const updatedIdea = { ...mockIdea, status: "dismissed" };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // Fetch existing idea — status is 'planning'
    resultQueue.push([{ ...mockIdea, status: "planning" }]);
    // requireAccessibleRepo is mocked
    // update().set().where().returning()
    mockDb.returning.mockResolvedValueOnce([updatedIdea]);

    const caller = createCaller(true);
    const result = await caller.idea.update({
      id: IDEA_ID,
      data: { status: "dismissed" },
    });
    expect(result.status).toBe("dismissed");
  });

  it("update allows title change on 'new' idea", async () => {
    const updatedIdea = { ...mockIdea, title: "New title" };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // Fetch existing idea — status is 'new'
    resultQueue.push([mockIdea]);
    // requireAccessibleRepo is mocked
    // update().set().where().returning()
    mockDb.returning.mockResolvedValueOnce([updatedIdea]);

    const caller = createCaller(true);
    const result = await caller.idea.update({
      id: IDEA_ID,
      data: { title: "New title" },
    });
    expect(result.title).toBe("New title");
  });

  it("create with size stores the size value", async () => {
    const ideaWithSize = { ...mockIdea, size: "m" };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // requireAccessibleRepo is mocked
    // MAX(order) query
    resultQueue.push([{ maxOrder: -1 }]);
    // insert().values().returning()
    mockDb.returning.mockResolvedValueOnce([ideaWithSize]);

    const caller = createCaller(true);
    const result = await caller.idea.create({
      repoId: REPO_ID,
      title: "Add auth",
      description: "Implement authentication",
      size: "m",
    });

    expect(result.size).toBe("m");
  });

  it("create without size defaults to null", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // requireAccessibleRepo is mocked
    // MAX(order) query
    resultQueue.push([{ maxOrder: -1 }]);
    // insert().values().returning()
    mockDb.returning.mockResolvedValueOnce([mockIdea]);

    const caller = createCaller(true);
    const result = await caller.idea.create({
      repoId: REPO_ID,
      title: "Add auth",
      description: "Implement authentication",
    });

    expect(result.size).toBeNull();
  });

  it("update size on new idea succeeds", async () => {
    const updatedIdea = { ...mockIdea, size: "l" };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // Fetch existing idea — status is 'new'
    resultQueue.push([mockIdea]);
    // requireAccessibleRepo is mocked
    // update().set().where().returning()
    mockDb.returning.mockResolvedValueOnce([updatedIdea]);

    const caller = createCaller(true);
    const result = await caller.idea.update({
      id: IDEA_ID,
      data: { size: "l" },
    });
    expect(result.size).toBe("l");
  });

  it("update size on non-new idea is rejected", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // Fetch existing idea — status is 'planning'
    resultQueue.push([{ ...mockIdea, status: "planning" }]);
    // requireAccessibleRepo is mocked

    const caller = createCaller(true);
    await expect(
      caller.idea.update({ id: IDEA_ID, data: { size: "xl" } }),
    ).rejects.toThrow("Title, description, and size can only be edited when the idea is in 'new' status");
  });

  it("size is included in list response", async () => {
    const ideaWithSize = { ...mockIdea, size: "s", repoColor: "#6366f1", repoName: "Test Repo", repoIcon: null };

    // lookupUserId
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // requireAccessibleRepo is mocked
    // list query (terminal is orderBy)
    mockDb.orderBy.mockResolvedValueOnce([ideaWithSize]);

    const caller = createCaller(true);
    const result = await caller.idea.list({ repoId: REPO_ID });
    expect(result[0].size).toBe("s");
  });

  it("size is included in getById response", async () => {
    const ideaWithSize = { ...mockIdea, size: "xl" };

    // lookupUserId
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // getById lookup
    resultQueue.push([ideaWithSize]);
    // requireAccessibleRepo is mocked

    const caller = createCaller(true);
    const result = await caller.idea.getById({ id: IDEA_ID });
    expect(result.size).toBe("xl");
  });

  // --- auto-trigger architecture session on create ---

  const SESSION_ID = "990e8400-e29b-41d4-a716-446655440004";

  it("creating an idea with size 'xs' enqueues a session.start job with full-ai phaseConfig and autoAccept", async () => {
    const { enqueueJob } = await import("../jobs/index.js");

    const xsIdea = { ...mockIdea, size: "xs" };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // requireAccessibleRepo is mocked
    // MAX(order) query
    resultQueue.push([{ maxOrder: -1 }]);
    // insert().values().returning() — idea insert
    mockDb.returning.mockResolvedValueOnce([xsIdea]);
    // resolveWorkerForSession: repo lookup (orgId)
    resultQueue.push([{ orgId: "mock-org" }]);
    // resolveWorkerForSession: org lookup (workerPolicy)
    resultQueue.push([{ workerPolicy: "user_default", centralWorkerId: null }]);
    // resolveWorkerForSession: user activeWorkerId lookup
    resultQueue.push([{ activeWorkerId: null }]);
    // resolveWorkerForSession: central worker online check
    resultQueue.push([{ id: "00000000-0000-0000-0000-000000000000" }]);
    // insert(sessions).values().returning() — session insert
    mockDb.returning.mockResolvedValueOnce([{
      id: SESSION_ID,
      repoId: REPO_ID,
      userId: USER_ID,
      type: "architecture",
      entityType: "idea",
      entityId: IDEA_ID,
      title: "Architecture: Add auth",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    }]);
    // select().from(ideaAttachments).where().orderBy() — attachments query
    mockDb.orderBy.mockResolvedValueOnce([]);

    const caller = createCaller(true);
    const result = await caller.idea.create({
      repoId: REPO_ID,
      title: "Add auth",
      description: "Implement authentication",
      size: "xs",
    });

    expect(result).toEqual(xsIdea);

    expect(enqueueJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "architecture",
        autoAccept: true,
        phaseConfig: expect.arrayContaining([
          expect.objectContaining({ phase: "Business Value", mode: "full-ai" }),
          expect.objectContaining({ phase: "User Benefits", mode: "full-ai" }),
          expect.objectContaining({ phase: "Must-Have Requirements", mode: "full-ai" }),
          expect.objectContaining({ phase: "Product Review", mode: "full-ai" }),
          expect.objectContaining({ phase: "Architecture Review", mode: "full-ai" }),
          expect.objectContaining({ phase: "DevOps Review", mode: "full-ai" }),
          expect.objectContaining({ phase: "Security Review", mode: "full-ai" }),
          expect.objectContaining({ phase: "Engineering Plan", mode: "full-ai" }),
        ]),
      }),
      undefined,
    );
  });

  it("creating an idea with size 's' also triggers auto-planning", async () => {
    const { enqueueJob } = await import("../jobs/index.js");

    const sIdea = { ...mockIdea, size: "s" };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // requireAccessibleRepo is mocked
    // MAX(order) query
    resultQueue.push([{ maxOrder: -1 }]);
    // insert().values().returning() — idea insert
    mockDb.returning.mockResolvedValueOnce([sIdea]);
    // resolveWorkerForSession: repo lookup (orgId)
    resultQueue.push([{ orgId: "mock-org" }]);
    // resolveWorkerForSession: org lookup (workerPolicy)
    resultQueue.push([{ workerPolicy: "user_default", centralWorkerId: null }]);
    // resolveWorkerForSession: user activeWorkerId lookup
    resultQueue.push([{ activeWorkerId: null }]);
    // resolveWorkerForSession: central worker online check
    resultQueue.push([{ id: "00000000-0000-0000-0000-000000000000" }]);
    // insert(sessions).values().returning() — session insert
    mockDb.returning.mockResolvedValueOnce([{
      id: SESSION_ID,
      repoId: REPO_ID,
      userId: USER_ID,
      type: "architecture",
      entityType: "idea",
      entityId: IDEA_ID,
      title: "Architecture: Add auth",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    }]);
    // select().from(ideaAttachments).where().orderBy() — attachments query
    mockDb.orderBy.mockResolvedValueOnce([]);

    const caller = createCaller(true);
    const result = await caller.idea.create({
      repoId: REPO_ID,
      title: "Add auth",
      description: "Implement authentication",
      size: "s",
    });

    expect(result).toEqual(sIdea);

    expect(enqueueJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "architecture",
        autoAccept: true,
        phaseConfig: expect.arrayContaining([
          expect.objectContaining({ phase: "Business Value", mode: "full-ai" }),
        ]),
      }),
      undefined,
    );
  });

  it("creating an idea with size 'm' does NOT trigger auto-planning", async () => {
    const { enqueueJob } = await import("../jobs/index.js");

    const mIdea = { ...mockIdea, size: "m" };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // requireAccessibleRepo is mocked
    // MAX(order) query
    resultQueue.push([{ maxOrder: -1 }]);
    // insert().values().returning() — idea insert
    mockDb.returning.mockResolvedValueOnce([mIdea]);

    const caller = createCaller(true);
    const result = await caller.idea.create({
      repoId: REPO_ID,
      title: "Add auth",
      description: "Implement authentication",
      size: "m",
    });

    expect(result).toEqual(mIdea);

    // enqueueJob should NOT have been called with architecture type
    const archCalls = (enqueueJob as any).mock.calls.filter(
      (c: any[]) => c[1]?.type === "architecture",
    );
    expect(archCalls).toHaveLength(0);
  });

  it("creating an idea with size null does NOT trigger auto-planning", async () => {
    const { enqueueJob } = await import("../jobs/index.js");

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // requireAccessibleRepo is mocked
    // MAX(order) query
    resultQueue.push([{ maxOrder: -1 }]);
    // insert().values().returning() — idea insert (mockIdea has size: null)
    mockDb.returning.mockResolvedValueOnce([mockIdea]);

    const caller = createCaller(true);
    const result = await caller.idea.create({
      repoId: REPO_ID,
      title: "Add auth",
      description: "Implement authentication",
    });

    expect(result).toEqual(mockIdea);

    // enqueueJob should NOT have been called with architecture type
    const archCalls = (enqueueJob as any).mock.calls.filter(
      (c: any[]) => c[1]?.type === "architecture",
    );
    expect(archCalls).toHaveLength(0);
  });

  it("if triggerArchitectureSession fails, idea creation still succeeds", async () => {
    const { enqueueJob } = await import("../jobs/index.js");
    // Make enqueueJob reject for this test
    (enqueueJob as any).mockRejectedValueOnce(new Error("queue unavailable"));

    const xsIdea = { ...mockIdea, size: "xs" };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // requireAccessibleRepo is mocked
    // MAX(order) query
    resultQueue.push([{ maxOrder: -1 }]);
    // insert().values().returning() — idea insert
    mockDb.returning.mockResolvedValueOnce([xsIdea]);
    // resolveWorkerForSession: repo lookup (orgId)
    resultQueue.push([{ orgId: "mock-org" }]);
    // resolveWorkerForSession: org lookup (workerPolicy)
    resultQueue.push([{ workerPolicy: "user_default", centralWorkerId: null }]);
    // resolveWorkerForSession: user activeWorkerId lookup
    resultQueue.push([{ activeWorkerId: null }]);
    // resolveWorkerForSession: central worker online check
    resultQueue.push([{ id: "00000000-0000-0000-0000-000000000000" }]);
    // insert(sessions).values().returning() — session insert
    mockDb.returning.mockResolvedValueOnce([{
      id: SESSION_ID,
      repoId: REPO_ID,
      userId: USER_ID,
      type: "architecture",
      entityType: "idea",
      entityId: IDEA_ID,
      title: "Architecture: Add auth",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    }]);
    // select().from(ideaAttachments).where().orderBy() — attachments query
    mockDb.orderBy.mockResolvedValueOnce([]);

    const caller = createCaller(true);
    const result = await caller.idea.create({
      repoId: REPO_ID,
      title: "Add auth",
      description: "Implement authentication",
      size: "xs",
    });

    // Idea creation still succeeds despite enqueueJob failure
    expect(result).toEqual(xsIdea);
  });

  // --- delete ---

  it("delete removes idea and publishes sync", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // fetch idea
    resultQueue.push([mockIdea]);
    // requireAccessibleRepo is mocked
    // delete().where().returning()
    mockDb.returning.mockResolvedValue([mockIdea]);

    const caller = createCaller(true);
    const result = await caller.idea.delete({ id: IDEA_ID });

    expect(result).toEqual({ success: true });
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:idea",
      expect.objectContaining({ action: "deleted" }),
    );
  });

  it("delete throws NOT_FOUND for missing idea", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // fetch idea — not found
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.idea.delete({ id: IDEA_ID }),
    ).rejects.toThrow("Idea not found");
  });

  // --- reorder ---

  it("reorder updates order values and publishes sync", async () => {
    const IDEA_ID_2 = "880e8400-e29b-41d4-a716-446655440003";

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // getUserOrgIds is mocked
    // orgRepos query (terminal where -> then)
    whereTerminalQueue.push([{ id: REPO_ID }]);
    // accessibleIdeas query: select().from(ideas).where(inArray) — terminal where
    whereTerminalQueue.push([{ id: IDEA_ID, repoId: REPO_ID }, { id: IDEA_ID_2, repoId: REPO_ID }]);
    // Promise.all update calls (each update().set().where() is terminal where)
    whereTerminalQueue.push(undefined);
    whereTerminalQueue.push(undefined);

    const caller = createCaller(true);
    const result = await caller.idea.reorder([
      { id: IDEA_ID, order: 1 },
      { id: IDEA_ID_2, order: 0 },
    ]);

    expect(result).toEqual({ success: true });
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:idea",
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("reorder requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.idea.reorder([{ id: IDEA_ID, order: 0 }]),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // --- startArchitectureSession ---

  it("startArchitectureSession creates session and enqueues job", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // idea lookup
    resultQueue.push([
      {
        id: IDEA_ID,
        repoId: REPO_ID,
        userId: USER_ID,
        status: "new",
        title: "Add auth",
        description: "Implement authentication",
      },
    ]);
    // requireAccessibleRepo is mocked
    // update().set().where() for idea status change — returns via set() chain
    // resolveWorkerForSession: repo lookup (orgId)
    resultQueue.push([{ orgId: "mock-org" }]);
    // resolveWorkerForSession: org lookup (workerPolicy)
    resultQueue.push([{ workerPolicy: "user_default", centralWorkerId: null }]);
    // resolveWorkerForSession: user activeWorkerId lookup
    resultQueue.push([{ activeWorkerId: null }]);
    // resolveWorkerForSession: central worker online check
    resultQueue.push([{ id: "00000000-0000-0000-0000-000000000000" }]);
    // insert().values().returning() for session creation
    mockDb.returning.mockResolvedValueOnce([
      {
        id: SESSION_ID,
        repoId: REPO_ID,
        userId: USER_ID,
        type: "architecture",
        entityType: "idea",
        entityId: IDEA_ID,
        title: "Architecture: Add auth",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    // select().from(ideaAttachments).where().orderBy() — attachments query
    mockDb.orderBy.mockResolvedValueOnce([]);

    const caller = createCaller(true);
    const result = await caller.idea.startArchitectureSession({
      ideaId: IDEA_ID,
    });

    expect(result.type).toBe("architecture");
    expect(result.status).toBe("active");
    expect(result.entityId).toBe(IDEA_ID);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:session",
      expect.objectContaining({ action: "created" }),
    );
  });

  it("startArchitectureSession rejects if idea is already planned", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // idea lookup — status is "planned"
    resultQueue.push([
      {
        id: IDEA_ID,
        repoId: REPO_ID,
        userId: USER_ID,
        status: "planned",
        title: "Already planned",
      },
    ]);
    // requireAccessibleRepo is mocked

    const caller = createCaller(true);
    await expect(
      caller.idea.startArchitectureSession({ ideaId: IDEA_ID }),
    ).rejects.toThrow(
      "Idea must be in 'new' or 'planning' status",
    );
  });

  it("startArchitectureSession rejects if idea not found", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // idea lookup — not found
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.idea.startArchitectureSession({ ideaId: IDEA_ID }),
    ).rejects.toThrow("Idea not found");
  });

  it("startArchitectureSession requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.idea.startArchitectureSession({ ideaId: IDEA_ID }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  it("startArchitectureSession includes attachments in job payload", async () => {
    const { enqueueJob } = await import("../jobs/index.js");

    const mockAttachment = {
      id: "aa0e8400-e29b-41d4-a716-446655440010",
      ideaId: IDEA_ID,
      userId: USER_ID,
      filename: "spec.pdf",
      mimeType: "application/pdf",
      sizeBytes: 5000,
      storageKey: "ideas/abc/spec.pdf",
      createdAt: new Date(),
    };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // idea lookup
    resultQueue.push([{
      id: IDEA_ID,
      repoId: REPO_ID,
      userId: USER_ID,
      status: "new",
      title: "Add auth",
      description: "Implement authentication",
    }]);
    // requireAccessibleRepo is mocked
    // resolveWorkerForSession: repo lookup (orgId)
    resultQueue.push([{ orgId: "mock-org" }]);
    // resolveWorkerForSession: org lookup (workerPolicy)
    resultQueue.push([{ workerPolicy: "user_default", centralWorkerId: null }]);
    // resolveWorkerForSession: user activeWorkerId lookup
    resultQueue.push([{ activeWorkerId: null }]);
    // resolveWorkerForSession: central worker online check
    resultQueue.push([{ id: "00000000-0000-0000-0000-000000000000" }]);
    // session insert returning
    mockDb.returning.mockResolvedValueOnce([{
      id: SESSION_ID,
      repoId: REPO_ID,
      userId: USER_ID,
      type: "architecture",
      entityType: "idea",
      entityId: IDEA_ID,
      title: "Architecture: Add auth",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    }]);
    // ideaAttachments query (terminal is orderBy)
    mockDb.orderBy.mockResolvedValueOnce([mockAttachment]);

    const caller = createCaller(true);
    await caller.idea.startArchitectureSession({ ideaId: IDEA_ID });

    expect(enqueueJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            id: mockAttachment.id,
            filename: "spec.pdf",
            storageKey: "ideas/abc/spec.pdf",
          }),
        ],
      }),
      undefined,
    );
  });

  it("startArchitectureSession omits attachments when none exist", async () => {
    const { enqueueJob } = await import("../jobs/index.js");

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // idea lookup
    resultQueue.push([{
      id: IDEA_ID,
      repoId: REPO_ID,
      userId: USER_ID,
      status: "new",
      title: "Add auth",
      description: "Implement authentication",
    }]);
    // requireAccessibleRepo is mocked
    // resolveWorkerForSession: repo lookup (orgId)
    resultQueue.push([{ orgId: "mock-org" }]);
    // resolveWorkerForSession: org lookup (workerPolicy)
    resultQueue.push([{ workerPolicy: "user_default", centralWorkerId: null }]);
    // resolveWorkerForSession: user activeWorkerId lookup
    resultQueue.push([{ activeWorkerId: null }]);
    // resolveWorkerForSession: central worker online check
    resultQueue.push([{ id: "00000000-0000-0000-0000-000000000000" }]);
    // session insert returning
    mockDb.returning.mockResolvedValueOnce([{
      id: SESSION_ID,
      repoId: REPO_ID,
      userId: USER_ID,
      type: "architecture",
      entityType: "idea",
      entityId: IDEA_ID,
      title: "Architecture: Add auth",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    }]);
    // ideaAttachments query — empty
    mockDb.orderBy.mockResolvedValueOnce([]);

    const caller = createCaller(true);
    await caller.idea.startArchitectureSession({ ideaId: IDEA_ID });

    const call = (enqueueJob as any).mock.calls.find(
      (c: any[]) => c[1]?.type === "architecture",
    );
    expect(call[1]).not.toHaveProperty("attachments");
  });

  // --- listAttachments ---

  it("listAttachments returns attachments for an idea", async () => {
    const mockAttachment = {
      id: "aa0e8400-e29b-41d4-a716-446655440010",
      ideaId: IDEA_ID,
      userId: USER_ID,
      filename: "design.png",
      mimeType: "image/png",
      sizeBytes: 12345,
      storageKey: "ideas/abc/design.png",
      createdAt: new Date(),
    };

    // lookupUserId
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // idea ownership check
    resultQueue.push([mockIdea]);
    // requireAccessibleRepo is mocked
    // attachments list (terminal is orderBy)
    mockDb.orderBy.mockResolvedValueOnce([mockAttachment]);

    const caller = createCaller(true);
    const result = await caller.idea.listAttachments({ ideaId: IDEA_ID });
    expect(result).toEqual([mockAttachment]);
  });

  it("listAttachments returns NOT_FOUND for missing idea", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // idea ownership check — not found
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.idea.listAttachments({ ideaId: IDEA_ID }),
    ).rejects.toThrow("Idea not found");
  });

  // --- deleteAttachment ---

  it("deleteAttachment removes attachment and publishes sync", async () => {
    const ATTACHMENT_ID = "aa0e8400-e29b-41d4-a716-446655440010";
    const mockAttachment = {
      id: ATTACHMENT_ID,
      ideaId: IDEA_ID,
      userId: USER_ID,
      filename: "design.png",
      mimeType: "image/png",
      sizeBytes: 12345,
      storageKey: "ideas/abc/design.png",
      createdAt: new Date(),
    };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // find attachment
    resultQueue.push([mockAttachment]);
    // idea ownership check
    resultQueue.push([mockIdea]); // mockIdea has status: "new"
    // requireAccessibleRepo is mocked
    // delete().where().returning()
    mockDb.returning.mockResolvedValueOnce([mockAttachment]);

    const caller = createCaller(true);
    const result = await caller.idea.deleteAttachment({ id: ATTACHMENT_ID });
    expect(result).toEqual({ success: true });
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:ideaAttachment",
      expect.objectContaining({ action: "deleted" }),
    );
  });

  it("deleteAttachment rejects when idea is not in new status", async () => {
    const ATTACHMENT_ID = "aa0e8400-e29b-41d4-a716-446655440010";
    const mockAttachment = {
      id: ATTACHMENT_ID,
      ideaId: IDEA_ID,
      userId: USER_ID,
      filename: "design.png",
      mimeType: "image/png",
      sizeBytes: 12345,
      storageKey: "ideas/abc/design.png",
      createdAt: new Date(),
    };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // find attachment
    resultQueue.push([mockAttachment]);
    // idea ownership check — status is 'planning'
    resultQueue.push([{ ...mockIdea, status: "planning" }]);
    // requireAccessibleRepo is mocked

    const caller = createCaller(true);
    await expect(
      caller.idea.deleteAttachment({ id: ATTACHMENT_ID }),
    ).rejects.toThrow("Attachments can only be deleted when the idea is in 'new' status");
  });

  it("deleteAttachment returns NOT_FOUND for missing attachment", async () => {
    const ATTACHMENT_ID = "aa0e8400-e29b-41d4-a716-446655440010";

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // find attachment — not found
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.idea.deleteAttachment({ id: ATTACHMENT_ID }),
    ).rejects.toThrow("Attachment not found");
  });
});
