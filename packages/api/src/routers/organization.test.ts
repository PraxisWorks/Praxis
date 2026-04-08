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

vi.mock("../services/notifications/index.js", () => ({
  sendNotification: vi.fn().mockResolvedValue({ notificationIds: ["notif-1"], pushResults: { sent: 0, skipped: 0, failed: 0 } }),
}));

vi.mock("../jobs/handlers/processOrgInvitation.js", () => ({
  PROCESS_ORG_INVITATION: "process-org-invitation",
}));

vi.mock("../lib/requireOrgMember.js", () => ({
  requireOrgMember: vi.fn().mockResolvedValue({ orgId: "mock", userId: "mock", role: "owner" }),
}));

vi.mock("../middleware/requirePermission.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware/requirePermission.js")>();
  return {
    ...actual,
    resolveUserPermissions: vi.fn().mockResolvedValue(new Set<string>()),
  };
});

vi.mock("@praxis2/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@praxis2/shared")>();
  return {
    ...actual,
    loadSkillDefaults: vi.fn().mockResolvedValue({
      spec: "skill-spec-content",
      architecture: "skill-architecture-content",
      debug: "skill-debug-content",
      working: "skill-working-content",
      repo: "skill-repo-content",
    }),
  };
});

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
import { requireOrgMember } from "../lib/requireOrgMember.js";
import { resolveUserPermissions } from "../middleware/requirePermission.js";
import { sendNotification } from "../services/notifications/index.js";
import { enqueueJob } from "../jobs/index.js";

describe("organizationRouter", () => {
  const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
  const ORG_ID = "aa0e8400-e29b-41d4-a716-446655440010";
  const WORKER_ID = "bb0e8400-e29b-41d4-a716-446655440020";

  const mockOrg = {
    id: ORG_ID,
    name: "Test Org",
    slug: "test-org",
    workerPolicy: "user_default",
    centralWorkerId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPubsub = {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    close: vi.fn(),
  };

  let resultQueue: unknown[];
  let orderByQueue: unknown[];

  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn(function (this: any) { return this; }),
    limit: vi.fn(() => {
      const result = resultQueue.shift();
      return Promise.resolve(result ?? []);
    }),
    then: vi.fn((resolve: any) => {
      const result = orderByQueue.shift();
      return Promise.resolve(result ?? []).then(resolve);
    }),
    leftJoin: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    as: vi.fn().mockReturnValue("subquery"),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
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
    orderByQueue = [];

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockImplementation(function (this: any) { return this; });
    mockDb.limit.mockImplementation(() => {
      const result = resultQueue.shift();
      return Promise.resolve(result ?? []);
    });
    mockDb.then.mockImplementation((resolve: any) => {
      const result = orderByQueue.shift();
      return Promise.resolve(result ?? []).then(resolve);
    });
    mockDb.leftJoin.mockReturnThis();
    mockDb.innerJoin.mockReturnThis();
    mockDb.groupBy.mockReturnThis();
    mockDb.as.mockReturnValue("subquery");
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValue([]);
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.delete.mockReturnThis();
    mockDb.onConflictDoUpdate.mockResolvedValue(undefined);
  });

  // --- setWorkerPolicy ---

  describe("setWorkerPolicy", () => {
    it("admin can set policy to user_default", async () => {
      const updatedOrg = { ...mockOrg, workerPolicy: "user_default" };

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // requireOrgMember is mocked (returns owner role)
      // update().set().where().returning()
      mockDb.returning.mockResolvedValueOnce([updatedOrg]);

      const caller = createCaller(true);
      const result = await caller.organization.setWorkerPolicy({
        orgId: ORG_ID,
        policy: "user_default",
      });

      expect(result).toEqual(updatedOrg);
      expect(mockPubsub.publish).toHaveBeenCalledWith(
        "sync:organization",
        expect.objectContaining({ action: "updated" }),
      );
    });

    it("admin can set policy to central_worker with owned worker", async () => {
      const updatedOrg = { ...mockOrg, workerPolicy: "central_worker", centralWorkerId: WORKER_ID };

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // requireOrgMember is mocked
      // verify worker ownership: select().from(workers).where(...).limit(1)
      resultQueue.push([{ id: WORKER_ID, userId: USER_ID }]);
      // update().set().where().returning()
      mockDb.returning.mockResolvedValueOnce([updatedOrg]);

      const caller = createCaller(true);
      const result = await caller.organization.setWorkerPolicy({
        orgId: ORG_ID,
        policy: "central_worker",
        centralWorkerId: WORKER_ID,
      });

      expect(result).toEqual(updatedOrg);
      expect(result.centralWorkerId).toBe(WORKER_ID);
    });

    it("rejects central_worker policy when worker is not owned by caller", async () => {
      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // requireOrgMember is mocked
      // verify worker ownership: no match
      resultQueue.push([]);

      const caller = createCaller(true);
      await expect(
        caller.organization.setWorkerPolicy({
          orgId: ORG_ID,
          policy: "central_worker",
          centralWorkerId: WORKER_ID,
        }),
      ).rejects.toThrow("You can only assign a worker you own");
    });

    it("admin can set policy to require_local", async () => {
      const updatedOrg = { ...mockOrg, workerPolicy: "require_local" };

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // requireOrgMember is mocked
      // update().set().where().returning()
      mockDb.returning.mockResolvedValueOnce([updatedOrg]);

      const caller = createCaller(true);
      const result = await caller.organization.setWorkerPolicy({
        orgId: ORG_ID,
        policy: "require_local",
      });

      expect(result.workerPolicy).toBe("require_local");
    });

    it("rejects non-admin users", async () => {
      const { TRPCError } = await import("@trpc/server");
      vi.mocked(requireOrgMember).mockRejectedValueOnce(
        new TRPCError({ code: "FORBIDDEN", message: "Requires at least admin role in this organization" }),
      );

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);

      const caller = createCaller(true);
      await expect(
        caller.organization.setWorkerPolicy({
          orgId: ORG_ID,
          policy: "user_default",
        }),
      ).rejects.toThrow("Requires at least admin role");
    });

    it("throws NOT_FOUND when organization does not exist", async () => {
      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // requireOrgMember is mocked
      // update returns empty
      mockDb.returning.mockResolvedValueOnce([]);

      const caller = createCaller(true);
      await expect(
        caller.organization.setWorkerPolicy({
          orgId: ORG_ID,
          policy: "user_default",
        }),
      ).rejects.toThrow("Organization not found");
    });

    it("requires auth", async () => {
      const caller = createCaller(false);
      await expect(
        caller.organization.setWorkerPolicy({
          orgId: ORG_ID,
          policy: "user_default",
        }),
      ).rejects.toThrow("UNAUTHORIZED");
    });
  });

  // --- setMemberWorker ---

  describe("setMemberWorker", () => {
    it("member can assign their own worker when policy is require_local", async () => {
      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // requireOrgMember is mocked
      // org lookup for policy check
      resultQueue.push([{ workerPolicy: "require_local" }]);
      // verify worker ownership
      resultQueue.push([{ id: WORKER_ID, userId: USER_ID }]);
      // upsert (onConflictDoUpdate) - already mocked

      const caller = createCaller(true);
      const result = await caller.organization.setMemberWorker({
        orgId: ORG_ID,
        workerId: WORKER_ID,
      });

      expect(result).toEqual({ success: true });
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockPubsub.publish).toHaveBeenCalledWith(
        "sync:organization",
        expect.objectContaining({ action: "updated" }),
      );
    });

    it("rejects when worker is not owned by caller", async () => {
      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // requireOrgMember is mocked
      // org lookup for policy check
      resultQueue.push([{ workerPolicy: "require_local" }]);
      // verify worker ownership: no match
      resultQueue.push([]);

      const caller = createCaller(true);
      await expect(
        caller.organization.setMemberWorker({
          orgId: ORG_ID,
          workerId: WORKER_ID,
        }),
      ).rejects.toThrow("You can only assign a worker you own");
    });

    it("null workerId clears the assignment", async () => {
      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // requireOrgMember is mocked
      // org lookup for policy check
      resultQueue.push([{ workerPolicy: "require_local" }]);
      // delete (where chain) - no additional limit() calls

      const caller = createCaller(true);
      const result = await caller.organization.setMemberWorker({
        orgId: ORG_ID,
        workerId: null,
      });

      expect(result).toEqual({ success: true });
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it("rejects when policy is not require_local", async () => {
      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // requireOrgMember is mocked
      // org lookup for policy check
      resultQueue.push([{ workerPolicy: "user_default" }]);

      const caller = createCaller(true);
      await expect(
        caller.organization.setMemberWorker({
          orgId: ORG_ID,
          workerId: WORKER_ID,
        }),
      ).rejects.toThrow("only available when the organization uses the 'require_local' policy");
    });

    it("rejects when policy is central_worker", async () => {
      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // requireOrgMember is mocked
      // org lookup for policy check
      resultQueue.push([{ workerPolicy: "central_worker" }]);

      const caller = createCaller(true);
      await expect(
        caller.organization.setMemberWorker({
          orgId: ORG_ID,
          workerId: WORKER_ID,
        }),
      ).rejects.toThrow("only available when the organization uses the 'require_local' policy");
    });

    it("throws NOT_FOUND when organization does not exist", async () => {
      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // requireOrgMember is mocked
      // org lookup returns empty
      resultQueue.push([]);

      const caller = createCaller(true);
      await expect(
        caller.organization.setMemberWorker({
          orgId: ORG_ID,
          workerId: WORKER_ID,
        }),
      ).rejects.toThrow("Organization not found");
    });

    it("rejects non-member users", async () => {
      const { TRPCError } = await import("@trpc/server");
      vi.mocked(requireOrgMember).mockRejectedValueOnce(
        new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this organization" }),
      );

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);

      const caller = createCaller(true);
      await expect(
        caller.organization.setMemberWorker({
          orgId: ORG_ID,
          workerId: WORKER_ID,
        }),
      ).rejects.toThrow("You are not a member of this organization");
    });

    it("requires auth", async () => {
      const caller = createCaller(false);
      await expect(
        caller.organization.setMemberWorker({
          orgId: ORG_ID,
          workerId: WORKER_ID,
        }),
      ).rejects.toThrow("UNAUTHORIZED");
    });
  });

  // --- getAiInstructions ---

  describe("getAiInstructions", () => {
    it("returns null fields for a new org", async () => {
      const instructionsRow = {
        aiInstructionsWorking: null,
        aiInstructionsSpec: null,
        aiInstructionsArchitecture: null,
        aiInstructionsDebug: null,
        aiInstructionsRepo: null,
      };

      // lookupUserId (protectedProcedure)
      resultQueue.push([{ id: USER_ID, sub: "user123", role: "user", roleId: null }]);
      // requireOrgMember is mocked
      // select system instructions from org
      resultQueue.push([instructionsRow]);

      const caller = createCaller(true);
      const result = await caller.organization.getAiInstructions({ orgId: ORG_ID });

      expect(result).toEqual(instructionsRow);
      expect(result.aiInstructionsWorking).toBeNull();
      expect(result.aiInstructionsSpec).toBeNull();
      expect(result.aiInstructionsArchitecture).toBeNull();
      expect(result.aiInstructionsDebug).toBeNull();
      expect(result.aiInstructionsRepo).toBeNull();
    });

    it("requires org membership (FORBIDDEN for non-members)", async () => {
      const { TRPCError } = await import("@trpc/server");
      vi.mocked(requireOrgMember).mockRejectedValueOnce(
        new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this organization" }),
      );

      // lookupUserId
      resultQueue.push([{ id: USER_ID, sub: "user123", role: "user", roleId: null }]);

      const caller = createCaller(true);
      await expect(
        caller.organization.getAiInstructions({ orgId: ORG_ID }),
      ).rejects.toThrow("You are not a member of this organization");
    });

    it("requires auth", async () => {
      const caller = createCaller(false);
      await expect(
        caller.organization.getAiInstructions({ orgId: ORG_ID }),
      ).rejects.toThrow("UNAUTHORIZED");
    });
  });

  // --- setAiInstructions ---

  describe("setAiInstructions", () => {
    const mockAdminUser = {
      id: USER_ID,
      sub: "user123",
      email: "test@example.com",
      name: "Test User",
      role: "admin",
      roleId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockMemberUser = {
      ...mockAdminUser,
      role: "user",
      roleId: "role-123",
    };

    it("saves and returns updated value", async () => {
      const updatedOrg = { ...mockOrg, aiInstructionsWorking: "Be concise." };

      // lookupUserId (protectedProcedure) — admin role bypasses permission check
      resultQueue.push([mockAdminUser]);
      // requireOrgMember is mocked (returns owner)
      // update().set().where().returning()
      mockDb.returning.mockResolvedValueOnce([updatedOrg]);

      const caller = createCaller(true);
      const result = await caller.organization.setAiInstructions({
        orgId: ORG_ID,
        sessionType: "working",
        instructions: "Be concise.",
      });

      expect(result).toEqual(updatedOrg);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalled();
    });

    it("rejects non-admin members (FORBIDDEN)", async () => {
      const { TRPCError } = await import("@trpc/server");
      vi.mocked(requireOrgMember).mockRejectedValueOnce(
        new TRPCError({ code: "FORBIDDEN", message: "Requires at least admin role in this organization" }),
      );

      // lookupUserId — admin role bypasses requirePermission
      resultQueue.push([mockAdminUser]);

      const caller = createCaller(true);
      await expect(
        caller.organization.setAiInstructions({
          orgId: ORG_ID,
          sessionType: "working",
          instructions: "test",
        }),
      ).rejects.toThrow("Requires at least admin role");
    });

    it("rejects strings over 10,000 chars (BAD_REQUEST via Zod)", async () => {
      // lookupUserId — admin bypasses permission
      resultQueue.push([mockAdminUser]);

      const caller = createCaller(true);
      await expect(
        caller.organization.setAiInstructions({
          orgId: ORG_ID,
          sessionType: "working",
          instructions: "x".repeat(10_001),
        }),
      ).rejects.toThrow();
    });

    it("null instructions clears the field", async () => {
      const updatedOrg = { ...mockOrg, aiInstructionsWorking: null };

      // lookupUserId — admin bypasses permission
      resultQueue.push([mockAdminUser]);
      // requireOrgMember is mocked
      // update().set().where().returning()
      mockDb.returning.mockResolvedValueOnce([updatedOrg]);

      const caller = createCaller(true);
      const result = await caller.organization.setAiInstructions({
        orgId: ORG_ID,
        sessionType: "working",
        instructions: null,
      });

      expect(result).toEqual(updatedOrg);
      expect(result.aiInstructionsWorking).toBeNull();
    });

    it("publishes sync event on update", async () => {
      const updatedOrg = { ...mockOrg, aiInstructionsSpec: "Use TypeScript." };

      // lookupUserId — admin bypasses permission
      resultQueue.push([mockAdminUser]);
      // requireOrgMember is mocked
      // update().set().where().returning()
      mockDb.returning.mockResolvedValueOnce([updatedOrg]);

      const caller = createCaller(true);
      await caller.organization.setAiInstructions({
        orgId: ORG_ID,
        sessionType: "spec",
        instructions: "Use TypeScript.",
      });

      expect(mockPubsub.publish).toHaveBeenCalledWith(
        "sync:organization",
        expect.objectContaining({ action: "updated", data: updatedOrg }),
      );
    });

    it("requires auth", async () => {
      const caller = createCaller(false);
      await expect(
        caller.organization.setAiInstructions({
          orgId: ORG_ID,
          sessionType: "working",
          instructions: "test",
        }),
      ).rejects.toThrow("UNAUTHORIZED");
    });
  });

  // --- getMemberWorker ---

  describe("getMemberWorker", () => {
    it("returns worker details when assignment exists", async () => {
      const assignment = {
        workerId: WORKER_ID,
        workerName: "My Local Worker",
        workerStatus: "online",
      };

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // requireOrgMember is mocked
      // select assignment with join: select().from().leftJoin().where().limit(1)
      resultQueue.push([assignment]);

      const caller = createCaller(true);
      const result = await caller.organization.getMemberWorker({ orgId: ORG_ID });

      expect(result).toEqual(assignment);
      expect(result!.workerId).toBe(WORKER_ID);
      expect(result!.workerName).toBe("My Local Worker");
      expect(result!.workerStatus).toBe("online");
    });

    it("returns null when no assignment exists", async () => {
      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // requireOrgMember is mocked
      // select assignment: empty result
      resultQueue.push([]);

      const caller = createCaller(true);
      const result = await caller.organization.getMemberWorker({ orgId: ORG_ID });

      expect(result).toBeNull();
    });

    it("rejects non-member users", async () => {
      const { TRPCError } = await import("@trpc/server");
      vi.mocked(requireOrgMember).mockRejectedValueOnce(
        new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this organization" }),
      );

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);

      const caller = createCaller(true);
      await expect(
        caller.organization.getMemberWorker({ orgId: ORG_ID }),
      ).rejects.toThrow("You are not a member of this organization");
    });

    it("requires auth", async () => {
      const caller = createCaller(false);
      await expect(
        caller.organization.getMemberWorker({ orgId: ORG_ID }),
      ).rejects.toThrow("UNAUTHORIZED");
    });
  });

  // --- getAiInstructions ---

  describe("getAiInstructions", () => {
    it("returns all instruction fields for an org", async () => {
      const orgInstructions = {
        aiInstructionsWorking: "working instructions",
        aiInstructionsSpec: null,
        aiInstructionsArchitecture: "arch instructions",
        aiInstructionsDebug: null,
        aiInstructionsRepo: "repo instructions",
      };

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // requireOrgMember is mocked
      // select AI instructions
      resultQueue.push([orgInstructions]);

      const caller = createCaller(true);
      const result = await caller.organization.getAiInstructions({ orgId: ORG_ID });

      expect(result).toEqual(orgInstructions);
    });

    it("returns null fields for org without instructions", async () => {
      const orgInstructions = {
        aiInstructionsWorking: null,
        aiInstructionsSpec: null,
        aiInstructionsArchitecture: null,
        aiInstructionsDebug: null,
        aiInstructionsRepo: null,
      };

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // select AI instructions
      resultQueue.push([orgInstructions]);

      const caller = createCaller(true);
      const result = await caller.organization.getAiInstructions({ orgId: ORG_ID });

      expect(result).toEqual(orgInstructions);
    });

    it("throws NOT_FOUND for missing org", async () => {
      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // select AI instructions — empty (no org)
      resultQueue.push([]);

      const caller = createCaller(true);
      await expect(
        caller.organization.getAiInstructions({ orgId: ORG_ID }),
      ).rejects.toThrow("Organization not found");
    });

    it("rejects non-admin members", async () => {
      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // requireOrgMember throws FORBIDDEN
      vi.mocked(requireOrgMember).mockRejectedValueOnce(
        new Error("Insufficient role"),
      );

      const caller = createCaller(true);
      await expect(
        caller.organization.getAiInstructions({ orgId: ORG_ID }),
      ).rejects.toThrow();
    });
  });

  // --- setAiInstructions ---

  describe("setAiInstructions", () => {
    it("saves instructions and returns updated org", async () => {
      const updatedOrg = {
        ...mockOrg,
        aiInstructionsWorking: "new instructions",
      };

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // requireOrgMember is mocked
      // update().set().where().returning()
      mockDb.returning.mockResolvedValueOnce([updatedOrg]);

      const caller = createCaller(true);
      const result = await caller.organization.setAiInstructions({
        orgId: ORG_ID,
        sessionType: "working",
        instructions: "new instructions",
      });

      expect(result).toEqual(updatedOrg);
      expect(mockPubsub.publish).toHaveBeenCalledWith(
        "sync:organization",
        expect.objectContaining({ action: "updated" }),
      );
    });

    it("clears instructions with null", async () => {
      const updatedOrg = {
        ...mockOrg,
        aiInstructionsSpec: null,
      };

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // update().set().where().returning()
      mockDb.returning.mockResolvedValueOnce([updatedOrg]);

      const caller = createCaller(true);
      const result = await caller.organization.setAiInstructions({
        orgId: ORG_ID,
        sessionType: "spec",
        instructions: null,
      });

      expect(result).toEqual(updatedOrg);
    });

    it("rejects non-admin members", async () => {
      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      vi.mocked(requireOrgMember).mockRejectedValueOnce(
        new Error("Insufficient role"),
      );

      const caller = createCaller(true);
      await expect(
        caller.organization.setAiInstructions({
          orgId: ORG_ID,
          sessionType: "working",
          instructions: "test",
        }),
      ).rejects.toThrow();
    });

    it("publishes sync event on update", async () => {
      const updatedOrg = { ...mockOrg, aiInstructionsDebug: "debug instructions" };

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      mockDb.returning.mockResolvedValueOnce([updatedOrg]);

      const caller = createCaller(true);
      await caller.organization.setAiInstructions({
        orgId: ORG_ID,
        sessionType: "debug",
        instructions: "debug instructions",
      });

      expect(mockPubsub.publish).toHaveBeenCalledWith(
        "sync:organization",
        expect.objectContaining({
          action: "updated",
          data: updatedOrg,
        }),
      );
    });
  });

  // --- getSystemInstructions ---

  describe("getSystemInstructions", () => {
    it("returns null fields for a new org", async () => {
      const instructionsRow = {
        systemInstructionsWorking: null,
        systemInstructionsSpec: null,
        systemInstructionsArchitecture: null,
        systemInstructionsDebug: null,
        systemInstructionsRepo: null,
      };

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // requireOrgMember is mocked
      // select system instructions from org
      resultQueue.push([instructionsRow]);

      const caller = createCaller(true);
      const result = await caller.organization.getSystemInstructions({ orgId: ORG_ID });

      expect(result.instructions).toEqual({
        working: null,
        spec: null,
        architecture: null,
        debug: null,
        repo: null,
      });
      expect(result.defaults).toEqual({
        spec: "skill-spec-content",
        architecture: "skill-architecture-content",
        debug: "skill-debug-content",
        working: "skill-working-content",
        repo: "skill-repo-content",
      });
    });

    it("requires org membership (FORBIDDEN for non-members)", async () => {
      const { TRPCError } = await import("@trpc/server");
      vi.mocked(requireOrgMember).mockRejectedValueOnce(
        new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this organization" }),
      );

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);

      const caller = createCaller(true);
      await expect(
        caller.organization.getSystemInstructions({ orgId: ORG_ID }),
      ).rejects.toThrow("You are not a member of this organization");
    });

    it("requires auth", async () => {
      const caller = createCaller(false);
      await expect(
        caller.organization.getSystemInstructions({ orgId: ORG_ID }),
      ).rejects.toThrow("UNAUTHORIZED");
    });

    it("throws NOT_FOUND for missing org", async () => {
      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // select system instructions — empty (no org)
      resultQueue.push([]);

      const caller = createCaller(true);
      await expect(
        caller.organization.getSystemInstructions({ orgId: ORG_ID }),
      ).rejects.toThrow("Organization not found");
    });
  });

  // --- setSystemInstructions ---

  describe("setSystemInstructions", () => {
    it("updates a single session type column", async () => {
      const updatedOrg = { ...mockOrg, systemInstructionsWorking: "Custom system prompt." };

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // requireOrgMember is mocked
      // update().set().where().returning()
      mockDb.returning.mockResolvedValueOnce([updatedOrg]);

      const caller = createCaller(true);
      const result = await caller.organization.setSystemInstructions({
        orgId: ORG_ID,
        sessionType: "working",
        instructions: "Custom system prompt.",
      });

      expect(result).toEqual(updatedOrg);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalled();
      expect(mockPubsub.publish).toHaveBeenCalledWith(
        "sync:organization",
        expect.objectContaining({ action: "updated", data: updatedOrg }),
      );
    });

    it("requires admin role", async () => {
      const { TRPCError } = await import("@trpc/server");
      vi.mocked(requireOrgMember).mockRejectedValueOnce(
        new TRPCError({ code: "FORBIDDEN", message: "Requires at least admin role in this organization" }),
      );

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);

      const caller = createCaller(true);
      await expect(
        caller.organization.setSystemInstructions({
          orgId: ORG_ID,
          sessionType: "working",
          instructions: "test",
        }),
      ).rejects.toThrow("Requires at least admin role");
    });

    it("requires auth", async () => {
      const caller = createCaller(false);
      await expect(
        caller.organization.setSystemInstructions({
          orgId: ORG_ID,
          sessionType: "working",
          instructions: "test",
        }),
      ).rejects.toThrow("UNAUTHORIZED");
    });

    it("clears instructions with null", async () => {
      const updatedOrg = { ...mockOrg, systemInstructionsSpec: null };

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      // update().set().where().returning()
      mockDb.returning.mockResolvedValueOnce([updatedOrg]);

      const caller = createCaller(true);
      const result = await caller.organization.setSystemInstructions({
        orgId: ORG_ID,
        sessionType: "spec",
        instructions: null,
      });

      expect(result).toEqual(updatedOrg);
    });

    it("publishes sync event on update", async () => {
      const updatedOrg = { ...mockOrg, systemInstructionsDebug: "debug system prompt" };

      // lookupUserId
      resultQueue.push([{ id: USER_ID }]);
      mockDb.returning.mockResolvedValueOnce([updatedOrg]);

      const caller = createCaller(true);
      await caller.organization.setSystemInstructions({
        orgId: ORG_ID,
        sessionType: "debug",
        instructions: "debug system prompt",
      });

      expect(mockPubsub.publish).toHaveBeenCalledWith(
        "sync:organization",
        expect.objectContaining({
          action: "updated",
          data: updatedOrg,
        }),
      );
    });
  });

  // --- addMember ---

  describe("addMember", () => {
    const TARGET_USER_ID = "cc0e8400-e29b-41d4-a716-446655440030";
    const adminUser = { id: USER_ID, sub: "user123", email: "test@example.com", name: "Test User", role: "admin", roleId: null, createdAt: new Date(), updatedAt: new Date() };

    it("existing user → status: joined, notification sent", async () => {
      // lookupUserId (requirePermission needs role: "admin" for bypass)
      resultQueue.push([adminUser]);
      // requireOrgMember is mocked
      // org name lookup
      resultQueue.push([{ name: "Test Org" }]);
      // find user by email
      resultQueue.push([{ id: TARGET_USER_ID, email: "member@example.com" }]);
      // check if already a member — not found
      resultQueue.push([]);
      // insert orgMembers (values chain, no limit)
      // sendNotification is mocked

      const caller = createCaller(true);
      const result = await caller.organization.addMember({
        orgId: ORG_ID,
        email: "member@example.com",
      });

      expect(result).toEqual({ success: true, userId: TARGET_USER_ID, status: "joined" });
      expect(vi.mocked(sendNotification)).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { userId: TARGET_USER_ID },
        expect.objectContaining({
          title: "Added to Test Org",
          body: "You have been added to Test Org.",
          actionUrl: `/orgs/${ORG_ID}`,
        }),
      );
      expect(mockPubsub.publish).toHaveBeenCalledWith(
        "sync:organization",
        expect.objectContaining({ action: "updated" }),
      );
    });

    it("new user → status: invited, invitation created, job enqueued", async () => {
      const INVITATION_ID = "dd0e8400-e29b-41d4-a716-446655440040";

      // lookupUserId (requirePermission needs role: "admin" for bypass)
      resultQueue.push([adminUser]);
      // requireOrgMember is mocked
      // org name lookup
      resultQueue.push([{ name: "Test Org" }]);
      // find user by email — not found
      resultQueue.push([]);
      // check for existing pending invitation — not found
      resultQueue.push([]);
      // insert orgInvitations returning
      mockDb.returning.mockResolvedValueOnce([{ id: INVITATION_ID }]);

      const caller = createCaller(true);
      const result = await caller.organization.addMember({
        orgId: ORG_ID,
        email: "newuser@example.com",
      });

      expect(result).toEqual({ success: true, status: "invited" });
      expect(mockDb.insert).toHaveBeenCalled();
      expect(vi.mocked(enqueueJob)).toHaveBeenCalledWith(
        "process-org-invitation",
        { invitationId: INVITATION_ID },
        { retryLimit: 3, retryDelay: 60 },
      );
    });

    it("duplicate pending invitation → CONFLICT", async () => {
      // lookupUserId (requirePermission needs role: "admin" for bypass)
      resultQueue.push([adminUser]);
      // requireOrgMember is mocked
      // org name lookup
      resultQueue.push([{ name: "Test Org" }]);
      // find user by email — not found
      resultQueue.push([]);
      // check for existing pending invitation — found
      resultQueue.push([{ id: "existing-invite", status: "pending" }]);

      const caller = createCaller(true);
      await expect(
        caller.organization.addMember({
          orgId: ORG_ID,
          email: "pending@example.com",
        }),
      ).rejects.toThrow("A pending invitation already exists for this email");
    });

    it("existing user already a member → CONFLICT", async () => {
      // lookupUserId (requirePermission needs role: "admin" for bypass)
      resultQueue.push([adminUser]);
      // requireOrgMember is mocked
      // org name lookup
      resultQueue.push([{ name: "Test Org" }]);
      // find user by email
      resultQueue.push([{ id: TARGET_USER_ID, email: "member@example.com" }]);
      // check if already a member — found
      resultQueue.push([{ orgId: ORG_ID, userId: TARGET_USER_ID, role: "member" }]);

      const caller = createCaller(true);
      await expect(
        caller.organization.addMember({
          orgId: ORG_ID,
          email: "member@example.com",
        }),
      ).rejects.toThrow("User is already a member of this organization");
    });

    it("requires auth", async () => {
      const caller = createCaller(false);
      await expect(
        caller.organization.addMember({
          orgId: ORG_ID,
          email: "test@example.com",
        }),
      ).rejects.toThrow("UNAUTHORIZED");
    });
  });
});
