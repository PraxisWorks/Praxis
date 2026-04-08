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

vi.mock("../lib/requireAccessibleRepo.js", () => ({
  requireAccessibleRepo: vi.fn().mockResolvedValue({
    id: "770e8400-e29b-41d4-a716-446655440002",
    orgId: "mock-org",
    name: "Test Repo",
    bdPrefix: "TR",
    color: "#6366f1",
    status: "active",
  }),
}));

vi.mock("../lib/orgSyncFilter.js", () => ({
  getUserOrgIds: vi.fn().mockResolvedValue(new Set(["mock-org"])),
  shouldForwardOrgEvent: vi.fn().mockReturnValue(true),
}));

import { appRouter } from "./index.js";
import { requireAccessibleRepo } from "../lib/requireAccessibleRepo.js";
import { requireOrgMember } from "../lib/requireOrgMember.js";

describe("planRouter", () => {
  const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
  const IDEA_ID = "660e8400-e29b-41d4-a716-446655440001";
  const REPO_ID = "770e8400-e29b-41d4-a716-446655440002";
  const SESSION_ID = "880e8400-e29b-41d4-a716-446655440003";
  const PLAN_ID = "990e8400-e29b-41d4-a716-446655440004";

  const validProposal = {
    epics: [{
      key: "e1",
      title: "Backend",
      description: "Server-side work",
      tasks: [
        { key: "b1", title: "Schema", description: "DB schema", priority: "high" as const },
        { key: "b2", title: "Router", description: "API router", priority: "medium" as const, dependsOn: ["b1"] },
      ],
    }],
  };

  const mockPlan = {
    id: PLAN_ID,
    ideaId: IDEA_ID,
    repoId: REPO_ID,
    sessionId: SESSION_ID,
    proposal: validProposal,
    status: "draft",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockRepo = {
    id: REPO_ID,
    userId: USER_ID,
    name: "Test Repo",
    bdPrefix: "TR",
    color: "#6366f1",
    status: "active",
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
    delete: vi.fn().mockReturnThis(),
    transaction: vi.fn(async (fn: any) => fn(mockDb)),
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
    mockDb.delete.mockReturnThis();
    mockDb.transaction.mockImplementation(async (fn: any) => fn(mockDb));
  });

  // --- getByIdea ---

  it("getByIdea returns plan for idea", async () => {
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]); // lookupUserId
    resultQueue.push([{ id: IDEA_ID, userId: USER_ID }]); // idea ownership check
    resultQueue.push([mockPlan]);         // plan query

    const caller = createCaller(true);
    const result = await caller.plan.getByIdea({ ideaId: IDEA_ID });
    expect(result).toEqual(mockPlan);
  });

  it("getByIdea returns null when no plan exists", async () => {
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    resultQueue.push([{ id: IDEA_ID, userId: USER_ID }]); // idea ownership check
    resultQueue.push([]);

    const caller = createCaller(true);
    const result = await caller.plan.getByIdea({ ideaId: IDEA_ID });
    expect(result).toBeNull();
  });

  it("getByIdea rejects when user does not own idea", async () => {
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]); // lookupUserId
    resultQueue.push([]);                 // idea not found (ownership check fails)

    const caller = createCaller(true);
    await expect(caller.plan.getByIdea({ ideaId: IDEA_ID })).rejects.toThrow("Idea not found");
  });

  it("getByIdea requires auth", async () => {
    const caller = createCaller(false);
    await expect(caller.plan.getByIdea({ ideaId: IDEA_ID })).rejects.toThrow("UNAUTHORIZED");
  });

  it("getByIdea throws FORBIDDEN when user lacks plan:read permission", async () => {
    // lookupUserId — non-admin user
    resultQueue.push([{ id: USER_ID, role: "user", roleId: null }]);

    // resolveUserPermissions runs select().from(userPermissionOverrides).where()
    // This is a terminal where() call. Use where.mockImplementation with a counter.
    let whereCallCount = 0;
    mockDb.where.mockImplementation(() => {
      whereCallCount++;
      if (whereCallCount <= 1) return mockDb; // lookupUserId chains to .limit()
      // resolveUserPermissions overrides query (terminal where)
      return Promise.resolve([]); // no overrides → no permissions → FORBIDDEN
    });

    const caller = createCaller(true);
    await expect(
      caller.plan.getByIdea({ ideaId: IDEA_ID }),
    ).rejects.toThrow("Missing permissions: plan:read");
  });

  // --- create ---

  it("create inserts draft plan and publishes sync", async () => {
    resultQueue.push([{ id: USER_ID }]); // lookupUserId
    resultQueue.push([{ id: IDEA_ID, repoId: REPO_ID }]); // idea exists
    // requireAccessibleRepo is mocked (called twice: for idea.repoId and input.repoId)
    resultQueue.push([]);                 // no existing plan
    mockDb.returning.mockResolvedValueOnce([mockPlan]);

    const caller = createCaller(true);
    const result = await caller.plan.create({
      ideaId: IDEA_ID,
      repoId: REPO_ID,
      sessionId: SESSION_ID,
      proposal: validProposal,
    });

    expect(result).toEqual(mockPlan);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      expect.stringContaining("plan"),
      expect.objectContaining({ action: "created" }),
    );
  });

  it("create rejects when idea not found", async () => {
    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.plan.create({
        ideaId: IDEA_ID,
        repoId: REPO_ID,
        sessionId: SESSION_ID,
        proposal: validProposal,
      }),
    ).rejects.toThrow("Idea not found");
  });

  it("create rejects when plan already exists for idea", async () => {
    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([{ id: IDEA_ID, repoId: REPO_ID }]); // idea exists
    // requireAccessibleRepo is mocked
    resultQueue.push([mockPlan]);         // existing plan found

    const caller = createCaller(true);
    await expect(
      caller.plan.create({
        ideaId: IDEA_ID,
        repoId: REPO_ID,
        sessionId: SESSION_ID,
        proposal: validProposal,
      }),
    ).rejects.toThrow("A plan already exists for this idea");
  });

  it("create rejects when user does not have repo access", async () => {
    const { TRPCError } = await import("@trpc/server");
    // Make requireAccessibleRepo reject on the second call (input.repoId check)
    vi.mocked(requireAccessibleRepo)
      .mockResolvedValueOnce({ id: REPO_ID } as any) // first call for idea.repoId passes
      .mockRejectedValueOnce(new TRPCError({ code: "NOT_FOUND", message: "Repo not found" }));

    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([{ id: IDEA_ID, repoId: REPO_ID }]); // idea exists

    const caller = createCaller(true);
    await expect(
      caller.plan.create({
        ideaId: IDEA_ID,
        repoId: REPO_ID,
        sessionId: SESSION_ID,
        proposal: validProposal,
      }),
    ).rejects.toThrow("Repo not found");
  });

  it("create requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.plan.create({
        ideaId: IDEA_ID,
        repoId: REPO_ID,
        sessionId: SESSION_ID,
        proposal: validProposal,
      }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // --- updateProposal ---

  it("updateProposal updates proposal on draft plan", async () => {
    const updatedPlan = { ...mockPlan, proposal: validProposal };
    resultQueue.push([{ id: USER_ID }]); // lookupUserId
    resultQueue.push([mockPlan]);         // existing plan
    // requireAccessibleRepo is mocked
    mockDb.returning.mockResolvedValueOnce([updatedPlan]);

    const caller = createCaller(true);
    const result = await caller.plan.updateProposal({
      id: PLAN_ID,
      proposal: validProposal,
    });

    expect(result).toEqual(updatedPlan);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      expect.stringContaining("plan"),
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("updateProposal rejects non-draft plan", async () => {
    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([{ ...mockPlan, status: "accepted" }]);
    // requireAccessibleRepo is mocked

    const caller = createCaller(true);
    await expect(
      caller.plan.updateProposal({ id: PLAN_ID, proposal: validProposal }),
    ).rejects.toThrow("Can only edit draft plans");
  });

  it("updateProposal rejects missing plan", async () => {
    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.plan.updateProposal({ id: PLAN_ID, proposal: validProposal }),
    ).rejects.toThrow("Plan not found");
  });

  it("updateProposal rejects when user does not have repo access", async () => {
    const { TRPCError } = await import("@trpc/server");
    vi.mocked(requireAccessibleRepo).mockRejectedValueOnce(
      new TRPCError({ code: "NOT_FOUND", message: "Repo not found" }),
    );

    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([mockPlan]);         // existing plan

    const caller = createCaller(true);
    await expect(
      caller.plan.updateProposal({ id: PLAN_ID, proposal: validProposal }),
    ).rejects.toThrow("Repo not found");
  });

  it("updateProposal requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.plan.updateProposal({ id: PLAN_ID, proposal: validProposal }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // --- reject ---

  it("reject sets status to rejected", async () => {
    const rejectedPlan = { ...mockPlan, status: "rejected" };
    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([mockPlan]);
    // requireAccessibleRepo is mocked
    mockDb.returning.mockResolvedValueOnce([rejectedPlan]);

    const caller = createCaller(true);
    const result = await caller.plan.reject({ id: PLAN_ID });

    expect(result.status).toBe("rejected");
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      expect.stringContaining("plan"),
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("reject fails on non-draft plan", async () => {
    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([{ ...mockPlan, status: "accepted" }]);
    // requireAccessibleRepo is mocked

    const caller = createCaller(true);
    await expect(caller.plan.reject({ id: PLAN_ID })).rejects.toThrow("Can only reject draft plans");
  });

  it("reject rejects when user does not have repo access", async () => {
    const { TRPCError } = await import("@trpc/server");
    vi.mocked(requireAccessibleRepo).mockRejectedValueOnce(
      new TRPCError({ code: "NOT_FOUND", message: "Repo not found" }),
    );

    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([mockPlan]);

    const caller = createCaller(true);
    await expect(caller.plan.reject({ id: PLAN_ID })).rejects.toThrow("Repo not found");
  });

  it("reject requires auth", async () => {
    const caller = createCaller(false);
    await expect(caller.plan.reject({ id: PLAN_ID })).rejects.toThrow("UNAUTHORIZED");
  });

  // --- accept ---

  it("accept creates epics and tasks in a transaction", async () => {
    resultQueue.push([{ id: USER_ID }]); // lookupUserId
    resultQueue.push([mockPlan]);         // plan query
    resultQueue.push([mockRepo]);          // repo query
    resultQueue.push([{ id: IDEA_ID, title: "Test Idea", description: "A test idea" }]); // idea query

    // Inside transaction: insert returns for parent epic, epic, task1, task2, then
    // update plan returning, then update idea (no returning needed from set().where())
    let insertCount = 0;
    mockDb.returning.mockImplementation(() => {
      insertCount++;
      return Promise.resolve([{
        id: `task-${insertCount}`,
        repoId: REPO_ID,
        title: `Created ${insertCount}`,
        status: insertCount <= 4 ? "draft" : "accepted",
      }]);
    });

    const caller = createCaller(true);
    // Verify transaction is called and method resolves without error
    await expect(caller.plan.accept({ id: PLAN_ID })).resolves.toBeDefined();
    expect(mockDb.transaction).toHaveBeenCalled();
  });

  it("accept fails on non-draft plan", async () => {
    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([{ ...mockPlan, status: "accepted" }]);

    const caller = createCaller(true);
    await expect(caller.plan.accept({ id: PLAN_ID })).rejects.toThrow("Can only accept draft plans");
  });

  it("accept fails when plan not found", async () => {
    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(caller.plan.accept({ id: PLAN_ID })).rejects.toThrow("Plan not found");
  });

  it("accept fails when repo not found", async () => {
    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([mockPlan]);
    resultQueue.push([]);  // repo not found

    const caller = createCaller(true);
    await expect(caller.plan.accept({ id: PLAN_ID })).rejects.toThrow("Repo not found");
  });

  it("accept fails when user is not org member", async () => {
    const { TRPCError } = await import("@trpc/server");
    vi.mocked(requireOrgMember).mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this organization" }),
    );

    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([mockPlan]);
    resultQueue.push([mockRepo]);

    const caller = createCaller(true);
    await expect(caller.plan.accept({ id: PLAN_ID })).rejects.toThrow("You are not a member of this organization");
  });

  it("accept requires auth", async () => {
    const caller = createCaller(false);
    await expect(caller.plan.accept({ id: PLAN_ID })).rejects.toThrow("UNAUTHORIZED");
  });

  // --- accept: session auto-complete ---

  it("accept auto-completes the architecture session", async () => {
    const { enqueueJob } = await import("../jobs/index.js");

    resultQueue.push([{ id: USER_ID }]); // lookupUserId
    resultQueue.push([mockPlan]);         // plan query
    resultQueue.push([mockRepo]);          // repo query
    resultQueue.push([{ id: IDEA_ID, title: "Test Idea", description: "A test idea" }]); // idea query

    let insertCount = 0;
    mockDb.returning.mockImplementation(() => {
      insertCount++;
      return Promise.resolve([{
        id: `task-${insertCount}`,
        repoId: REPO_ID,
        title: `Created ${insertCount}`,
        status: insertCount <= 4 ? "draft" : "accepted",
      }]);
    });

    const caller = createCaller(true);
    await caller.plan.accept({ id: PLAN_ID });

    // Verify session was updated to completed
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed" }),
    );

    // Verify session sync event was published
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      expect.stringContaining("session"),
      expect.objectContaining({
        action: "updated",
        data: expect.objectContaining({ id: SESSION_ID, status: "completed" }),
      }),
    );

    // Verify SESSION_STOP job was enqueued
    expect(enqueueJob).toHaveBeenCalledWith("session.stop", { sessionId: SESSION_ID });
  });

  it("accept succeeds even if session auto-complete fails", async () => {
    const { enqueueJob } = await import("../jobs/index.js");
    vi.mocked(enqueueJob).mockRejectedValueOnce(new Error("Queue unavailable"));

    resultQueue.push([{ id: USER_ID }]); // lookupUserId
    resultQueue.push([mockPlan]);         // plan query
    resultQueue.push([mockRepo]);          // repo query
    resultQueue.push([{ id: IDEA_ID, title: "Test Idea", description: "A test idea" }]); // idea query

    let insertCount = 0;
    mockDb.returning.mockImplementation(() => {
      insertCount++;
      return Promise.resolve([{
        id: `task-${insertCount}`,
        repoId: REPO_ID,
        title: `Created ${insertCount}`,
        status: insertCount <= 4 ? "draft" : "accepted",
      }]);
    });

    const caller = createCaller(true);
    // Should still succeed despite enqueueJob failure
    await expect(caller.plan.accept({ id: PLAN_ID })).resolves.toBeDefined();
  });
});
