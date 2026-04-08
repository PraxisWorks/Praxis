import { describe, it, expect, vi, beforeEach } from "vitest";

// Same mocks as other router tests
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

vi.mock("bcrypt", () => ({
  hash: vi.fn().mockResolvedValue("hashed-token-value"),
}));

vi.mock("../lib/checkLimitFromRole.js", () => ({
  checkLimitFromRole: vi.fn().mockResolvedValue(undefined),
}));

import { appRouter } from "./index.js";
import { checkLimitFromRole } from "../lib/checkLimitFromRole.js";
import { TRPCError } from "@trpc/server";

describe("workerRouter", () => {
  const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
  const WORKER_ID = "660e8400-e29b-41d4-a716-446655440001";
  const OTHER_USER_ID = "550e8400-e29b-41d4-a716-446655440099";

  const mockWorker = {
    id: WORKER_ID,
    userId: USER_ID,
    name: "My Worker",
    status: "offline",
    lastSeenAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUser = {
    id: USER_ID,
    sub: "user123",
    activeWorkerId: WORKER_ID,
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
    orderBy: vi.fn().mockReturnThis(),
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
    mockDb.orderBy.mockResolvedValue([mockWorker]);
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
    mockDb.returning.mockResolvedValue([mockWorker]);
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.delete.mockReturnThis();
  });

  // ---- list ----

  it("list returns workers for the current user", async () => {
    // lookupUserId (protectedProcedure middleware)
    resultQueue.push([{ id: USER_ID }]);

    const caller = createCaller(true);
    const result = await caller.worker.list();
    expect(result).toEqual([mockWorker]);
  });

  it("list requires auth", async () => {
    const caller = createCaller(false);
    await expect(caller.worker.list()).rejects.toThrow("UNAUTHORIZED");
  });

  // ---- getActive ----

  it("getActive returns active worker details", async () => {
    // lookupUserId (protectedProcedure middleware)
    resultQueue.push([{ id: USER_ID }]);
    // fetch user row
    resultQueue.push([mockUser]);
    // fetch worker row
    resultQueue.push([mockWorker]);

    const caller = createCaller(true);
    const result = await caller.worker.getActive();
    expect(result).toEqual(mockWorker);
  });

  it("getActive returns null when no active worker set", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // fetch user row (no activeWorkerId)
    resultQueue.push([{ ...mockUser, activeWorkerId: null }]);

    const caller = createCaller(true);
    const result = await caller.worker.getActive();
    expect(result).toBeNull();
  });

  it("getActive requires auth", async () => {
    const caller = createCaller(false);
    await expect(caller.worker.getActive()).rejects.toThrow("UNAUTHORIZED");
  });

  // ---- generateToken ----

  it("generateToken requires worker:create:local permission", async () => {
    // lookupUserId — non-admin user with a roleId but no permissions granted
    const ROLE_ID = "770e8400-e29b-41d4-a716-446655440002";
    resultQueue.push([{ id: USER_ID, role: "member", roleId: ROLE_ID }]);
    // resolveUserPermissions: rolePermissions query returns empty
    whereTerminalQueue.push([]);
    // resolveUserPermissions: userPermissionOverrides query returns empty
    whereTerminalQueue.push([]);

    const caller = createCaller(true);
    await expect(caller.worker.generateToken({})).rejects.toThrow(
      "Missing permissions: worker:create:local",
    );
  });

  it("generateToken creates token and returns plaintext", async () => {
    // lookupUserId (role: "admin" bypasses requirePermission check)
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);

    const caller = createCaller(true);
    const result = await caller.worker.generateToken({});

    expect(result).toHaveProperty("token");
    expect(result).toHaveProperty("expiresAt");
    expect(typeof result.token).toBe("string");
    expect(result.token.length).toBe(64); // 32 bytes hex = 64 chars
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalled();
  });

  it("generateToken requires auth", async () => {
    const caller = createCaller(false);
    await expect(caller.worker.generateToken({})).rejects.toThrow("UNAUTHORIZED");
  });

  // ---- removeWorker ----

  it("removeWorker deletes worker and publishes sync", async () => {
    // lookupUserId (role: "admin" bypasses requirePermission check)
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // requireOwnedWorker
    resultQueue.push([mockWorker]);

    const caller = createCaller(true);
    const result = await caller.worker.removeWorker({ id: WORKER_ID });

    expect(result).toEqual({ success: true });
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.delete).toHaveBeenCalled();
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:worker",
      expect.objectContaining({ action: "deleted" }),
    );
  });

  it("removeWorker throws NOT_FOUND for missing worker", async () => {
    // lookupUserId (role: "admin" bypasses requirePermission check)
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // requireOwnedWorker returns empty
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(caller.worker.removeWorker({ id: WORKER_ID })).rejects.toThrow(
      "Worker not found",
    );
  });

  it("removeWorker requires auth", async () => {
    const caller = createCaller(false);
    await expect(caller.worker.removeWorker({ id: WORKER_ID })).rejects.toThrow(
      "UNAUTHORIZED",
    );
  });

  // ---- renameWorker ----

  it("renameWorker updates name and publishes sync", async () => {
    const updatedWorker = { ...mockWorker, name: "Renamed Worker" };
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // update().set().where().returning()
    mockDb.returning.mockResolvedValue([updatedWorker]);

    const caller = createCaller(true);
    const result = await caller.worker.renameWorker({
      id: WORKER_ID,
      data: { name: "Renamed Worker" },
    });

    expect(result).toEqual(updatedWorker);
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:worker",
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("renameWorker throws NOT_FOUND when worker not found or not owned", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // update().set().where().returning() returns empty
    mockDb.returning.mockResolvedValue([]);

    const caller = createCaller(true);
    await expect(
      caller.worker.renameWorker({ id: WORKER_ID, data: { name: "New Name" } }),
    ).rejects.toThrow("Worker not found");
  });

  it("renameWorker requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.worker.renameWorker({ id: WORKER_ID, data: { name: "New Name" } }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // ---- setActive ----

  it("setActive sets user active worker", async () => {
    const updatedUser = { ...mockUser, activeWorkerId: WORKER_ID };
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // requireOwnedWorker
    resultQueue.push([mockWorker]);
    // update().set().where().returning()
    mockDb.returning.mockResolvedValue([updatedUser]);

    const caller = createCaller(true);
    const result = await caller.worker.setActive({ workerId: WORKER_ID });

    expect(result).toEqual({ activeWorkerId: WORKER_ID });
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:worker",
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("setActive clears active worker when null", async () => {
    const updatedUser = { ...mockUser, activeWorkerId: null };
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // No requireOwnedWorker call for null
    // update().set().where().returning()
    mockDb.returning.mockResolvedValue([updatedUser]);

    const caller = createCaller(true);
    const result = await caller.worker.setActive({ workerId: null });

    expect(result).toEqual({ activeWorkerId: null });
    expect(mockDb.update).toHaveBeenCalled();
  });

  it("setActive throws NOT_FOUND for non-owned worker", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // requireOwnedWorker returns empty (worker not owned)
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.worker.setActive({ workerId: WORKER_ID }),
    ).rejects.toThrow("Worker not found");
  });

  it("setActive requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.worker.setActive({ workerId: WORKER_ID }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // ---- generateToken - limit enforcement ----

  describe("generateToken - limit enforcement", () => {
    it("blocks token generation when at limit", async () => {
      // lookupUserId (admin bypasses requirePermission middleware)
      resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);

      vi.mocked(checkLimitFromRole).mockRejectedValueOnce(
        new TRPCError({
          code: "FORBIDDEN",
          message: "Worker limit reached (5/5)",
        }),
      );

      const caller = createCaller(true);
      await expect(caller.worker.generateToken({})).rejects.toThrow(
        "Worker limit reached (5/5)",
      );
    });

    it("allows token generation when under limit", async () => {
      // lookupUserId (admin bypasses requirePermission middleware)
      resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);

      vi.mocked(checkLimitFromRole).mockResolvedValueOnce(undefined);

      const caller = createCaller(true);
      const result = await caller.worker.generateToken({});

      expect(result).toHaveProperty("token");
      expect(result).toHaveProperty("expiresAt");
      expect(checkLimitFromRole).toHaveBeenCalledWith(
        mockDb,
        USER_ID,
        null,
        "admin",
        "maxWorkers",
        expect.any(Function),
      );
    });

    it("admin bypass works (checkLimitFromRole resolves without throwing)", async () => {
      // lookupUserId (admin)
      resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);

      const caller = createCaller(true);
      const result = await caller.worker.generateToken({});

      expect(result).toHaveProperty("token");
      expect(result.token.length).toBe(64);
      // checkLimitFromRole is called but resolves (default mock)
      expect(checkLimitFromRole).toHaveBeenCalled();
    });
  });
});
