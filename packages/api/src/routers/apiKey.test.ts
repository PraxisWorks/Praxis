import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock modules BEFORE imports
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

vi.mock("../services/crypto/index.js", () => ({
  getCryptoAdapter: vi.fn(() => ({
    encrypt: vi.fn().mockResolvedValue("encrypted-value"),
    decrypt: vi.fn().mockResolvedValue("decrypted-value"),
  })),
}));

vi.mock("../services/anthropic/index.js", () => ({
  getAnthropicAdapter: vi.fn(() => ({
    validateKey: vi.fn().mockResolvedValue({ valid: true }),
  })),
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

describe("apiKeyRouter", () => {
  const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
  const OTHER_USER_ID = "550e8400-e29b-41d4-a716-446655440099";
  const API_KEY_ID = "770e8400-e29b-41d4-a716-446655440002";

  const mockApiKey = {
    id: API_KEY_ID,
    userId: USER_ID,
    label: "Production Key",
    keyLastFour: "c123",
    encryptedKey: "encrypted-value",
    status: "provisioning",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockMaskedApiKey = {
    id: API_KEY_ID,
    userId: USER_ID,
    label: "Production Key",
    keyLastFour: "c123",
    status: "provisioning",
    createdAt: mockApiKey.createdAt,
    updatedAt: mockApiKey.updatedAt,
  };

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

  const createCaller = (authenticated = false, userId = USER_ID) =>
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

  it("list returns all keys for the current user (masked, no encryptedKey)", async () => {
    // lookupUserId (protectedProcedure middleware)
    resultQueue.push([{ id: USER_ID }]);
    // list query terminal: orderBy
    mockDb.orderBy.mockResolvedValueOnce([mockMaskedApiKey]);

    const caller = createCaller(true);
    const result = await caller.apiKey.list();

    expect(result).toEqual([mockMaskedApiKey]);
    expect(result[0]).not.toHaveProperty("encryptedKey");
  });

  it("list requires auth", async () => {
    const caller = createCaller(false);
    await expect(caller.apiKey.list()).rejects.toThrow("UNAUTHORIZED");
  });

  // --- getById ---

  it("getById returns a single key by ID", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // getById: select().from().where().limit(1) — limit is terminal
    resultQueue.push([mockMaskedApiKey]);

    const caller = createCaller(true);
    const result = await caller.apiKey.getById({ id: API_KEY_ID });

    expect(result).toEqual(mockMaskedApiKey);
    expect(result).not.toHaveProperty("encryptedKey");
  });

  it("getById throws NOT_FOUND for non-existent key", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // getById: select().from().where().limit(1) — empty result
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.apiKey.getById({ id: API_KEY_ID }),
    ).rejects.toThrow("API key not found");
  });

  it("getById requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.apiKey.getById({ id: API_KEY_ID }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // --- create ---

  it("create validates key, encrypts, inserts, enqueues job, and publishes event", async () => {
    const { enqueueJob } = await import("../jobs/index.js");

    // lookupUserId (role: "admin" bypasses requirePermission check)
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // 5-key limit check: select().from().where() — terminal where via then()
    whereTerminalQueue.push([]);
    // insert().values().returning()
    mockDb.returning.mockResolvedValueOnce([mockApiKey]);

    const caller = createCaller(true);
    const result = await caller.apiKey.create({
      label: "Production Key",
      key: "sk-ant-api03-test1234567890abc123",
    });

    // Returns masked (no encryptedKey in the returned shape)
    expect(result.id).toBe(API_KEY_ID);
    expect(result.label).toBe("Production Key");
    expect(result.keyLastFour).toBe("c123");
    expect(result.status).toBe("provisioning");
    expect(result).not.toHaveProperty("encryptedKey");

    // Enqueued provisioning job
    expect(enqueueJob).toHaveBeenCalledWith(
      "byok-provision-worker",
      { apiKeyId: API_KEY_ID, userId: USER_ID },
    );

    // Published sync event
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:apiKey",
      expect.objectContaining({ action: "created" }),
    );
  });

  it("create returns FORBIDDEN when 5 non-revoked keys already exist", async () => {
    // lookupUserId (role: "admin" bypasses requirePermission check)
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // 5-key limit check: select().from().where() — 5 existing keys
    whereTerminalQueue.push([
      { id: "key-1" },
      { id: "key-2" },
      { id: "key-3" },
      { id: "key-4" },
      { id: "key-5" },
    ]);

    const caller = createCaller(true);
    await expect(
      caller.apiKey.create({
        label: "Sixth Key",
        key: "sk-ant-api03-test6666666666666666",
      }),
    ).rejects.toThrow("Maximum 5 active API keys allowed");
  });

  it("create returns BAD_REQUEST for invalid Anthropic key", async () => {
    const { getAnthropicAdapter } = await import("../services/anthropic/index.js");
    (getAnthropicAdapter as any).mockReturnValueOnce({
      validateKey: vi.fn().mockResolvedValue({ valid: false, error: "Invalid API key" }),
    });

    // lookupUserId (role: "admin" bypasses requirePermission check)
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // 5-key limit check: no existing keys
    whereTerminalQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.apiKey.create({
        label: "Bad Key",
        key: "sk-ant-api03-invalidkey00000bad",
      }),
    ).rejects.toThrow("Invalid API key");
  });

  it("create requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.apiKey.create({
        label: "My Key",
        key: "sk-ant-api03-test0000000000000000",
      }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  it("create requires worker:create:apikey permission", async () => {
    const ROLE_ID = "770e8400-e29b-41d4-a716-446655440003";
    // lookupUserId — non-admin user with a roleId but no permissions granted
    resultQueue.push([{ id: USER_ID, role: "member", roleId: ROLE_ID }]);
    // resolveUserPermissions: rolePermissions query returns empty
    whereTerminalQueue.push([]);
    // resolveUserPermissions: userPermissionOverrides query returns empty
    whereTerminalQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.apiKey.create({
        label: "My Key",
        key: "sk-ant-api03-test0000000000000000",
      }),
    ).rejects.toThrow("Missing permissions: worker:create:apikey");
  });

  it("create allows admin users (admin bypass)", async () => {
    // lookupUserId (role: "admin" bypasses requirePermission check)
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // 5-key limit check: no existing keys
    whereTerminalQueue.push([]);
    // insert().values().returning()
    mockDb.returning.mockResolvedValueOnce([mockApiKey]);

    const caller = createCaller(true);
    const result = await caller.apiKey.create({
      label: "Admin Key",
      key: "sk-ant-api03-test1234567890abc123",
    });

    expect(result.id).toBe(API_KEY_ID);
  });

  it("create allows users with worker:create:apikey permission", async () => {
    const ROLE_ID = "770e8400-e29b-41d4-a716-446655440003";
    // lookupUserId — non-admin user with a role
    resultQueue.push([{ id: USER_ID, role: "member", roleId: ROLE_ID }]);
    // resolveUserPermissions: rolePermissions query returns the required permission
    whereTerminalQueue.push([{ permissionKey: "worker:create:apikey" }]);
    // resolveUserPermissions: userPermissionOverrides query returns empty
    whereTerminalQueue.push([]);
    // 5-key limit check: no existing keys
    whereTerminalQueue.push([]);
    // insert().values().returning()
    mockDb.returning.mockResolvedValueOnce([mockApiKey]);

    const caller = createCaller(true);
    const result = await caller.apiKey.create({
      label: "Permitted Key",
      key: "sk-ant-api03-test1234567890abc123",
    });

    expect(result.id).toBe(API_KEY_ID);
  });

  // --- delete ---

  it("delete sets status to revoked, enqueues teardown, and publishes event", async () => {
    const { enqueueJob } = await import("../jobs/index.js");
    const revokedKey = { ...mockApiKey, status: "revoked" };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // delete: select().from().where().limit(1) — find existing key
    resultQueue.push([mockApiKey]);
    // update().set().where().returning()
    mockDb.returning.mockResolvedValueOnce([revokedKey]);

    const caller = createCaller(true);
    const result = await caller.apiKey.delete({ id: API_KEY_ID });

    expect(result).toEqual({ success: true });

    // Enqueued teardown job
    expect(enqueueJob).toHaveBeenCalledWith(
      "byok-teardown-worker",
      { apiKeyId: API_KEY_ID },
    );

    // Published sync event
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:apiKey",
      expect.objectContaining({ action: "deleted" }),
    );
  });

  it("delete throws NOT_FOUND for non-existent key", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // delete: select().from().where().limit(1) — empty result
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.apiKey.delete({ id: API_KEY_ID }),
    ).rejects.toThrow("API key not found");
  });

  it("delete requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.apiKey.delete({ id: API_KEY_ID }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // --- ownership scoping ---

  it("user A cannot read user B's key (ownership scoping)", async () => {
    // Create caller that resolves to OTHER_USER_ID via the protectedProcedure lookup
    const callerB = appRouter.createCaller({
      user: { sub: "other-user", email: "other@example.com" },
      db: mockDb as any,
      pubsub: mockPubsub as any,
    });

    // lookupUserId — resolves to OTHER_USER_ID
    resultQueue.push([{ id: OTHER_USER_ID }]);
    // getById: select().from().where(and(eq(id), eq(userId))).limit(1) — no match
    // because the where clause scopes to OTHER_USER_ID but key belongs to USER_ID
    resultQueue.push([]);

    await expect(
      callerB.apiKey.getById({ id: API_KEY_ID }),
    ).rejects.toThrow("API key not found");
  });
});
