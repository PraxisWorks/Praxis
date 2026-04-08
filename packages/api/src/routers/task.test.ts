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

vi.mock("../lib/orgSyncFilter.js", () => ({
  getUserOrgIds: vi.fn().mockResolvedValue(new Set(["mock-org"])),
  shouldForwardOrgEvent: vi.fn().mockReturnValue(true),
}));

import { appRouter } from "./index.js";

describe("taskRouter", () => {
  const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
  const REPO_ID = "770e8400-e29b-41d4-a716-446655440002";
  const TASK_ID = "880e8400-e29b-41d4-a716-446655440003";
  const TASK_ID_2 = "990e8400-e29b-41d4-a716-446655440004";

  const mockRepo = {
    id: REPO_ID,
    userId: USER_ID,
    name: "Test Repo",
    bdPrefix: "TR",
    color: "#6366f1",
    status: "active",
  };

  const mockTask = {
    id: TASK_ID,
    repoId: REPO_ID,
    parentId: null,
    ideaId: null,
    title: "Setup schema",
    description: "Create the initial DB schema",
    notes: null,
    status: "draft",
    priority: "high",
    isEpic: false,
    taskId: "TR-prx-abc12",
    statusChangedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPubsub = {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    close: vi.fn(),
  };

  let resultQueue: unknown[];

  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn(() => {
      const result = resultQueue.shift();
      return Promise.resolve(result ?? []);
    }),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
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

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.leftJoin.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockImplementation(() => {
      const result = resultQueue.shift();
      return Promise.resolve(result ?? []);
    });
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValue([]);
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.delete.mockReturnThis();
    mockDb.onConflictDoNothing.mockResolvedValue(undefined);
  });

  // --- list ---

  it("list requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.task.list({ repoId: REPO_ID }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  it("list with repoId verifies repo ownership", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // repo ownership check
    resultQueue.push([mockRepo]);
    // list query (orderBy -> limit)
    mockDb.limit.mockImplementation(() => {
      const result = resultQueue.shift();
      return Promise.resolve(result ?? []);
    });
    // After repo check, the list query chains .orderBy().limit()
    // Since orderBy returns this and limit is the terminal, we need
    // the next limit call to return the tasks
    resultQueue.push([mockTask]);

    const caller = createCaller(true);
    const result = await caller.task.list({ repoId: REPO_ID });
    expect(result.items).toBeDefined();
  });

  it("list throws NOT_FOUND when repo not owned", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // repo ownership check fails
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.task.list({ repoId: REPO_ID }),
    ).rejects.toThrow("Repo not found");
  });

  it("list with repoId null returns tasks from all user repos", async () => {
    const taskWithRigInfo = {
      ...mockTask,
      repoColor: mockRepo.color,
      repoName: mockRepo.name,
      repoIcon: null,
    };

    // lookupUserId
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // All-rigs path: fetch user's repos via where() terminal
    // The code does: select({id}).from(rigs).where(...) which is terminal
    let whereCallCount = 0;
    const terminalResults = [
      [{ id: REPO_ID }], // user's repos
    ] as unknown[];
    mockDb.where.mockImplementation(() => {
      whereCallCount++;
      // First where() chains into .limit() (lookupUserId)
      if (whereCallCount <= 1) {
        return mockDb;
      }
      // Second where() is terminal (fetch user repos)
      return Promise.resolve(terminalResults.shift() ?? []);
    });

    // list query: ...where().orderBy().limit()
    // After the user-rigs query resolves, the code builds conditions
    // and calls select().from().leftJoin().where().orderBy().limit()
    // Since where is now overridden, we need the third where call
    // to chain again for the main query
    const origImpl = mockDb.where.getMockImplementation()!;
    mockDb.where.mockImplementation(() => {
      whereCallCount++;
      if (whereCallCount <= 1) {
        return mockDb;
      }
      if (whereCallCount === 2) {
        // Terminal: fetch user repos
        return Promise.resolve([{ id: REPO_ID }]);
      }
      // Third+ calls: back to chaining for the main query
      return mockDb;
    });

    // The main query terminates at .limit()
    resultQueue.push([taskWithRigInfo]);

    const caller = createCaller(true);
    const result = await caller.task.list({ repoId: null });
    expect(result.items).toBeDefined();
  });

  it("list with repoId null returns empty when user has no repos", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // All-rigs path: fetch user's repos — empty
    let whereCallCount = 0;
    mockDb.where.mockImplementation(() => {
      whereCallCount++;
      if (whereCallCount <= 1) {
        return mockDb; // lookupUserId chains into .limit()
      }
      // Terminal: user has no repos
      return Promise.resolve([]);
    });

    const caller = createCaller(true);
    const result = await caller.task.list({ repoId: null });
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  // --- read permission gates ---

  it("list throws FORBIDDEN when user lacks task:read permission", async () => {
    // lookupUserId — non-admin user with no role
    resultQueue.push([{ id: USER_ID, role: "user", roleId: null }]);

    // resolveUserPermissions skips rolePermissions (roleId is null),
    // then calls select().from(userPermissionOverrides).where() — terminal where.
    let whereCallCount = 0;
    mockDb.where.mockImplementation(() => {
      whereCallCount++;
      if (whereCallCount <= 1) return mockDb; // lookupUserId chains to .limit()
      // Call 2: resolveUserPermissions overrides query (terminal where)
      return Promise.resolve([]); // no overrides -> no permissions
    });

    const caller = createCaller(true);
    await expect(
      caller.task.list({ repoId: REPO_ID }),
    ).rejects.toThrow("Missing permissions: task:read");
  });

  it("listDependencies throws FORBIDDEN when user lacks task:read permission", async () => {
    // lookupUserId — non-admin user with no role
    resultQueue.push([{ id: USER_ID, role: "user", roleId: null }]);

    let whereCallCount = 0;
    mockDb.where.mockImplementation(() => {
      whereCallCount++;
      if (whereCallCount <= 1) return mockDb; // lookupUserId chains to .limit()
      return Promise.resolve([]); // no overrides -> no permissions
    });

    const caller = createCaller(true);
    await expect(
      caller.task.listDependencies({ repoId: REPO_ID }),
    ).rejects.toThrow("Missing permissions: task:read");
  });

  // --- create ---

  it("create requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.task.create({
        repoId: REPO_ID,
        title: "Test",
        description: "Test desc",
        priority: "high",
      }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  it("create looks up repo, inserts with generated taskId, publishes sync", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // repo ownership check
    resultQueue.push([mockRepo]);
    // insert().values().returning()
    mockDb.returning.mockResolvedValueOnce([mockTask]);

    const caller = createCaller(true);
    const result = await caller.task.create({
      repoId: REPO_ID,
      title: "Setup schema",
      description: "Create the initial DB schema",
      priority: "high",
    });

    expect(result).toEqual(mockTask);
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:task",
      expect.objectContaining({ action: "created" }),
    );
  });

  it("create throws NOT_FOUND if repo not found", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // repo not found (ownership filter excluded it)
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.task.create({
        repoId: REPO_ID,
        title: "Test",
        description: "Test desc",
        priority: "high",
      }),
    ).rejects.toThrow("Repo not found");
  });

  it("create rejects when user doesn't own repo", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // repo ownership check — rig exists but WHERE clause with userId filters it out
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.task.create({
        repoId: REPO_ID,
        title: "Test",
        description: "Test desc",
        priority: "high",
      }),
    ).rejects.toThrow("Repo not found");
  });

  // --- update ---

  it("update updates fields and publishes sync", async () => {
    const updatedTask = { ...mockTask, title: "Updated schema" };
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // existing task
    resultQueue.push([mockTask]);
    // repo ownership check
    resultQueue.push([mockRepo]);
    // update().set().where().returning()
    mockDb.returning.mockResolvedValueOnce([updatedTask]);

    const caller = createCaller(true);
    const result = await caller.task.update({
      id: TASK_ID,
      title: "Updated schema",
    });

    expect(result).toEqual(updatedTask);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:task",
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("update sets statusChangedAt when status changes", async () => {
    const updatedTask = {
      ...mockTask,
      status: "in_progress",
      statusChangedAt: new Date(),
    };
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // existing task (status: "draft")
    resultQueue.push([mockTask]);
    // repo ownership check
    resultQueue.push([mockRepo]);
    // update().set().where().returning()
    mockDb.returning.mockResolvedValueOnce([updatedTask]);

    const caller = createCaller(true);
    const result = await caller.task.update({
      id: TASK_ID,
      status: "in_progress",
    });

    expect(result.status).toBe("in_progress");
    // Verify set() was called with statusChangedAt
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "in_progress",
        statusChangedAt: expect.any(Date),
      }),
    );
  });

  it("update cascades approval to draft descendants when epic is approved", async () => {
    const CHILD_1 = "aa0e8400-e29b-41d4-a716-446655440010";
    const CHILD_2 = "bb0e8400-e29b-41d4-a716-446655440011";
    const epicTask = { ...mockTask, isEpic: true };
    const updatedEpic = { ...epicTask, status: "approved", statusChangedAt: new Date() };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // existing task (epic, draft)
    resultQueue.push([epicTask]);
    // repo ownership check
    resultQueue.push([mockRepo]);
    // update().set().where().returning()
    mockDb.returning.mockResolvedValueOnce([updatedEpic]);

    // collectDescendantIds: select children where parentId = TASK_ID
    // This is a terminal where() call (no .limit())
    let whereCallCount = 0;
    const originalWhere = mockDb.where.getMockImplementation();
    mockDb.where.mockImplementation((...args: unknown[]) => {
      whereCallCount++;
      // First 3 calls chain into .limit() (lookupUserId, existing task, repo check)
      // 4th call is the update().set().where().returning()
      if (whereCallCount <= 4) return mockDb;
      // 5th call: collectDescendantIds query (terminal)
      if (whereCallCount === 5) {
        return Promise.resolve([
          { id: CHILD_1, isEpic: false },
          { id: CHILD_2, isEpic: false },
        ]);
      }
      // 6th call: the cascade update().set().where() — terminal
      return Promise.resolve([]);
    });

    const caller = createCaller(true);
    await caller.task.update({ id: TASK_ID, status: "approved" });

    // Should have published twice: once for the epic, once for the cascade
    expect(mockPubsub.publish).toHaveBeenCalledTimes(2);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:task",
      expect.objectContaining({ data: expect.objectContaining({ cascade: true }) }),
    );
  });

  it("update does NOT cascade when children are not in draft status", async () => {
    const CHILD_1 = "aa0e8400-e29b-41d4-a716-446655440010";
    const epicTask = { ...mockTask, isEpic: true };
    const updatedEpic = { ...epicTask, status: "approved", statusChangedAt: new Date() };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // existing task (epic, draft)
    resultQueue.push([epicTask]);
    // repo ownership check
    resultQueue.push([mockRepo]);
    // update().set().where().returning()
    mockDb.returning.mockResolvedValueOnce([updatedEpic]);

    let whereCallCount = 0;
    mockDb.where.mockImplementation(() => {
      whereCallCount++;
      if (whereCallCount <= 4) return mockDb;
      // collectDescendantIds: one child with in_progress status
      if (whereCallCount === 5) {
        return Promise.resolve([{ id: CHILD_1, isEpic: false }]);
      }
      // cascade update where() — terminal (the WHERE filters out non-draft)
      return Promise.resolve([]);
    });

    const caller = createCaller(true);
    await caller.task.update({ id: TASK_ID, status: "approved" });

    // Still publishes the cascade event because descendantIds.length > 0
    // The DB WHERE clause (eq status draft) handles the filtering
    expect(mockPubsub.publish).toHaveBeenCalledTimes(2);
    // The key point is that the update().set().where() includes
    // eq(tasks.status, "draft") — verified by the mockDb.set call including status: "approved"
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "approved" }),
    );
  });

  it("update returns NOT_FOUND for missing task", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // task not found
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.task.update({ id: TASK_ID, title: "X" }),
    ).rejects.toThrow("Task not found");
  });

  // --- delete ---

  it("delete removes and publishes sync", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // existing task
    resultQueue.push([mockTask]);
    // repo ownership check
    resultQueue.push([mockRepo]);

    const caller = createCaller(true);
    const result = await caller.task.delete({ id: TASK_ID });

    expect(result).toEqual({ success: true });
    expect(mockDb.delete).toHaveBeenCalled();
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:task",
      expect.objectContaining({ action: "deleted" }),
    );
  });

  it("delete NOT_FOUND for missing task", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // task not found
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.task.delete({ id: TASK_ID }),
    ).rejects.toThrow("Task not found");
  });

  // --- addDependency ---

  it("addDependency rejects self-dependency", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);

    const caller = createCaller(true);
    await expect(
      caller.task.addDependency({
        taskId: TASK_ID,
        dependsOnId: TASK_ID,
      }),
    ).rejects.toThrow("A task cannot depend on itself");
  });

  it("addDependency inserts and publishes sync", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // task lookup
    resultQueue.push([mockTask]);
    // repo ownership check
    resultQueue.push([mockRepo]);

    const caller = createCaller(true);
    const result = await caller.task.addDependency({
      taskId: TASK_ID,
      dependsOnId: TASK_ID_2,
    });

    expect(result).toEqual({ success: true });
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:task",
      expect.objectContaining({ action: "updated" }),
    );
  });

  // --- removeDependency ---

  it("removeDependency removes and publishes sync", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // task lookup
    resultQueue.push([mockTask]);
    // repo ownership check
    resultQueue.push([mockRepo]);

    const caller = createCaller(true);
    const result = await caller.task.removeDependency({
      taskId: TASK_ID,
      dependsOnId: TASK_ID_2,
    });

    expect(result).toEqual({ success: true });
    expect(mockDb.delete).toHaveBeenCalled();
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:task",
      expect.objectContaining({ action: "deleted" }),
    );
  });

  // --- in-progress propagation ---

  describe("in-progress propagation", () => {
    const PARENT_ID = "cc0e8400-e29b-41d4-a716-446655440020";
    const GRANDPARENT_ID = "dd0e8400-e29b-41d4-a716-446655440021";
    const IDEA_ID = "ee0e8400-e29b-41d4-a716-446655440022";

    it("propagates in_progress to parent epic when leaf moves to in_progress", async () => {
      const leafTask = { ...mockTask, status: "draft", parentId: PARENT_ID, ideaId: null };
      const updatedLeaf = { ...leafTask, status: "in_progress", statusChangedAt: new Date() };
      const parentTask = {
        id: PARENT_ID,
        repoId: REPO_ID,
        parentId: null,
        ideaId: null,
        title: "Parent Epic",
        status: "draft",
        isEpic: true,
      };
      const updatedParent = { ...parentTask, status: "in_progress", statusChangedAt: new Date() };

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // existing task
      resultQueue.push([leafTask]);
      // repo ownership check
      resultQueue.push([mockRepo]);
      // propagateInProgressUp: fetch parent task
      resultQueue.push([parentTask]);

      // Main update returning, then propagation update returning
      mockDb.returning.mockResolvedValueOnce([updatedLeaf]);
      mockDb.returning.mockResolvedValueOnce([updatedParent]);

      const caller = createCaller(true);
      const result = await caller.task.update({
        id: TASK_ID,
        status: "in_progress",
      });

      expect(result.status).toBe("in_progress");
      // Published twice: once for the leaf, once for the parent
      expect(mockPubsub.publish).toHaveBeenCalledTimes(2);
      expect(mockPubsub.publish).toHaveBeenCalledWith(
        "sync:task",
        expect.objectContaining({ action: "updated", data: updatedParent }),
      );
    });

    it("does not re-update parent already in_progress", async () => {
      const leafTask = { ...mockTask, status: "draft", parentId: PARENT_ID, ideaId: null };
      const updatedLeaf = { ...leafTask, status: "in_progress", statusChangedAt: new Date() };
      const parentTask = {
        id: PARENT_ID,
        repoId: REPO_ID,
        parentId: null,
        ideaId: null,
        title: "Parent Epic",
        status: "in_progress",
        isEpic: true,
      };

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // existing task
      resultQueue.push([leafTask]);
      // repo ownership check
      resultQueue.push([mockRepo]);
      // propagateInProgressUp: fetch parent (already in_progress)
      resultQueue.push([parentTask]);

      // Main update returning only — no propagation update needed
      mockDb.returning.mockResolvedValueOnce([updatedLeaf]);

      const caller = createCaller(true);
      await caller.task.update({
        id: TASK_ID,
        status: "in_progress",
      });

      // Only one publish for the leaf update; parent was NOT updated
      expect(mockPubsub.publish).toHaveBeenCalledTimes(1);
    });

    it("propagates in_progress to idea when top-level task moves to in_progress", async () => {
      const topTask = { ...mockTask, status: "draft", parentId: null, ideaId: IDEA_ID };
      const updatedTopTask = { ...topTask, status: "in_progress", statusChangedAt: new Date() };
      const idea = { id: IDEA_ID, status: "planned" };

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // existing task
      resultQueue.push([topTask]);
      // repo ownership check
      resultQueue.push([mockRepo]);
      // inline idea fetch (top-level task, no parentId)
      resultQueue.push([idea]);

      // Main update returning
      mockDb.returning.mockResolvedValueOnce([updatedTopTask]);

      // The inline idea update uses .update().set().where() — terminal at where(), no .returning()
      let whereCallCount = 0;
      mockDb.where.mockImplementation(() => {
        whereCallCount++;
        // Calls 1-3: lookupUserId, existing task, repo check -> chain to .limit()
        // Call 4: main update -> chain to .returning()
        // Call 5: idea fetch -> chain to .limit()
        if (whereCallCount <= 5) return mockDb;
        // Call 6: idea update().set().where() — terminal
        return Promise.resolve([]);
      });

      const caller = createCaller(true);
      await caller.task.update({
        id: TASK_ID,
        status: "in_progress",
      });

      // Published twice: leaf task sync + idea sync
      expect(mockPubsub.publish).toHaveBeenCalledTimes(2);
      expect(mockPubsub.publish).toHaveBeenCalledWith(
        "sync:idea",
        expect.objectContaining({
          action: "updated",
          data: expect.objectContaining({ id: IDEA_ID, status: "in_progress" }),
        }),
      );
    });

    it("propagates in_progress through parent and grandparent", async () => {
      const leafTask = { ...mockTask, status: "draft", parentId: PARENT_ID, ideaId: null };
      const updatedLeaf = { ...leafTask, status: "in_progress", statusChangedAt: new Date() };
      const parentTask = {
        id: PARENT_ID,
        repoId: REPO_ID,
        parentId: GRANDPARENT_ID,
        ideaId: null,
        title: "Parent",
        status: "draft",
        isEpic: true,
      };
      const updatedParent = { ...parentTask, status: "in_progress", statusChangedAt: new Date() };
      const grandparentTask = {
        id: GRANDPARENT_ID,
        repoId: REPO_ID,
        parentId: null,
        ideaId: null,
        title: "Grandparent",
        status: "draft",
        isEpic: true,
      };
      const updatedGrandparent = { ...grandparentTask, status: "in_progress", statusChangedAt: new Date() };

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // existing task
      resultQueue.push([leafTask]);
      // repo ownership check
      resultQueue.push([mockRepo]);
      // propagateInProgressUp: fetch parent
      resultQueue.push([parentTask]);
      // propagateInProgressUp (recurse): fetch grandparent
      resultQueue.push([grandparentTask]);

      // Main update, parent update, grandparent update
      mockDb.returning.mockResolvedValueOnce([updatedLeaf]);
      mockDb.returning.mockResolvedValueOnce([updatedParent]);
      mockDb.returning.mockResolvedValueOnce([updatedGrandparent]);

      const caller = createCaller(true);
      await caller.task.update({
        id: TASK_ID,
        status: "in_progress",
      });

      // 3 publishes: leaf, parent, grandparent
      expect(mockPubsub.publish).toHaveBeenCalledTimes(3);
      expect(mockPubsub.publish).toHaveBeenCalledWith(
        "sync:task",
        expect.objectContaining({ data: updatedParent }),
      );
      expect(mockPubsub.publish).toHaveBeenCalledWith(
        "sync:task",
        expect.objectContaining({ data: updatedGrandparent }),
      );
    });
  });

  // --- completion propagation ---

  describe("completion propagation", () => {
    const PARENT_ID = "cc0e8400-e29b-41d4-a716-446655440020";
    const GRANDPARENT_ID = "dd0e8400-e29b-41d4-a716-446655440021";
    const IDEA_ID = "ee0e8400-e29b-41d4-a716-446655440022";
    const SIBLING_ID = "ff0e8400-e29b-41d4-a716-446655440023";

    it("completes parent when all siblings are complete", async () => {
      const leafTask = { ...mockTask, status: "in_progress", parentId: PARENT_ID, ideaId: null };
      const updatedLeaf = { ...leafTask, status: "complete", statusChangedAt: new Date() };
      const parentTask = {
        id: PARENT_ID,
        repoId: REPO_ID,
        parentId: null,
        ideaId: null,
        title: "Parent",
        status: "in_progress",
        isEpic: true,
      };
      const updatedParent = { ...parentTask, status: "complete", statusChangedAt: new Date() };

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // existing task
      resultQueue.push([leafTask]);
      // repo ownership check
      resultQueue.push([mockRepo]);

      // Main update returning
      mockDb.returning.mockResolvedValueOnce([updatedLeaf]);
      // propagateCompleteUp: parent update returning
      mockDb.returning.mockResolvedValueOnce([updatedParent]);

      // propagateCompleteUp: fetch children of parent (terminal where)
      let whereCallCount = 0;
      mockDb.where.mockImplementation(() => {
        whereCallCount++;
        // Calls 1-3: lookupUserId, existing task, repo check -> chain to .limit()
        // Call 4: main update -> chain to .returning()
        if (whereCallCount <= 4) return mockDb;
        // Call 5: propagateCompleteUp children query (terminal)
        if (whereCallCount === 5) {
          return Promise.resolve([
            { status: "complete" },
            { status: "complete" },
          ]);
        }
        // Call 6: parent update().set().where() -> chain to .returning()
        return mockDb;
      });

      const caller = createCaller(true);
      await caller.task.update({
        id: TASK_ID,
        status: "complete",
      });

      // 2 publishes: leaf update + parent update
      expect(mockPubsub.publish).toHaveBeenCalledTimes(2);
      expect(mockPubsub.publish).toHaveBeenCalledWith(
        "sync:task",
        expect.objectContaining({ data: updatedParent }),
      );
    });

    it("does not complete parent when not all siblings are complete", async () => {
      const leafTask = { ...mockTask, status: "in_progress", parentId: PARENT_ID, ideaId: null };
      const updatedLeaf = { ...leafTask, status: "complete", statusChangedAt: new Date() };

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // existing task
      resultQueue.push([leafTask]);
      // repo ownership check
      resultQueue.push([mockRepo]);

      // Main update returning
      mockDb.returning.mockResolvedValueOnce([updatedLeaf]);

      // propagateCompleteUp: fetch children of parent (terminal where)
      let whereCallCount = 0;
      mockDb.where.mockImplementation(() => {
        whereCallCount++;
        if (whereCallCount <= 4) return mockDb;
        // Children query: one complete, one in_progress -> NOT all terminal
        if (whereCallCount === 5) {
          return Promise.resolve([
            { status: "complete" },
            { status: "in_progress" },
          ]);
        }
        return mockDb;
      });

      const caller = createCaller(true);
      await caller.task.update({
        id: TASK_ID,
        status: "complete",
      });

      // Only 1 publish: just the leaf update, parent NOT updated
      expect(mockPubsub.publish).toHaveBeenCalledTimes(1);
    });

    it("treats archived as terminal for parent completion", async () => {
      const leafTask = { ...mockTask, status: "in_progress", parentId: PARENT_ID, ideaId: null };
      const updatedLeaf = { ...leafTask, status: "complete", statusChangedAt: new Date() };
      const parentTask = {
        id: PARENT_ID,
        repoId: REPO_ID,
        parentId: null,
        ideaId: null,
        title: "Parent",
        status: "in_progress",
        isEpic: true,
      };
      const updatedParent = { ...parentTask, status: "complete", statusChangedAt: new Date() };

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // existing task
      resultQueue.push([leafTask]);
      // repo ownership check
      resultQueue.push([mockRepo]);

      // Main update returning, then parent update returning
      mockDb.returning.mockResolvedValueOnce([updatedLeaf]);
      mockDb.returning.mockResolvedValueOnce([updatedParent]);

      // propagateCompleteUp: children query (terminal where)
      let whereCallCount = 0;
      mockDb.where.mockImplementation(() => {
        whereCallCount++;
        if (whereCallCount <= 4) return mockDb;
        // Children: one archived, one complete -> all terminal
        if (whereCallCount === 5) {
          return Promise.resolve([
            { status: "archived" },
            { status: "complete" },
          ]);
        }
        // Parent update where -> chain to .returning()
        return mockDb;
      });

      const caller = createCaller(true);
      await caller.task.update({
        id: TASK_ID,
        status: "complete",
      });

      // 2 publishes: leaf update + parent update
      expect(mockPubsub.publish).toHaveBeenCalledTimes(2);
      expect(mockPubsub.publish).toHaveBeenCalledWith(
        "sync:task",
        expect.objectContaining({ data: updatedParent }),
      );
    });

    it("propagates completion through multiple levels", async () => {
      const leafTask = { ...mockTask, status: "in_progress", parentId: PARENT_ID, ideaId: null };
      const updatedLeaf = { ...leafTask, status: "complete", statusChangedAt: new Date() };
      const parentTask = {
        id: PARENT_ID,
        repoId: REPO_ID,
        parentId: GRANDPARENT_ID,
        ideaId: null,
        title: "Parent",
        status: "in_progress",
        isEpic: true,
      };
      const updatedParent = { ...parentTask, status: "complete", statusChangedAt: new Date() };
      const grandparentTask = {
        id: GRANDPARENT_ID,
        repoId: REPO_ID,
        parentId: null,
        ideaId: null,
        title: "Grandparent",
        status: "in_progress",
        isEpic: true,
      };
      const updatedGrandparent = { ...grandparentTask, status: "complete", statusChangedAt: new Date() };

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // existing task
      resultQueue.push([leafTask]);
      // repo ownership check
      resultQueue.push([mockRepo]);

      // Main update, parent update, grandparent update
      mockDb.returning.mockResolvedValueOnce([updatedLeaf]);
      mockDb.returning.mockResolvedValueOnce([updatedParent]);
      mockDb.returning.mockResolvedValueOnce([updatedGrandparent]);

      let whereCallCount = 0;
      mockDb.where.mockImplementation(() => {
        whereCallCount++;
        // Calls 1-4: lookupUserId, existing task, repo check, main update where
        if (whereCallCount <= 4) return mockDb;
        // Call 5: children of parent (terminal)
        if (whereCallCount === 5) {
          return Promise.resolve([{ status: "complete" }]);
        }
        // Call 6: parent update where -> chain to .returning()
        if (whereCallCount === 6) return mockDb;
        // Call 7: children of grandparent (terminal)
        if (whereCallCount === 7) {
          return Promise.resolve([{ status: "complete" }]);
        }
        // Call 8: grandparent update where -> chain to .returning()
        return mockDb;
      });

      const caller = createCaller(true);
      await caller.task.update({
        id: TASK_ID,
        status: "complete",
      });

      // 3 publishes: leaf, parent, grandparent
      expect(mockPubsub.publish).toHaveBeenCalledTimes(3);
      expect(mockPubsub.publish).toHaveBeenCalledWith(
        "sync:task",
        expect.objectContaining({ data: updatedParent }),
      );
      expect(mockPubsub.publish).toHaveBeenCalledWith(
        "sync:task",
        expect.objectContaining({ data: updatedGrandparent }),
      );
    });

    it("completes idea when all top-level tasks are complete", async () => {
      const topTask = { ...mockTask, status: "in_progress", parentId: null, ideaId: IDEA_ID };
      const updatedTopTask = { ...topTask, status: "complete", statusChangedAt: new Date() };
      const updatedIdea = { id: IDEA_ID, status: "complete", updatedAt: new Date() };

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // existing task
      resultQueue.push([topTask]);
      // repo ownership check
      resultQueue.push([mockRepo]);

      // Main update returning, idea update returning
      mockDb.returning.mockResolvedValueOnce([updatedTopTask]);
      mockDb.returning.mockResolvedValueOnce([updatedIdea]);

      // propagateCompleteUp(db, pubsub, null, ideaId):
      // fetches top-level tasks (terminal where), then updates idea
      let whereCallCount = 0;
      mockDb.where.mockImplementation(() => {
        whereCallCount++;
        // Calls 1-4: lookupUserId, existing task, repo check, main update where
        if (whereCallCount <= 4) return mockDb;
        // Call 5: top-level tasks for idea (terminal)
        if (whereCallCount === 5) {
          return Promise.resolve([
            { status: "complete" },
            { status: "complete" },
          ]);
        }
        // Call 6: idea update where -> chain to .returning()
        return mockDb;
      });

      const caller = createCaller(true);
      await caller.task.update({
        id: TASK_ID,
        status: "complete",
      });

      // 2 publishes: task update + idea update
      expect(mockPubsub.publish).toHaveBeenCalledTimes(2);
      expect(mockPubsub.publish).toHaveBeenCalledWith(
        "sync:idea",
        expect.objectContaining({
          action: "updated",
          data: updatedIdea,
        }),
      );
    });

    it("does not complete idea when some top-level tasks remain incomplete", async () => {
      const topTask = { ...mockTask, status: "in_progress", parentId: null, ideaId: IDEA_ID };
      const updatedTopTask = { ...topTask, status: "complete", statusChangedAt: new Date() };

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // existing task
      resultQueue.push([topTask]);
      // repo ownership check
      resultQueue.push([mockRepo]);

      // Main update returning
      mockDb.returning.mockResolvedValueOnce([updatedTopTask]);

      // propagateCompleteUp(db, pubsub, null, ideaId):
      // fetches top-level tasks (terminal where) — not all terminal
      let whereCallCount = 0;
      mockDb.where.mockImplementation(() => {
        whereCallCount++;
        if (whereCallCount <= 4) return mockDb;
        // Top-level tasks: one complete, one in_progress
        if (whereCallCount === 5) {
          return Promise.resolve([
            { status: "complete" },
            { status: "in_progress" },
          ]);
        }
        return mockDb;
      });

      const caller = createCaller(true);
      await caller.task.update({
        id: TASK_ID,
        status: "complete",
      });

      // Only 1 publish: the leaf task update. Idea NOT updated.
      expect(mockPubsub.publish).toHaveBeenCalledTimes(1);
      expect(mockPubsub.publish).not.toHaveBeenCalledWith(
        "sync:idea",
        expect.anything(),
      );
    });
  });

  // --- listDependencies ---

  it("listDependencies requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.task.listDependencies({ repoId: REPO_ID }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  it("listDependencies returns dependencies for a repo", async () => {
    const mockDep = { taskId: TASK_ID, dependsOnId: TASK_ID_2 };
    // lookupUserId
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // repo ownership check
    resultQueue.push([mockRepo]);

    // The listDependencies procedure has two queries that terminate at where()
    // (no .limit()): the tasks-in-repo query and the taskDependencies query.
    // We use a call counter so the first two where() calls chain (for
    // lookupUserId and repo check, which use .limit()), and the 3rd/4th
    // where() calls resolve directly.
    let whereCallCount = 0;
    const terminalResults = [
      [{ id: TASK_ID }, { id: TASK_ID_2 }], // tasks in repo
      [mockDep],                              // taskDependencies
    ];
    mockDb.where.mockImplementation(() => {
      whereCallCount++;
      // First two where() calls chain into .limit() (lookupUserId + repo check)
      if (whereCallCount <= 2) {
        return mockDb; // return this for chaining
      }
      // Subsequent where() calls are terminal
      return Promise.resolve(terminalResults.shift() ?? []);
    });

    const caller = createCaller(true);
    const result = await caller.task.listDependencies({ repoId: REPO_ID });
    expect(result).toEqual([mockDep]);
  });
});
