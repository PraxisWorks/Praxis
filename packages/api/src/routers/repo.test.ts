import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// Same mocks as user.test.ts and notification.test.ts
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

vi.mock("../lib/resolveWorkerForSession.js", () => ({
  resolveWorkerForSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/orgSyncFilter.js", () => ({
  getUserOrgIds: vi.fn().mockResolvedValue(new Set(["mock-org"])),
  shouldForwardOrgEvent: vi.fn().mockReturnValue(true),
}));

import { appRouter } from "./index.js";

describe("repoRouter", () => {
  const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
  const REPO_ID = "770e8400-e29b-41d4-a716-446655440002";
  const SESSION_ID = "880e8400-e29b-41d4-a716-446655440003";

  const ORG_ID = "990e8400-e29b-41d4-a716-446655440004";

  const mockRepo = {
    id: REPO_ID,
    orgId: ORG_ID,
    userId: USER_ID,
    name: "My Project",
    repo: "https://github.com/user/repo",
    bdPrefix: "MP",
    color: "#6366f1",
    description: "A test project",
    workspacePath: null,
    status: "active",
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
    where: vi.fn(function (this: any) { return this; }),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn(() => {
      const result = resultQueue.shift();
      return Promise.resolve(result ?? []);
    }),
    // Make mockDb thenable so `await db.select().from().where()` works
    // when where() is the terminal call (e.g. active sessions query).
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
    mockDb.where.mockImplementation(function (this: any) { return this; });
    mockDb.orderBy.mockResolvedValue([mockRepo]);
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
    mockDb.returning.mockResolvedValue([mockRepo]);
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.delete.mockReturnThis();
  });

  // ---- list ----

  it("list returns repos for the current user", async () => {
    // lookupUserId (requirePermission → protectedProcedure middleware)
    // role: "admin" bypasses permission resolution queries
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // The list query chains where().orderBy() -- orderBy is terminal here
    // (since we mocked orderBy to resolve)

    const caller = createCaller(true);
    const result = await caller.repo.list();
    expect(result).toEqual([mockRepo]);
  });

  it("list requires auth", async () => {
    const caller = createCaller(false);
    await expect(caller.repo.list()).rejects.toThrow("UNAUTHORIZED");
  });

  it("list throws FORBIDDEN when user lacks repo:read permission", async () => {
    // lookupUserId — non-admin user
    resultQueue.push([{ id: USER_ID, role: "user", roleId: null }]);
    // resolveUserPermissions: terminal where → pulled from whereTerminalQueue
    whereTerminalQueue.push([]); // no overrides → no permissions → FORBIDDEN

    const caller = createCaller(true);
    await expect(caller.repo.list()).rejects.toThrow("Missing permissions: repo:read");
  });

  // ---- getById ----

  it("getById returns a repo owned by the user", async () => {
    // lookupUserId — role: "admin" bypasses permission resolution
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // fetch repo by id (with ownership WHERE clause)
    resultQueue.push([mockRepo]);

    const caller = createCaller(true);
    const result = await caller.repo.getById({ id: REPO_ID });
    expect(result).toEqual(mockRepo);
  });

  it("getById throws NOT_FOUND for missing repo", async () => {
    // lookupUserId — role: "admin" bypasses permission resolution
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // repo not found (ownership filter excluded it)
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(caller.repo.getById({ id: REPO_ID })).rejects.toThrow(
      "Repo not found",
    );
  });

  it("getById requires auth", async () => {
    const caller = createCaller(false);
    await expect(caller.repo.getById({ id: REPO_ID })).rejects.toThrow(
      "UNAUTHORIZED",
    );
  });

  it("getById throws FORBIDDEN when user lacks repo:read permission", async () => {
    // lookupUserId — non-admin user
    resultQueue.push([{ id: USER_ID, role: "user", roleId: null }]);
    // resolveUserPermissions: terminal where → pulled from whereTerminalQueue
    whereTerminalQueue.push([]); // no overrides → no permissions → FORBIDDEN

    const caller = createCaller(true);
    await expect(caller.repo.getById({ id: REPO_ID })).rejects.toThrow(
      "Missing permissions: repo:read",
    );
  });

  // ---- create ----

  it("create inserts repo and publishes sync", async () => {
    // lookupUserId — admin bypasses permission resolution
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);

    const caller = createCaller(true);
    const result = await caller.repo.create({
      orgId: ORG_ID,
      name: "My Project",
      repo: "https://github.com/user/repo",
      bdPrefix: "MP",
      color: "#6366f1",
      description: "A test project",
    });

    expect(result).toEqual(mockRepo);
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:repo",
      expect.objectContaining({ action: "created" }),
    );
  });

  it("create requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.repo.create({
        orgId: ORG_ID,
        name: "My Project",
        bdPrefix: "MP",
        color: "#6366f1",
      }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  it("create rejects when user has no DB record", async () => {
    const caller = appRouter.createCaller({
      user: { sub: "unknown-sub" },
      db: mockDb as any,
      pubsub: mockPubsub as any,
    });
    await expect(
      caller.repo.create({
        orgId: ORG_ID,
        name: "My Project",
        bdPrefix: "MP",
        color: "#6366f1",
      }),
    ).rejects.toThrow("User not found");
  });

  it("create routes repo.create job to the resolved worker so RLS picks the right consumer", async () => {
    const { enqueueJob } = await import("../jobs/index.js");
    const { resolveWorkerForSession } = await import("../lib/resolveWorkerForSession.js");
    const TARGET_WORKER_ID = "1812683e-3a2e-4e34-a937-00c5c43515d5";
    vi.mocked(resolveWorkerForSession).mockResolvedValueOnce(TARGET_WORKER_ID);

    // lookupUserId — admin bypasses permission resolution
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);

    const caller = createCaller(true);
    await caller.repo.create({
      orgId: ORG_ID,
      name: "My Project",
      bdPrefix: "MP",
      color: "#6366f1",
    });

    expect(resolveWorkerForSession).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      REPO_ID,
    );
    expect(enqueueJob).toHaveBeenCalledWith(
      "repo.create",
      { repoId: REPO_ID },
      expect.objectContaining({ retryLimit: 0, workerId: TARGET_WORKER_ID }),
    );
  });

  it("create falls back to the unscoped queue when no worker is resolved", async () => {
    const { enqueueJob } = await import("../jobs/index.js");
    const { resolveWorkerForSession } = await import("../lib/resolveWorkerForSession.js");
    vi.mocked(resolveWorkerForSession).mockResolvedValueOnce(undefined);

    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);

    const caller = createCaller(true);
    await caller.repo.create({
      orgId: ORG_ID,
      name: "My Project",
      bdPrefix: "MP",
      color: "#6366f1",
    });

    const repoCreateCall = vi.mocked(enqueueJob).mock.calls.find(
      (c) => c[0] === "repo.create",
    );
    expect(repoCreateCall).toBeDefined();
    expect(repoCreateCall![2]).not.toHaveProperty("workerId");
    expect(repoCreateCall![2]).toEqual({ retryLimit: 0 });
  });

  // ---- update ----

  it("update modifies repo and publishes sync", async () => {
    const updatedRepo = { ...mockRepo, name: "Updated Name" };
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // requireAccessibleRepo: fetch repo by id
    resultQueue.push([mockRepo]);
    // requireOrgMember is mocked
    // update().set().where().returning()
    mockDb.returning.mockResolvedValue([updatedRepo]);

    const caller = createCaller(true);
    const result = await caller.repo.update({
      id: REPO_ID,
      data: { name: "Updated Name" },
    });

    expect(result).toEqual(updatedRepo);
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:repo",
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("update throws NOT_FOUND when repo not found or not owned", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // requireAccessibleRepo: repo not found
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.repo.update({ id: REPO_ID, data: { name: "New Name" } }),
    ).rejects.toThrow("Repo not found");
  });

  it("update requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.repo.update({ id: REPO_ID, data: { name: "New Name" } }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // ---- delete ----

  it("delete removes repo and publishes sync", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // select repo for sync event payload (with ownership WHERE)
    resultQueue.push([mockRepo]);
    // select active working sessions (where-terminal, no active sessions)
    whereTerminalQueue.push([]);

    const caller = createCaller(true);
    const result = await caller.repo.delete({ id: REPO_ID });

    expect(result).toEqual({ success: true });
    expect(mockDb.delete).toHaveBeenCalled();
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:repo",
      expect.objectContaining({ action: "deleted" }),
    );
  });

  it("delete throws NOT_FOUND for missing repo", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // select repo returns empty (not found or not owned)
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(caller.repo.delete({ id: REPO_ID })).rejects.toThrow(
      "Repo not found",
    );
  });

  it("delete requires auth", async () => {
    const caller = createCaller(false);
    await expect(caller.repo.delete({ id: REPO_ID })).rejects.toThrow(
      "UNAUTHORIZED",
    );
  });

  it("delete enqueues session.stop for active working sessions before deleting", async () => {
    const { enqueueJob } = await import("../jobs/index.js");
    const mockWorkingSession = {
      id: SESSION_ID,
      repoId: REPO_ID,
      status: "active",
      type: "working",
      workerId: null,
    };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // select repo for sync event payload
    resultQueue.push([mockRepo]);
    // select active working sessions (where-terminal)
    whereTerminalQueue.push([mockWorkingSession]);

    const caller = createCaller(true);
    await caller.repo.delete({ id: REPO_ID });

    expect(enqueueJob).toHaveBeenCalledWith(
      "session.stop",
      { sessionId: SESSION_ID },
      undefined,
    );
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it("delete publishes sync:repo deleted event", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // select repo
    resultQueue.push([mockRepo]);
    // no active sessions
    whereTerminalQueue.push([]);

    const caller = createCaller(true);
    await caller.repo.delete({ id: REPO_ID });

    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:repo",
      expect.objectContaining({
        action: "deleted",
        data: expect.objectContaining({ id: REPO_ID }),
      }),
    );
  });

  // ---- move ----

  const TARGET_ORG_ID = "aa0e8400-e29b-41d4-a716-446655440005";

  it("move succeeds — updates org, publishes two sync events, logs info", async () => {
    const updatedRepo = { ...mockRepo, orgId: TARGET_ORG_ID };
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // requireAccessibleRepo: fetch repo by id
    resultQueue.push([mockRepo]);
    // bdPrefix uniqueness check (.limit(1)) — no conflict
    resultQueue.push([]);
    // active sessions check (where-terminal, no .limit()) — none active
    whereTerminalQueue.push([]);
    // update().set().where().returning()
    mockDb.returning.mockResolvedValueOnce([updatedRepo]);

    const caller = createCaller(true);
    const result = await caller.repo.move({ repoId: REPO_ID, targetOrgId: TARGET_ORG_ID });

    expect(result).toEqual(updatedRepo);
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockPubsub.publish).toHaveBeenCalledTimes(2);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:repo",
      expect.objectContaining({ action: "deleted", data: expect.objectContaining({ orgId: ORG_ID }) }),
    );
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:repo",
      expect.objectContaining({ action: "created", data: expect.objectContaining({ orgId: TARGET_ORG_ID }) }),
    );
  });

  it("move requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.repo.move({ repoId: REPO_ID, targetOrgId: TARGET_ORG_ID }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  it("move throws FORBIDDEN if not admin in source org", async () => {
    const { requireOrgMember } = await import("../lib/requireOrgMember.js");
    const mockRequireOrgMember = vi.mocked(requireOrgMember);
    // First call: requireAccessibleRepo's internal requireOrgMember — succeeds
    // Second call: source org admin check — fails
    mockRequireOrgMember
      .mockResolvedValueOnce({ orgId: ORG_ID, userId: USER_ID, role: "member" } as any)
      .mockRejectedValueOnce(new TRPCError({ code: "FORBIDDEN", message: "Requires at least admin role" }));

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // requireAccessibleRepo: fetch repo by id
    resultQueue.push([mockRepo]);

    const caller = createCaller(true);
    await expect(
      caller.repo.move({ repoId: REPO_ID, targetOrgId: TARGET_ORG_ID }),
    ).rejects.toThrow("Requires at least admin role");
  });

  it("move throws PRECONDITION_FAILED if active sessions exist", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // requireAccessibleRepo: fetch repo by id
    resultQueue.push([mockRepo]);
    // active sessions check (where-terminal) — has active session
    whereTerminalQueue.push([{ id: "active-sess", repoId: REPO_ID, status: "active" }]);

    const caller = createCaller(true);
    await expect(
      caller.repo.move({ repoId: REPO_ID, targetOrgId: TARGET_ORG_ID }),
    ).rejects.toThrow("Cannot move a repo with active sessions");
  });

  it("move throws CONFLICT if bdPrefix collision", async () => {
    const conflictRepo = { ...mockRepo, id: "conflict-id", orgId: TARGET_ORG_ID };
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // requireAccessibleRepo: fetch repo by id
    resultQueue.push([mockRepo]);
    // bdPrefix uniqueness check (.limit(1)) — conflict found
    resultQueue.push([conflictRepo]);
    // active sessions check (where-terminal) — none active
    whereTerminalQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.repo.move({ repoId: REPO_ID, targetOrgId: TARGET_ORG_ID }),
    ).rejects.toThrow(`A repo with prefix "${mockRepo.bdPrefix}" already exists in the target organization`);
  });

  it("move throws BAD_REQUEST if targetOrgId equals current orgId", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // requireAccessibleRepo: fetch repo by id
    resultQueue.push([mockRepo]);

    const caller = createCaller(true);
    await expect(
      caller.repo.move({ repoId: REPO_ID, targetOrgId: ORG_ID }),
    ).rejects.toThrow("Repo is already in the target organization");
  });
});
