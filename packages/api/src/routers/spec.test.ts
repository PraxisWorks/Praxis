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

describe("specRouter", () => {
  const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
  const REPO_ID = "660e8400-e29b-41d4-a716-446655440001";
  const SPEC_ID = "770e8400-e29b-41d4-a716-446655440002";

  const mockRepo = { id: REPO_ID, userId: USER_ID, name: "Test Repo" };

  const mockSpec = {
    id: SPEC_ID,
    repoId: REPO_ID,
    title: "Project Spec",
    content: "# Overview",
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
  });

  // --- getByRepo ---

  it("getByRepo returns spec when it exists", async () => {
    // lookupUserId (requirePermission → protectedProcedure middleware)
    // role: "admin" bypasses permission resolution queries
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // repo ownership check
    resultQueue.push([mockRepo]);
    // getByRepo query
    resultQueue.push([mockSpec]);

    const caller = createCaller(true);
    const result = await caller.spec.getByRepo({ repoId: REPO_ID });
    expect(result).toEqual(mockSpec);
  });

  it("getByRepo returns null when no spec exists", async () => {
    // role: "admin" bypasses permission resolution queries
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    resultQueue.push([mockRepo]);
    resultQueue.push([]);

    const caller = createCaller(true);
    const result = await caller.spec.getByRepo({ repoId: REPO_ID });
    expect(result).toBeNull();
  });

  it("getByRepo requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.spec.getByRepo({ repoId: REPO_ID }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // --- upsert (create) ---

  it("upsert creates spec when none exists and publishes sync", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // repo ownership check
    resultQueue.push([mockRepo]);
    // Check existing spec
    resultQueue.push([]);
    // insert().values().returning()
    mockDb.returning.mockResolvedValueOnce([mockSpec]);

    const caller = createCaller(true);
    const result = await caller.spec.upsert({
      repoId: REPO_ID,
      title: "Project Spec",
      content: "# Overview",
    });

    expect(result).toEqual(mockSpec);
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:spec",
      expect.objectContaining({ action: "created" }),
    );
  });

  // --- upsert (update) ---

  it("upsert updates spec when one exists and publishes sync", async () => {
    const updatedSpec = { ...mockSpec, title: "Updated Spec" };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // repo ownership check
    resultQueue.push([mockRepo]);
    // Check existing spec — found
    resultQueue.push([mockSpec]);
    // update().set().where().returning()
    mockDb.returning.mockResolvedValueOnce([updatedSpec]);

    const caller = createCaller(true);
    const result = await caller.spec.upsert({
      repoId: REPO_ID,
      title: "Updated Spec",
      content: "# Overview",
    });

    expect(result).toEqual(updatedSpec);
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:spec",
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("upsert requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.spec.upsert({
        repoId: REPO_ID,
        title: "Spec",
        content: "Content",
      }),
    ).rejects.toThrow("UNAUTHORIZED");
  });
});
