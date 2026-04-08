import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// Mock the database module
vi.mock("../db/index.js", () => ({
  getConnectionString: vi.fn(() => "postgresql://mock"),
  getDb: vi.fn(() => ({})),
  getSql: vi.fn(() => ({ unsafe: vi.fn().mockResolvedValue([]) })),
}));

// Mock jose for auth middleware
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
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock("../lib/provisionDbRole.js", () => ({
  provisionDbRole: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../jobs/index.js", () => ({
  enqueueJob: vi.fn().mockResolvedValue("job-123"),
}));

vi.mock("../services/notifications/index.js", () => ({
  sendNotification: vi.fn().mockResolvedValue({ notificationIds: [], pushResults: { sent: 0, skipped: 0, failed: 0 } }),
}));

vi.mock("../db/system-settings.js", () => ({
  readSetting: vi.fn().mockResolvedValue(""),
  writeSetting: vi.fn().mockResolvedValue(undefined),
}));

import { sendNotification } from "../services/notifications/index.js";
import { setAuth0MgmtAdapter, resetAuth0MgmtAdapter } from "../services/auth0-mgmt/index.js";
import type { Auth0MgmtAdapter } from "../services/auth0-mgmt/types.js";
import { appRouter } from "./index.js";

describe("userRouter", () => {
  const mockUser = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    name: "Alice",
    email: "alice@example.com",
    role: "user",
    createdAt: new Date(),
  };

  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue([mockUser]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([mockUser]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([mockUser]),
  };

  const mockPubsub = {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    close: vi.fn(),
  };

  const createCaller = (authenticated = false) =>
    appRouter.createCaller({
      user: authenticated ? { sub: "user123", email: "test@example.com" } : null,
      db: mockDb as any,
      pubsub: mockPubsub as any,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset chainable mock methods
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.orderBy.mockResolvedValue([mockUser]);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValue([mockUser]);
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.delete.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.innerJoin.mockReturnThis();
    mockDb.limit.mockResolvedValue([mockUser]);
  });

  it("list returns users when authenticated", async () => {
    const caller = createCaller(true);
    const result = await caller.user.list();
    expect(result).toEqual([mockUser]);
  });

  it("list requires authentication", async () => {
    const caller = createCaller(false);
    await expect(caller.user.list()).rejects.toThrow("UNAUTHORIZED");
  });

  it("create requires authentication", async () => {
    const caller = createCaller(false);
    await expect(
      caller.user.create({ name: "Bob", email: "bob@example.com" }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  it("create inserts user when authenticated", async () => {
    const caller = createCaller(true);
    const result = await caller.user.create({ name: "Bob", email: "bob@example.com" });
    expect(result).toEqual(mockUser);
    expect(mockPubsub.publish).toHaveBeenCalled();
  });

  it("delete requires authentication", async () => {
    const caller = createCaller(false);
    await expect(
      caller.user.delete({ email: "alice@example.com" }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  it("updateTheme requires authentication", async () => {
    const caller = createCaller(false);
    await expect(
      caller.user.updateTheme({ theme: "dark" }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  it("updateTheme updates theme when authenticated", async () => {
    const caller = createCaller(true);
    const result = await caller.user.updateTheme({ theme: "dark" });
    expect(result).toEqual(mockUser);
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({ theme: "dark" });
    expect(mockPubsub.publish).toHaveBeenCalled();
  });

  it("updateTheme rejects invalid theme value", async () => {
    const caller = createCaller(true);
    await expect(
      caller.user.updateTheme({ theme: "blue" as any }),
    ).rejects.toThrow();
  });

  describe("create auto-join invitations", () => {
    const mockInvitation = {
      id: "inv-001",
      orgId: "org-001",
      email: "bob@example.com",
      role: "member" as const,
      invitedBy: "user-999",
      status: "pending" as const,
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
    };

    /**
     * Helper: configure mockDb.where so the auth-middleware call (1st)
     * stays chainable while the invitation-select call (2nd) resolves
     * to the given array. Subsequent calls resolve to undefined (for
     * invitation status updates).
     */
    function setupWhereForInvitations(invitations: unknown[]) {
      let callCount = 0;
      mockDb.where.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Auth middleware: select().from().where().limit() — must be chainable
          return mockDb;
        }
        if (callCount === 2) {
          // Invitation select: select().from().innerJoin().where() — must resolve to array
          return Promise.resolve(invitations);
        }
        // Subsequent calls: invitation update .where() — result discarded
        return Promise.resolve(undefined);
      });
    }

    it("no pending invitations — existing behavior unchanged", async () => {
      setupWhereForInvitations([]);

      const caller = createCaller(true);
      const result = await caller.user.create({ name: "Bob", email: "bob@example.com" });
      expect(result).toEqual(mockUser);
      expect(sendNotification).not.toHaveBeenCalled();
    });

    it("1 pending invitation — auto-joins org and sends notification", async () => {
      const pendingInvitations = [
        { invitation: mockInvitation, orgName: "Acme Corp" },
      ];
      setupWhereForInvitations(pendingInvitations);

      const caller = createCaller(true);
      await caller.user.create({ name: "Bob", email: "bob@example.com" });

      // Should have inserted org member
      expect(mockDb.insert).toHaveBeenCalledTimes(2); // user + org member
      // Should have called sendNotification
      expect(sendNotification).toHaveBeenCalledWith(
        mockDb,
        mockPubsub,
        { userId: mockUser.id },
        { title: "Welcome to Acme Corp!", body: "You've been added to Acme Corp." },
      );
    });

    it("2 pending invitations — joined to both orgs", async () => {
      const inv2 = { ...mockInvitation, id: "inv-002", orgId: "org-002" };
      const pendingInvitations = [
        { invitation: mockInvitation, orgName: "Acme Corp" },
        { invitation: inv2, orgName: "Beta Inc" },
      ];
      setupWhereForInvitations(pendingInvitations);

      const caller = createCaller(true);
      await caller.user.create({ name: "Bob", email: "bob@example.com" });

      // insert called 3 times: user + 2 org members
      expect(mockDb.insert).toHaveBeenCalledTimes(3);
      expect(sendNotification).toHaveBeenCalledTimes(2);
      expect(sendNotification).toHaveBeenCalledWith(
        mockDb, mockPubsub, { userId: mockUser.id },
        { title: "Welcome to Acme Corp!", body: "You've been added to Acme Corp." },
      );
      expect(sendNotification).toHaveBeenCalledWith(
        mockDb, mockPubsub, { userId: mockUser.id },
        { title: "Welcome to Beta Inc!", body: "You've been added to Beta Inc." },
      );
    });

    it("expired invitation — skipped", async () => {
      setupWhereForInvitations([]);

      const caller = createCaller(true);
      await caller.user.create({ name: "Bob", email: "bob@example.com" });

      expect(sendNotification).not.toHaveBeenCalled();
      // Only the user insert, no org member insert
      expect(mockDb.insert).toHaveBeenCalledTimes(1);
    });
  });

  describe("resendVerification", () => {
    const mockAdapter: Auth0MgmtAdapter = {
      createUser: vi.fn(),
      changePasswordTicket: vi.fn(),
      sendVerificationEmail: vi.fn(),
    };

    beforeEach(() => {
      setAuth0MgmtAdapter(mockAdapter);
      vi.mocked(mockAdapter.sendVerificationEmail).mockReset();
    });

    afterAll(() => {
      resetAuth0MgmtAdapter();
    });

    it("calls sendVerificationEmail with correct sub and returns success", async () => {
      vi.mocked(mockAdapter.sendVerificationEmail).mockResolvedValue({ success: true });

      const caller = appRouter.createCaller({
        user: { sub: "auth0|test-user" },
        db: mockDb as any,
        pubsub: mockPubsub as any,
      });

      const result = await caller.user.resendVerification();

      expect(result).toEqual({ success: true });
      expect(mockAdapter.sendVerificationEmail).toHaveBeenCalledWith("auth0|test-user");
    });

    it("returns success false when adapter fails gracefully", async () => {
      vi.mocked(mockAdapter.sendVerificationEmail).mockResolvedValue({ success: false });

      const caller = appRouter.createCaller({
        user: { sub: "auth0|test-user" },
        db: mockDb as any,
        pubsub: mockPubsub as any,
      });

      const result = await caller.user.resendVerification();

      expect(result).toEqual({ success: false });
    });

    it("throws UNAUTHORIZED when user is null", async () => {
      const caller = appRouter.createCaller({
        user: null,
        db: mockDb as any,
        pubsub: mockPubsub as any,
      });

      await expect(caller.user.resendVerification()).rejects.toThrow("UNAUTHORIZED");
    });
  });

  describe("delete authorization", () => {
    it("admin can delete any user", async () => {
      const adminUser = { ...mockUser, role: "admin", email: "admin@test.com" };
      mockDb.limit.mockResolvedValue([adminUser]); // protectedProcedure resolves this as dbUser
      mockDb.returning.mockResolvedValue([mockUser]); // the deleted user

      const caller = createCaller(true);
      const result = await caller.user.delete({ email: "other@example.com" });
      expect(result).toEqual({ success: true });
    });

    it("user can delete their own account", async () => {
      const selfUser = { ...mockUser, role: "user", email: "alice@example.com" };
      mockDb.limit.mockResolvedValue([selfUser]); // dbUser
      mockDb.returning.mockResolvedValue([selfUser]); // the deleted user

      const caller = createCaller(true);
      const result = await caller.user.delete({ email: "alice@example.com" });
      expect(result).toEqual({ success: true });
    });

    it("user cannot delete another user", async () => {
      const selfUser = { ...mockUser, role: "user", email: "me@test.com" };
      mockDb.limit.mockResolvedValue([selfUser]); // dbUser is "me@test.com"

      const caller = createCaller(true);
      await expect(
        caller.user.delete({ email: "other@example.com" }),
      ).rejects.toThrow("You can only delete your own account");
    });

    it("user with no db record gets NOT_FOUND", async () => {
      mockDb.limit.mockResolvedValue([]); // no dbUser found

      const caller = createCaller(true);
      await expect(
        caller.user.delete({ email: "anyone@example.com" }),
      ).rejects.toThrow("Caller user record not found");
    });
  });

  describe("touch self-only", () => {
    it("authenticated user touches own record", async () => {
      const caller = createCaller(true);
      const result = await caller.user.touch();
      expect(result).toEqual(mockUser);
      expect(mockDb.set).toHaveBeenCalledWith({ lastLoginAt: expect.any(Date) });
      expect(mockPubsub.publish).toHaveBeenCalled();
    });

    it("touch requires authentication", async () => {
      const caller = createCaller(false);
      await expect(caller.user.touch()).rejects.toThrow("UNAUTHORIZED");
    });

    it("touch returns null when no matching user", async () => {
      mockDb.returning.mockResolvedValue([]); // no user found for this sub

      const caller = createCaller(true);
      const result = await caller.user.touch();
      expect(result).toBeNull();
      expect(mockPubsub.publish).not.toHaveBeenCalled();
    });
  });
});
