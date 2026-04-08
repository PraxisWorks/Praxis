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
  cancelJob: vi.fn().mockResolvedValue(undefined),
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
  getUserOrgIds: vi.fn().mockResolvedValue(new Set([
    "mock-org",
    "aa0e8400-e29b-41d4-a716-446655440001",
    "bb0e8400-e29b-41d4-a716-446655440002",
  ])),
  shouldForwardOrgEvent: vi.fn().mockReturnValue(true),
}));

import { appRouter } from "./index.js";
import { requireAccessibleRepo } from "../lib/requireAccessibleRepo.js";

describe("sessionRouter", () => {
  const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
  const REPO_ID = "660e8400-e29b-41d4-a716-446655440001";
  const SESSION_ID = "770e8400-e29b-41d4-a716-446655440002";
  const MESSAGE_ID = "880e8400-e29b-41d4-a716-446655440003";

  const mockRepo = {
    id: REPO_ID,
    userId: USER_ID,
    name: "Test Repo",
    status: "active",
  };

  const mockSession = {
    id: SESSION_ID,
    repoId: REPO_ID,
    userId: USER_ID,
    type: "spec",
    entityType: null,
    entityId: null,
    title: "Spec Session",
    prompt: null,
    status: "active",
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockMessage = {
    id: MESSAGE_ID,
    sessionId: SESSION_ID,
    role: "user",
    content: "Hello",
    createdAt: new Date(),
  };

  const mockPubsub = {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    close: vi.fn(),
  };

  let resultQueue: unknown[];
  // Queue specifically for orderBy-terminal calls (e.g. getById messages).
  // The list query now uses orderBy -> limit, so orderBy returns `this`.
  let orderByQueue: unknown[];

  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    // orderBy returns `this` to allow .limit() chaining.
    // For queries where orderBy is terminal (awaited directly), we use
    // a `.then()` on the mockDb so the await resolves from orderByQueue.
    orderBy: vi.fn(function (this: any) { return this; }),
    limit: vi.fn(() => {
      const result = resultQueue.shift();
      return Promise.resolve(result ?? []);
    }),
    // Make mockDb thenable so `await db.select().from().orderBy()` works.
    // This is used when orderBy is the terminal call (e.g. messages query).
    then: vi.fn((resolve: any) => {
      const result = orderByQueue.shift();
      return Promise.resolve(result ?? []).then(resolve);
    }),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    as: vi.fn().mockReturnValue("subquery"),
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
    mockDb.innerJoin.mockReturnThis();
    mockDb.leftJoin.mockReturnThis();
    mockDb.groupBy.mockReturnThis();
    mockDb.as.mockReturnValue("subquery");
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValue([]);
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
  });

  // --- getByEntity ---

  it("getByEntity throws FORBIDDEN when user lacks session:read permission", async () => {
    // lookupUserId — non-admin user
    resultQueue.push([{ id: USER_ID, role: "user", roleId: null }]);
    // resolveUserPermissions: terminal where → pulled from orderByQueue
    orderByQueue.push([]); // no overrides → no permissions → FORBIDDEN

    const caller = createCaller(true);
    await expect(
      caller.session.getByEntity({ entityType: "idea", entityId: SESSION_ID }),
    ).rejects.toThrow("Missing permissions: session:read");
  });

  // --- list ---

  // The enriched list query chains:
  //   select -> from -> leftJoin -> leftJoin -> where -> orderBy -> limit
  // Terminal call is limit (returns the result).

  const mockEnrichedSession = {
    ...mockSession,
    repoColor: "#6366f1",
    repoName: "Test Repo",
    repoIcon: null,
    orgId: "mock-org",
    orgName: "Mock Organization",
    lastMessageAt: new Date("2026-02-26T10:00:00Z"),
    lastMessageContent: null as string | null,
    lastMessageRole: null as string | null,
    taskTotal: null as number | null,
    taskCompleted: null as number | null,
    taskInProgress: null as number | null,
    phaseCompleted: null as number | null,
    latestPhaseName: null as string | null,
  };

  it("list returns enriched sessions for user", async () => {
    // lookupUserId — role: "admin" bypasses permission resolution
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // getUserOrgIds is mocked; orgRepos query (terminal where -> then)
    orderByQueue.push([{ id: REPO_ID }]);
    // list query (terminal is limit due to .limit(input.limit))
    resultQueue.push([mockEnrichedSession]);

    const caller = createCaller(true);
    const result = await caller.session.list({});
    expect(result).toEqual([mockEnrichedSession]);
    expect(result[0]).toHaveProperty("repoColor", "#6366f1");
    expect(result[0]).toHaveProperty("repoName", "Test Repo");
    expect(result[0]).toHaveProperty("repoIcon", null);
    expect(result[0]).toHaveProperty("lastMessageAt");
  });

  it("list filters by typeFilter", async () => {
    const debugSession = {
      ...mockEnrichedSession,
      type: "debug",
      title: "Debug Session",
    };
    // lookupUserId — role: "admin" bypasses permission resolution
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // orgRepos query (terminal where -> then)
    orderByQueue.push([{ id: REPO_ID }]);
    // list query returns only debug sessions
    resultQueue.push([debugSession]);

    const caller = createCaller(true);
    const result = await caller.session.list({ typeFilter: ["debug"] });
    expect(result).toEqual([debugSession]);
    expect(result[0].type).toBe("debug");
  });

  it("list filters by statusFilter", async () => {
    const activeSession = { ...mockEnrichedSession, status: "active" };
    // lookupUserId — role: "admin" bypasses permission resolution
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // orgRepos query (terminal where -> then)
    orderByQueue.push([{ id: REPO_ID }]);
    resultQueue.push([activeSession]);

    const caller = createCaller(true);
    const result = await caller.session.list({ statusFilter: ["active"] });
    expect(result).toEqual([activeSession]);
    expect(result[0].status).toBe("active");
  });

  it("list filters by type AND status simultaneously", async () => {
    const filteredSession = {
      ...mockEnrichedSession,
      type: "working",
      status: "paused",
    };
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // orgRepos query (terminal where -> then)
    orderByQueue.push([{ id: REPO_ID }]);
    resultQueue.push([filteredSession]);

    const caller = createCaller(true);
    const result = await caller.session.list({
      typeFilter: ["working"],
      statusFilter: ["paused"],
    });
    expect(result).toEqual([filteredSession]);
  });

  it("list includes repoColor and repoName from joined repo", async () => {
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // orgRepos query (terminal where -> then)
    orderByQueue.push([{ id: REPO_ID }]);
    resultQueue.push([mockEnrichedSession]);

    const caller = createCaller(true);
    const result = await caller.session.list({});
    expect(result[0].repoColor).toBe("#6366f1");
    expect(result[0].repoName).toBe("Test Repo");
  });

  it("list falls back lastMessageAt to createdAt when no messages", async () => {
    const sessionNoMessages = {
      ...mockEnrichedSession,
      lastMessageAt: null,
    };
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // orgRepos query (terminal where -> then)
    orderByQueue.push([{ id: REPO_ID }]);
    resultQueue.push([sessionNoMessages]);

    const caller = createCaller(true);
    const result = await caller.session.list({});
    // Should fall back to createdAt when lastMessageAt is null
    expect(result[0].lastMessageAt).toEqual(sessionNoMessages.createdAt);
  });

  it("list requires auth", async () => {
    const caller = createCaller(false);
    await expect(caller.session.list({})).rejects.toThrow("UNAUTHORIZED");
  });

  it("list throws FORBIDDEN when user lacks session:read permission", async () => {
    // lookupUserId — non-admin user
    resultQueue.push([{ id: USER_ID, role: "user", roleId: null }]);
    // resolveUserPermissions: terminal where → pulled from orderByQueue
    orderByQueue.push([]); // no overrides → no permissions → FORBIDDEN

    const caller = createCaller(true);
    await expect(caller.session.list({})).rejects.toThrow("Missing permissions: session:read");
  });

  // --- list orgIds filtering ---

  it("list returns orgId and orgName in response", async () => {
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    orderByQueue.push([{ id: REPO_ID }]);
    resultQueue.push([mockEnrichedSession]);

    const caller = createCaller(true);
    const result = await caller.session.list({});
    expect(result[0]).toHaveProperty("orgId", "mock-org");
    expect(result[0]).toHaveProperty("orgName", "Mock Organization");
  });

  it("list filters by orgIds when provided", async () => {
    const ORG_1 = "aa0e8400-e29b-41d4-a716-446655440001";
    const orgSession = { ...mockEnrichedSession, orgId: ORG_1, orgName: "Org One" };
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    orderByQueue.push([{ id: REPO_ID }]);
    resultQueue.push([orgSession]);

    const caller = createCaller(true);
    const result = await caller.session.list({ orgIds: [ORG_1] });
    expect(result).toEqual([orgSession]);
  });

  it("list filters by multiple orgIds", async () => {
    const ORG_1 = "aa0e8400-e29b-41d4-a716-446655440001";
    const ORG_2 = "bb0e8400-e29b-41d4-a716-446655440002";
    const session1 = { ...mockEnrichedSession, orgId: ORG_1, orgName: "Org One" };
    const session2 = { ...mockEnrichedSession, id: "990e8400-e29b-41d4-a716-446655440009", orgId: ORG_2, orgName: "Org Two" };
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    orderByQueue.push([{ id: REPO_ID }]);
    resultQueue.push([session1, session2]);

    const caller = createCaller(true);
    const result = await caller.session.list({ orgIds: [ORG_1, ORG_2] });
    expect(result).toHaveLength(2);
  });

  it("list with empty orgIds array returns all sessions (no filter applied)", async () => {
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    orderByQueue.push([{ id: REPO_ID }]);
    resultQueue.push([mockEnrichedSession]);

    const caller = createCaller(true);
    const result = await caller.session.list({ orgIds: [] });
    expect(result).toEqual([mockEnrichedSession]);
  });

  it("list with orgIds combined with typeFilter works", async () => {
    const ORG_1 = "aa0e8400-e29b-41d4-a716-446655440001";
    const debugSession = { ...mockEnrichedSession, type: "debug", orgId: ORG_1, orgName: "Org One" };
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    orderByQueue.push([{ id: REPO_ID }]);
    resultQueue.push([debugSession]);

    const caller = createCaller(true);
    const result = await caller.session.list({ orgIds: [ORG_1], typeFilter: ["debug"] });
    expect(result).toEqual([debugSession]);
    expect(result[0].type).toBe("debug");
  });

  it("list with orgIds for non-member org returns empty (security)", async () => {
    const NON_MEMBER_ORG = "cc0e8400-e29b-41d4-a716-446655440099";
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);

    const caller = createCaller(true);
    const result = await caller.session.list({ orgIds: [NON_MEMBER_ORG] });
    expect(result).toEqual([]);
  });

  // --- list lastMessageContent / lastMessageRole ---

  it("list returns lastMessageContent and lastMessageRole for session with assistant messages", async () => {
    const sessionWithMessage = {
      ...mockEnrichedSession,
      lastMessageContent: "Here is my analysis of the codebase...",
      lastMessageRole: "assistant",
    };
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    orderByQueue.push([{ id: REPO_ID }]);
    resultQueue.push([sessionWithMessage]);

    const caller = createCaller(true);
    const result = await caller.session.list({});
    expect(result[0]).toHaveProperty("lastMessageContent", "Here is my analysis of the codebase...");
    expect(result[0]).toHaveProperty("lastMessageRole", "assistant");
  });

  it("list returns null lastMessageContent and lastMessageRole when session has no messages", async () => {
    const sessionNoMessages = {
      ...mockEnrichedSession,
      lastMessageAt: null,
      lastMessageContent: null,
      lastMessageRole: null,
    };
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    orderByQueue.push([{ id: REPO_ID }]);
    resultQueue.push([sessionNoMessages]);

    const caller = createCaller(true);
    const result = await caller.session.list({});
    expect(result[0].lastMessageContent).toBeNull();
    expect(result[0].lastMessageRole).toBeNull();
    // lastMessageAt should fall back to createdAt
    expect(result[0].lastMessageAt).toEqual(sessionNoMessages.createdAt);
  });

  // --- list taskProgress fields ---

  it("list returns task progress for working sessions", async () => {
    const workingSession = {
      ...mockEnrichedSession,
      type: "working",
      entityType: "idea",
      entityId: "990e8400-e29b-41d4-a716-446655440005",
      taskTotal: 5,
      taskCompleted: 2,
      taskInProgress: 1,
    };
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    orderByQueue.push([{ id: REPO_ID }]);
    resultQueue.push([workingSession]);

    const caller = createCaller(true);
    const sessions = await caller.session.list({});
    expect(sessions).toHaveLength(1);
    expect(sessions[0].taskTotal).toBe(5);
    expect(sessions[0].taskCompleted).toBe(2);
    expect(sessions[0].taskInProgress).toBe(1);
  });

  it("list returns null task progress for non-working sessions", async () => {
    const specSession = {
      ...mockEnrichedSession,
      type: "spec",
      taskTotal: null,
      taskCompleted: null,
      taskInProgress: null,
    };
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    orderByQueue.push([{ id: REPO_ID }]);
    resultQueue.push([specSession]);

    const caller = createCaller(true);
    const sessions = await caller.session.list({});
    expect(sessions).toHaveLength(1);
    expect(sessions[0].taskTotal).toBeNull();
    expect(sessions[0].taskCompleted).toBeNull();
    expect(sessions[0].taskInProgress).toBeNull();
  });

  it("list returns zero counts for working session with no tasks", async () => {
    const workingNoTasks = {
      ...mockEnrichedSession,
      type: "working",
      entityType: "idea",
      entityId: "990e8400-e29b-41d4-a716-446655440005",
      taskTotal: 0,
      taskCompleted: 0,
      taskInProgress: 0,
    };
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    orderByQueue.push([{ id: REPO_ID }]);
    resultQueue.push([workingNoTasks]);

    const caller = createCaller(true);
    const sessions = await caller.session.list({});
    expect(sessions).toHaveLength(1);
    expect(sessions[0].taskTotal).toBe(0);
    expect(sessions[0].taskCompleted).toBe(0);
    expect(sessions[0].taskInProgress).toBe(0);
  });

  // --- getById ---

  it("getById returns session with messages", async () => {
    // lookupUserId — role: "admin" bypasses permission resolution
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // Fetch session
    resultQueue.push([mockSession]);
    // requireAccessibleRepo is mocked
    // Fetch messages (terminal is orderBy, awaited via .then)
    orderByQueue.push([mockMessage]);
    // Fetch attachments (terminal where, awaited via .then) — empty
    orderByQueue.push([]);

    const caller = createCaller(true);
    const result = await caller.session.getById({ id: SESSION_ID });

    expect(result).toEqual({
      ...mockSession,
      messages: [{ ...mockMessage, attachments: [] }],
      workerName: null,
      workerStatus: null,
    });
  });

  it("getById throws NOT_FOUND for missing session", async () => {
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.session.getById({ id: SESSION_ID }),
    ).rejects.toThrow("Session not found");
  });

  it("getById throws NOT_FOUND when repo not owned", async () => {
    const { TRPCError } = await import("@trpc/server");
    vi.mocked(requireAccessibleRepo).mockRejectedValueOnce(
      new TRPCError({ code: "NOT_FOUND", message: "Repo not found" }),
    );

    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // Session exists
    resultQueue.push([mockSession]);

    const caller = createCaller(true);
    await expect(
      caller.session.getById({ id: SESSION_ID }),
    ).rejects.toThrow("Repo not found");
  });

  it("getById requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.session.getById({ id: SESSION_ID }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  it("getById throws FORBIDDEN when user lacks session:read permission", async () => {
    // lookupUserId — non-admin user
    resultQueue.push([{ id: USER_ID, role: "user", roleId: null }]);
    // resolveUserPermissions: terminal where → pulled from orderByQueue
    orderByQueue.push([]); // no overrides → no permissions → FORBIDDEN

    const caller = createCaller(true);
    await expect(
      caller.session.getById({ id: SESSION_ID }),
    ).rejects.toThrow("Missing permissions: session:read");
  });

  // --- create ---

  /** Helper: push the resolveWorkerForSession DB results for user_default mode. */
  function pushResolveWorker_userDefault(opts: {
    activeWorkerId?: string | null;
    centralWorkerOnline?: boolean;
  }) {
    const { activeWorkerId = null, centralWorkerOnline = true } = opts;
    // 1. repo lookup (orgId)
    resultQueue.push([{ orgId: "mock-org" }]);
    // 2. org lookup (workerPolicy, centralWorkerId)
    resultQueue.push([{ workerPolicy: "user_default", centralWorkerId: null }]);
    // 3. user activeWorkerId lookup
    resultQueue.push([{ activeWorkerId }]);
    if (!activeWorkerId) {
      // 4. central worker online check
      resultQueue.push(
        centralWorkerOnline
          ? [{ id: "00000000-0000-0000-0000-000000000000" }]
          : [],
      );
    }
  }

  /** Helper: push resolveWorkerForSession DB results for central_worker mode. */
  function pushResolveWorker_central(opts: {
    centralWorkerId?: string | null;
    workerStatus?: string;
  }) {
    const { centralWorkerId = "central-w-id", workerStatus = "online" } = opts;
    // 1. repo lookup (orgId)
    resultQueue.push([{ orgId: "mock-org" }]);
    // 2. org lookup (workerPolicy, centralWorkerId)
    resultQueue.push([{ workerPolicy: "central_worker", centralWorkerId }]);
    if (centralWorkerId) {
      // 3. worker status check
      resultQueue.push([{ status: workerStatus }]);
    }
  }

  /** Helper: push resolveWorkerForSession DB results for require_local mode. */
  function pushResolveWorker_requireLocal(opts: {
    memberWorkerId?: string | null;
    workerStatus?: string;
  }) {
    const { memberWorkerId = "local-w-id", workerStatus = "online" } = opts;
    // 1. repo lookup (orgId)
    resultQueue.push([{ orgId: "mock-org" }]);
    // 2. org lookup (workerPolicy, centralWorkerId)
    resultQueue.push([{ workerPolicy: "require_local", centralWorkerId: null }]);
    // 3. member worker mapping
    resultQueue.push(memberWorkerId ? [{ workerId: memberWorkerId }] : []);
    if (memberWorkerId) {
      // 4. worker status check
      resultQueue.push([{ status: workerStatus }]);
    }
  }

  it("create inserts session, publishes sync, and enqueues job", async () => {
    // lookupUserId (role: "admin" bypasses dynamic permission check in create)
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // checkLimitFromRole bypasses for admin — no mock needed
    // requireAccessibleRepo is mocked
    // resolveWorkerForSession: user_default with no activeWorker, central online
    pushResolveWorker_userDefault({ centralWorkerOnline: true });
    // insert().values().returning()
    mockDb.returning.mockResolvedValueOnce([mockSession]);

    const caller = createCaller(true);
    const result = await caller.session.create({
      repoId: REPO_ID,
      type: "spec",
      title: "Spec Session",
    });

    expect(result).toEqual(mockSession);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:session",
      expect.objectContaining({ action: "created" }),
    );
  });

  it("create requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.session.create({
        repoId: REPO_ID,
        type: "spec",
        title: "Test",
      }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // --- resolveWorkerForSession (tested through create) ---

  describe("resolveWorkerForSession (via create)", () => {
    it("user_default mode returns activeWorkerId when user has one", async () => {
      const WORKER_ID = "990e8400-e29b-41d4-a716-446655440004";
      const sessionWithWorker = { ...mockSession, workerId: WORKER_ID };

      resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
      // checkLimitFromRole bypasses for admin — no mock needed
      pushResolveWorker_userDefault({ activeWorkerId: WORKER_ID });
      mockDb.returning.mockResolvedValueOnce([sessionWithWorker]);

      const caller = createCaller(true);
      const result = await caller.session.create({
        repoId: REPO_ID,
        type: "spec",
        title: "Spec Session",
      });
      expect(result.workerId).toBe(WORKER_ID);
    });

    it("user_default mode falls back to central worker when no activeWorkerId", async () => {
      resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
      // checkLimitFromRole bypasses for admin — no mock needed
      pushResolveWorker_userDefault({ activeWorkerId: null, centralWorkerOnline: true });
      mockDb.returning.mockResolvedValueOnce([{ ...mockSession, workerId: null }]);

      const caller = createCaller(true);
      const result = await caller.session.create({
        repoId: REPO_ID,
        type: "spec",
        title: "Spec Session",
      });
      // Returns undefined workerId (central worker listens on unscoped queue)
      expect(result.workerId).toBeNull();
    });

    it("user_default mode throws when no activeWorkerId and central worker is offline", async () => {
      resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
      // checkLimitFromRole bypasses for admin — no mock needed
      pushResolveWorker_userDefault({ activeWorkerId: null, centralWorkerOnline: false });

      const caller = createCaller(true);
      await expect(
        caller.session.create({ repoId: REPO_ID, type: "spec", title: "Test" }),
      ).rejects.toThrow("No worker available");
    });

    it("central_worker mode returns centralWorkerId when worker is online", async () => {
      const CENTRAL_ID = "central-w-id";
      const sessionWithCentral = { ...mockSession, workerId: CENTRAL_ID };

      resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
      // checkLimitFromRole bypasses for admin — no mock needed
      pushResolveWorker_central({ centralWorkerId: CENTRAL_ID, workerStatus: "online" });
      mockDb.returning.mockResolvedValueOnce([sessionWithCentral]);

      const caller = createCaller(true);
      const result = await caller.session.create({
        repoId: REPO_ID,
        type: "spec",
        title: "Spec Session",
      });
      expect(result.workerId).toBe(CENTRAL_ID);
    });

    it("central_worker mode throws when central worker is offline", async () => {
      resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
      // checkLimitFromRole bypasses for admin — no mock needed
      pushResolveWorker_central({ centralWorkerId: "central-w-id", workerStatus: "offline" });

      const caller = createCaller(true);
      await expect(
        caller.session.create({ repoId: REPO_ID, type: "spec", title: "Test" }),
      ).rejects.toThrow("central worker which is currently offline");
    });

    it("central_worker mode throws when no centralWorkerId is configured", async () => {
      resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
      // checkLimitFromRole bypasses for admin — no mock needed
      pushResolveWorker_central({ centralWorkerId: null });

      const caller = createCaller(true);
      await expect(
        caller.session.create({ repoId: REPO_ID, type: "spec", title: "Test" }),
      ).rejects.toThrow("central worker but none is configured");
    });

    it("require_local mode returns member's assigned worker when online", async () => {
      const LOCAL_ID = "local-w-id";
      const sessionWithLocal = { ...mockSession, workerId: LOCAL_ID };

      resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
      // checkLimitFromRole bypasses for admin — no mock needed
      pushResolveWorker_requireLocal({ memberWorkerId: LOCAL_ID, workerStatus: "online" });
      mockDb.returning.mockResolvedValueOnce([sessionWithLocal]);

      const caller = createCaller(true);
      const result = await caller.session.create({
        repoId: REPO_ID,
        type: "spec",
        title: "Spec Session",
      });
      expect(result.workerId).toBe(LOCAL_ID);
    });

    it("require_local mode throws when no member worker mapping exists", async () => {
      resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
      // checkLimitFromRole bypasses for admin — no mock needed
      pushResolveWorker_requireLocal({ memberWorkerId: null });

      const caller = createCaller(true);
      await expect(
        caller.session.create({ repoId: REPO_ID, type: "spec", title: "Test" }),
      ).rejects.toThrow("requires a local worker");
    });

    it("require_local mode throws when assigned worker is offline", async () => {
      resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
      // checkLimitFromRole bypasses for admin — no mock needed
      pushResolveWorker_requireLocal({ memberWorkerId: "local-w-id", workerStatus: "offline" });

      const caller = createCaller(true);
      await expect(
        caller.session.create({ repoId: REPO_ID, type: "spec", title: "Test" }),
      ).rejects.toThrow("local worker is currently offline");
    });

    it("throws NOT_FOUND when repo does not exist", async () => {
      resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
      // checkLimitFromRole bypasses for admin — no mock needed
      // resolveWorkerForSession: repo query returns empty
      resultQueue.push([]);

      const caller = createCaller(true);
      await expect(
        caller.session.create({ repoId: REPO_ID, type: "spec", title: "Test" }),
      ).rejects.toThrow("Repo not found");
    });

    it("throws NOT_FOUND when organization does not exist", async () => {
      resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
      // checkLimitFromRole bypasses for admin — no mock needed
      // resolveWorkerForSession: repo query
      resultQueue.push([{ orgId: "mock-org" }]);
      // org query returns empty
      resultQueue.push([]);

      const caller = createCaller(true);
      await expect(
        caller.session.create({ repoId: REPO_ID, type: "spec", title: "Test" }),
      ).rejects.toThrow("Organization not found");
    });

    it("error messages are actionable and mention next steps", async () => {
      // Test central_worker offline message mentions "Contact your org admin"
      resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
      // checkLimitFromRole bypasses for admin — no mock needed
      pushResolveWorker_central({ centralWorkerId: "c-id", workerStatus: "offline" });

      const caller = createCaller(true);
      await expect(
        caller.session.create({ repoId: REPO_ID, type: "spec", title: "Test" }),
      ).rejects.toThrow(/Contact your org admin/);
    });
  });

  // --- updateStatus ---

  it("updateStatus changes session status and publishes sync", async () => {
    const pausedSession = { ...mockSession, status: "paused" };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // Fetch existing session
    resultQueue.push([mockSession]);
    // requireAccessibleRepo is mocked
    // update().set().where().returning()
    mockDb.returning.mockResolvedValueOnce([pausedSession]);

    const caller = createCaller(true);
    const result = await caller.session.updateStatus({
      id: SESSION_ID,
      status: "paused",
    });

    expect(result).toEqual(pausedSession);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:session",
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("updateStatus throws NOT_FOUND for missing session", async () => {
    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.session.updateStatus({ id: SESSION_ID, status: "paused" }),
    ).rejects.toThrow("Session not found");
  });

  it("updateStatus throws NOT_FOUND when repo not owned", async () => {
    const { TRPCError } = await import("@trpc/server");
    vi.mocked(requireAccessibleRepo).mockRejectedValueOnce(
      new TRPCError({ code: "NOT_FOUND", message: "Repo not found" }),
    );

    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([mockSession]);

    const caller = createCaller(true);
    await expect(
      caller.session.updateStatus({ id: SESSION_ID, status: "paused" }),
    ).rejects.toThrow("Repo not found");
  });

  // --- addMessage ---

  it("addMessage writes message, publishes to scoped channel, and enqueues job", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // Fetch session (verify exists and active)
    resultQueue.push([mockSession]);
    // requireAccessibleRepo is mocked
    // insert().values().returning()
    mockDb.returning.mockResolvedValueOnce([mockMessage]);

    const caller = createCaller(true);
    const result = await caller.session.addMessage({
      sessionId: SESSION_ID,
      content: "Hello",
    });

    expect(result).toEqual(mockMessage);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      `sync:session:${SESSION_ID}:messages`,
      expect.objectContaining({ action: "created" }),
    );
  });

  it("addMessage rejects when session is not active", async () => {
    const completedSession = { ...mockSession, status: "completed" };

    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([completedSession]);
    // requireAccessibleRepo is mocked

    const caller = createCaller(true);
    await expect(
      caller.session.addMessage({
        sessionId: SESSION_ID,
        content: "Hello",
      }),
    ).rejects.toThrow("Session is not active");
  });

  it("addMessage throws NOT_FOUND for missing session", async () => {
    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.session.addMessage({
        sessionId: SESSION_ID,
        content: "Hello",
      }),
    ).rejects.toThrow("Session not found");
  });

  it("addMessage requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.session.addMessage({
        sessionId: SESSION_ID,
        content: "Hello",
      }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  it("addMessage auto-resumes a paused session", async () => {
    const pausedSession = { ...mockSession, status: "paused" };
    const resumedSession = { ...mockSession, status: "active" };

    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([pausedSession]);
    // requireAccessibleRepo is mocked
    // resolveWorkerForSession: user_default with central fallback
    pushResolveWorker_userDefault({ centralWorkerOnline: true });
    // update().set().where().returning() — session reactivated
    mockDb.returning.mockResolvedValueOnce([resumedSession]);
    // insert system message "Session resumed."
    const systemMsg = { ...mockMessage, role: "system", content: "Session resumed." };
    mockDb.returning.mockResolvedValueOnce([systemMsg]);
    // insert user message
    mockDb.returning.mockResolvedValueOnce([mockMessage]);

    const caller = createCaller(true);
    const result = await caller.session.addMessage({
      sessionId: SESSION_ID,
      content: "Hello",
    });

    expect(result).toEqual(mockMessage);
    // Should publish session update (resume)
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:session",
      expect.objectContaining({ action: "updated" }),
    );
    // Should publish system message
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      `sync:session:${SESSION_ID}:messages`,
      expect.objectContaining({ action: "created", data: systemMsg }),
    );
    // Should publish user message
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      `sync:session:${SESSION_ID}:messages`,
      expect.objectContaining({ action: "created", data: mockMessage }),
    );
  });

  it("addMessage still rejects completed sessions", async () => {
    const completedSession = { ...mockSession, status: "completed" };

    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([completedSession]);
    // requireAccessibleRepo is mocked

    const caller = createCaller(true);
    await expect(
      caller.session.addMessage({
        sessionId: SESSION_ID,
        content: "Hello",
      }),
    ).rejects.toThrow("Session is not active");
  });

  // --- stop ---

  it("stop enqueues session.stop job", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // Fetch session
    resultQueue.push([mockSession]);
    // requireAccessibleRepo is mocked

    const caller = createCaller(true);
    const result = await caller.session.stop({ id: SESSION_ID });
    expect(result).toEqual({ success: true });
  });

  it("stop throws NOT_FOUND for missing session", async () => {
    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.session.stop({ id: SESSION_ID }),
    ).rejects.toThrow("Session not found");
  });

  it("stop requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.session.stop({ id: SESSION_ID }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // --- pause ---

  it("pause changes an active session to paused and writes system message", async () => {
    const pausedSession = { ...mockSession, status: "paused" };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // Fetch session
    resultQueue.push([mockSession]);
    // requireAccessibleRepo is mocked
    // update().set().where().returning()
    mockDb.returning.mockResolvedValueOnce([pausedSession]);
    // insert system message returning
    const systemMsg = { ...mockMessage, role: "system", content: "Session paused by user." };
    mockDb.returning.mockResolvedValueOnce([systemMsg]);

    const caller = createCaller(true);
    const result = await caller.session.pause({ sessionId: SESSION_ID });

    expect(result).toEqual(pausedSession);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:session",
      expect.objectContaining({ action: "updated" }),
    );
    // System message published to scoped channel
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      `sync:session:${SESSION_ID}:messages`,
      expect.objectContaining({ action: "created" }),
    );
  });

  it("pause rejects pausing a non-active session", async () => {
    const pausedSession = { ...mockSession, status: "paused" };

    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([pausedSession]);
    // requireAccessibleRepo is mocked

    const caller = createCaller(true);
    await expect(
      caller.session.pause({ sessionId: SESSION_ID }),
    ).rejects.toThrow("Only active sessions can be paused");
  });

  it("pause rejects if user doesn't own session", async () => {
    const { TRPCError } = await import("@trpc/server");
    vi.mocked(requireAccessibleRepo).mockRejectedValueOnce(
      new TRPCError({ code: "NOT_FOUND", message: "Repo not found" }),
    );

    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([mockSession]);

    const caller = createCaller(true);
    await expect(
      caller.session.pause({ sessionId: SESSION_ID }),
    ).rejects.toThrow("Repo not found");
  });

  it("pause enqueues session.stop for working sessions", async () => {
    const { enqueueJob } = await import("../jobs/index.js");
    const workingSession = { ...mockSession, type: "working", status: "active" };
    const pausedSession = { ...workingSession, status: "paused" };

    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([workingSession]);
    // requireAccessibleRepo is mocked
    mockDb.returning.mockResolvedValueOnce([pausedSession]);
    mockDb.returning.mockResolvedValueOnce([mockMessage]);

    const caller = createCaller(true);
    await caller.session.pause({ sessionId: SESSION_ID });

    expect(enqueueJob).toHaveBeenCalledWith(
      "session.stop",
      expect.objectContaining({ sessionId: SESSION_ID, action: "pause" }),
      undefined,
    );
  });

  it("pause enqueues session.stop for conversational sessions (all types use CLI)", async () => {
    const { enqueueJob } = await import("../jobs/index.js");
    const specSession = { ...mockSession, type: "spec", status: "active" };
    const pausedSession = { ...specSession, status: "paused" };

    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([specSession]);
    // requireAccessibleRepo is mocked
    mockDb.returning.mockResolvedValueOnce([pausedSession]);
    mockDb.returning.mockResolvedValueOnce([mockMessage]);

    const caller = createCaller(true);
    await caller.session.pause({ sessionId: SESSION_ID });

    // All session types now run via SessionManager, so stop job is required
    expect(enqueueJob).toHaveBeenCalledWith(
      "session.stop",
      expect.objectContaining({ sessionId: SESSION_ID, action: "pause" }),
      undefined,
    );
  });

  // --- resume ---

  it("resume changes a paused session to active and writes system message", async () => {
    const pausedSession = { ...mockSession, status: "paused" };
    const activeSession = { ...mockSession, status: "active" };

    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([pausedSession]);
    // requireAccessibleRepo is mocked
    // resolveWorkerForSession: user_default with central fallback
    pushResolveWorker_userDefault({ centralWorkerOnline: true });
    mockDb.returning.mockResolvedValueOnce([activeSession]);
    const systemMsg = { ...mockMessage, role: "system", content: "Session resumed by user." };
    mockDb.returning.mockResolvedValueOnce([systemMsg]);

    const caller = createCaller(true);
    const result = await caller.session.resume({ sessionId: SESSION_ID });

    expect(result).toEqual(activeSession);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:session",
      expect.objectContaining({ action: "updated" }),
    );
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      `sync:session:${SESSION_ID}:messages`,
      expect.objectContaining({ action: "created" }),
    );
  });

  it("resume rejects resuming a non-paused session", async () => {
    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([mockSession]); // status is "active"
    // requireAccessibleRepo is mocked

    const caller = createCaller(true);
    await expect(
      caller.session.resume({ sessionId: SESSION_ID }),
    ).rejects.toThrow("Only paused or error sessions can be resumed");
  });

  it("resume enqueues session.start with isResume for working sessions", async () => {
    const { enqueueJob } = await import("../jobs/index.js");
    const pausedWorking = { ...mockSession, type: "working", status: "paused" };
    const activeWorking = { ...pausedWorking, status: "active" };

    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([pausedWorking]);
    // requireAccessibleRepo is mocked
    // resolveWorkerForSession: user_default with central fallback
    pushResolveWorker_userDefault({ centralWorkerOnline: true });
    mockDb.returning.mockResolvedValueOnce([activeWorking]);
    mockDb.returning.mockResolvedValueOnce([mockMessage]);

    const caller = createCaller(true);
    await caller.session.resume({ sessionId: SESSION_ID });

    expect(enqueueJob).toHaveBeenCalledWith(
      "session.start",
      expect.objectContaining({
        sessionId: SESSION_ID,
        isResume: true,
        type: "working",
      }),
      undefined,
    );
  });

  // --- complete ---

  it("complete changes an active session to completed and writes system message", async () => {
    const completedSession = { ...mockSession, status: "completed" };

    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([mockSession]); // active session
    // requireAccessibleRepo is mocked
    mockDb.returning.mockResolvedValueOnce([completedSession]);
    const systemMsg = { ...mockMessage, role: "system", content: "Session completed by user." };
    mockDb.returning.mockResolvedValueOnce([systemMsg]);

    const caller = createCaller(true);
    const result = await caller.session.complete({ sessionId: SESSION_ID });

    expect(result).toEqual(completedSession);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:session",
      expect.objectContaining({ action: "updated" }),
    );
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      `sync:session:${SESSION_ID}:messages`,
      expect.objectContaining({ action: "created" }),
    );
  });

  it("complete changes a paused session to completed without enqueuing stop job", async () => {
    const { enqueueJob } = await import("../jobs/index.js");
    const pausedSession = { ...mockSession, status: "paused" };
    const completedSession = { ...pausedSession, status: "completed" };

    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([pausedSession]);
    // requireAccessibleRepo is mocked
    mockDb.returning.mockResolvedValueOnce([completedSession]);
    mockDb.returning.mockResolvedValueOnce([mockMessage]);

    const caller = createCaller(true);
    const result = await caller.session.complete({ sessionId: SESSION_ID });

    expect(result).toEqual(completedSession);
    expect(enqueueJob).not.toHaveBeenCalledWith(
      "session.stop",
      expect.anything(),
    );
  });

  it("complete rejects already-completed sessions", async () => {
    const completedSession = { ...mockSession, status: "completed" };

    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([completedSession]);
    // requireAccessibleRepo is mocked

    const caller = createCaller(true);
    await expect(
      caller.session.complete({ sessionId: SESSION_ID }),
    ).rejects.toThrow("Only active, paused, or error sessions can be completed");
  });

  it("complete allows errored sessions to be completed", async () => {
    const erroredSession = { ...mockSession, status: "error" };
    const completedSession = { ...erroredSession, status: "completed" };

    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([erroredSession]);
    // requireAccessibleRepo is mocked
    mockDb.returning.mockResolvedValueOnce([completedSession]);
    const systemMsg = { ...mockMessage, role: "system", content: "Session completed by user." };
    mockDb.returning.mockResolvedValueOnce([systemMsg]);

    const caller = createCaller(true);
    const result = await caller.session.complete({ sessionId: SESSION_ID });

    expect(result).toEqual(completedSession);
  });

  it("complete enqueues stop job for active working sessions", async () => {
    const { enqueueJob } = await import("../jobs/index.js");
    const workingSession = { ...mockSession, type: "working", status: "active" };
    const completedSession = { ...workingSession, status: "completed" };

    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([workingSession]);
    // requireAccessibleRepo is mocked
    mockDb.returning.mockResolvedValueOnce([completedSession]);
    mockDb.returning.mockResolvedValueOnce([mockMessage]);

    const caller = createCaller(true);
    await caller.session.complete({ sessionId: SESSION_ID });

    expect(enqueueJob).toHaveBeenCalledWith(
      "session.stop",
      expect.objectContaining({ sessionId: SESSION_ID, action: "pause" }),
      undefined,
    );
  });

  it("complete does NOT enqueue stop for paused working sessions", async () => {
    const { enqueueJob } = await import("../jobs/index.js");
    const pausedWorking = { ...mockSession, type: "working", status: "paused" };
    const completedSession = { ...pausedWorking, status: "completed" };

    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([pausedWorking]);
    // requireAccessibleRepo is mocked
    mockDb.returning.mockResolvedValueOnce([completedSession]);
    mockDb.returning.mockResolvedValueOnce([mockMessage]);

    const caller = createCaller(true);
    await caller.session.complete({ sessionId: SESSION_ID });

    expect(enqueueJob).not.toHaveBeenCalledWith(
      "session.stop",
      expect.anything(),
    );
  });

  it("complete enqueues stop for active conversational sessions (all types use CLI)", async () => {
    const { enqueueJob } = await import("../jobs/index.js");
    const specSession = { ...mockSession, type: "spec", status: "active" };
    const completedSession = { ...specSession, status: "completed" };

    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([specSession]);
    // requireAccessibleRepo is mocked
    mockDb.returning.mockResolvedValueOnce([completedSession]);
    mockDb.returning.mockResolvedValueOnce([mockMessage]);

    const caller = createCaller(true);
    await caller.session.complete({ sessionId: SESSION_ID });

    // All session types now run via SessionManager, so stop job is required
    expect(enqueueJob).toHaveBeenCalledWith(
      "session.stop",
      expect.objectContaining({ sessionId: SESSION_ID, action: "pause" }),
      undefined,
    );
  });

  it("complete rejects if user doesn't own session", async () => {
    const { TRPCError } = await import("@trpc/server");
    vi.mocked(requireAccessibleRepo).mockRejectedValueOnce(
      new TRPCError({ code: "NOT_FOUND", message: "Repo not found" }),
    );

    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([mockSession]);

    const caller = createCaller(true);
    await expect(
      caller.session.complete({ sessionId: SESSION_ID }),
    ).rejects.toThrow("Repo not found");
  });

  it("complete requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.session.complete({ sessionId: SESSION_ID }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  it("resume enqueues session.start for conversational sessions (all types use CLI)", async () => {
    const { enqueueJob } = await import("../jobs/index.js");
    const pausedSpec = { ...mockSession, type: "spec", status: "paused" };
    const activeSpec = { ...pausedSpec, status: "active" };

    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([pausedSpec]);
    // requireAccessibleRepo is mocked
    // resolveWorkerForSession: user_default with central fallback
    pushResolveWorker_userDefault({ centralWorkerOnline: true });
    mockDb.returning.mockResolvedValueOnce([activeSpec]);
    mockDb.returning.mockResolvedValueOnce([mockMessage]);

    const caller = createCaller(true);
    await caller.session.resume({ sessionId: SESSION_ID });

    // All session types now run via SessionManager, so start job is required
    expect(enqueueJob).toHaveBeenCalledWith(
      "session.start",
      expect.objectContaining({ sessionId: SESSION_ID, isResume: true }),
      undefined,
    );
  });

  // --- listOpenQuestions ---

  it("listOpenQuestions returns open questions for accessible repos", async () => {
    // lookupUserId (admin bypasses permission resolution)
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // orgRepos query (terminal where -> then)
    orderByQueue.push([{ id: REPO_ID }]);
    // main query result (terminal limit -> resultQueue)
    const mockQuestion = {
      messageId: MESSAGE_ID,
      sessionId: SESSION_ID,
      sessionTitle: "Test Session",
      repoId: REPO_ID,
      repoName: "Test Repo",
      repoColor: "#ff0000",
      metadata: { type: "structured_question", questions: [] },
      createdAt: new Date(),
    };
    resultQueue.push([mockQuestion]);

    const caller = createCaller(true);
    const result = await caller.session.listOpenQuestions({});
    expect(result).toEqual([mockQuestion]);
  });

  it("listOpenQuestions returns empty when user has no org access", async () => {
    const { getUserOrgIds } = await import("../lib/orgSyncFilter.js");
    vi.mocked(getUserOrgIds).mockResolvedValueOnce(new Set());

    // lookupUserId
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);

    const caller = createCaller(true);
    const result = await caller.session.listOpenQuestions({});
    expect(result).toEqual([]);
  });

  it("listOpenQuestions returns empty when no repos in orgs", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // orgRepos query returns empty (terminal where -> then)
    orderByQueue.push([]);

    const caller = createCaller(true);
    const result = await caller.session.listOpenQuestions({});
    expect(result).toEqual([]);
  });

  it("listOpenQuestions requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.session.listOpenQuestions({}),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  it("listOpenQuestions accepts filter parameters", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // orgRigs (terminal where -> then)
    orderByQueue.push([{ id: REPO_ID }]);
    // main query (terminal limit -> resultQueue)
    resultQueue.push([]);

    const caller = createCaller(true);
    const result = await caller.session.listOpenQuestions({
      repoId: REPO_ID,
      sessionId: SESSION_ID,
      olderThanMinutes: 30,
    });
    expect(result).toEqual([]);
  });

  // --- openQuestionCount ---

  it("openQuestionCount returns count of open questions", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // orgRepos query (terminal where -> then)
    orderByQueue.push([{ id: REPO_ID }]);
    // count query (terminal where -> then, no .limit())
    orderByQueue.push([{ count: 5 }]);

    const caller = createCaller(true);
    const result = await caller.session.openQuestionCount({});
    expect(result).toEqual({ count: 5 });
  });

  it("openQuestionCount returns 0 when user has no org access", async () => {
    const { getUserOrgIds } = await import("../lib/orgSyncFilter.js");
    vi.mocked(getUserOrgIds).mockResolvedValueOnce(new Set());

    // lookupUserId
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);

    const caller = createCaller(true);
    const result = await caller.session.openQuestionCount({});
    expect(result).toEqual({ count: 0 });
  });

  it("openQuestionCount returns 0 when no repos in orgs", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // orgRigs empty (terminal where -> then)
    orderByQueue.push([]);

    const caller = createCaller(true);
    const result = await caller.session.openQuestionCount({});
    expect(result).toEqual({ count: 0 });
  });

  it("openQuestionCount requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.session.openQuestionCount({}),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // --- scheduling ---

  describe("scheduling", () => {
    const ENTITY_ID = "aa0e8400-e29b-41d4-a716-446655440005";
    const mockEntity = { id: ENTITY_ID, title: "Implement auth" };

    it("startWork with scheduledFor creates scheduled session", async () => {
      const { enqueueJob } = await import("../jobs/index.js");
      const future = new Date(Date.now() + 3600000).toISOString();
      const scheduledSession = {
        ...mockSession,
        type: "working",
        entityType: "task",
        entityId: ENTITY_ID,
        status: "scheduled",
        scheduledFor: new Date(future),
      };

      // lookupUserId (admin bypasses permission check)
      resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
      // countActiveSessions (session limit check)
      // checkLimitFromRole bypasses for admin — no mock needed
      // requireAccessibleRepo is mocked
      // entity lookup (terminal limit)
      resultQueue.push([mockEntity]);
      // resolveWorkerForSession: user_default with central fallback
      pushResolveWorker_userDefault({ centralWorkerOnline: true });
      // insert().values().returning()
      mockDb.returning.mockResolvedValueOnce([scheduledSession]);

      const caller = createCaller(true);
      const result = await caller.session.startWork({
        repoId: REPO_ID,
        entityType: "task",
        entityId: ENTITY_ID,
        scheduledFor: future,
      });

      expect(result.status).toBe("scheduled");
      expect(enqueueJob).toHaveBeenCalledWith(
        "session.start",
        expect.objectContaining({ sessionId: SESSION_ID }),
        expect.objectContaining({ startAfter: new Date(future) }),
      );
    });

    it("startWork without scheduledFor creates active session (regression)", async () => {
      const activeSession = {
        ...mockSession,
        type: "working",
        entityType: "task",
        entityId: ENTITY_ID,
        status: "active",
      };

      // lookupUserId
      resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
      // countActiveSessions (session limit check)
      // checkLimitFromRole bypasses for admin — no mock needed
      // entity lookup
      resultQueue.push([mockEntity]);
      // resolveWorkerForSession: user_default with central fallback
      pushResolveWorker_userDefault({ centralWorkerOnline: true });
      // insert().values().returning()
      mockDb.returning.mockResolvedValueOnce([activeSession]);

      const caller = createCaller(true);
      const result = await caller.session.startWork({
        repoId: REPO_ID,
        entityType: "task",
        entityId: ENTITY_ID,
      });

      expect(result.status).toBe("active");
    });

    it("cancelScheduled on scheduled session succeeds", async () => {
      const { cancelJob } = await import("../jobs/index.js");
      const scheduledSession = {
        ...mockSession,
        status: "scheduled",
        jobId: "job-456",
      };
      const completedSession = { ...scheduledSession, status: "completed" };

      // lookupUserId
      resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
      // Fetch session (terminal limit)
      resultQueue.push([scheduledSession]);
      // requireAccessibleRepo is mocked
      // update().set().where().returning()
      mockDb.returning.mockResolvedValueOnce([completedSession]);

      const caller = createCaller(true);
      const result = await caller.session.cancelScheduled({ sessionId: SESSION_ID });

      expect(result.status).toBe("completed");
      expect(cancelJob).toHaveBeenCalledWith("session.start", "job-456");
    });

    it("cancelScheduled on non-scheduled session fails", async () => {
      // lookupUserId
      resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
      // Fetch session (active, not scheduled)
      resultQueue.push([mockSession]);
      // requireAccessibleRepo is mocked

      const caller = createCaller(true);
      await expect(
        caller.session.cancelScheduled({ sessionId: SESSION_ID }),
      ).rejects.toThrow("Only scheduled sessions can be cancelled");
    });

    it("startWork rejects past scheduledFor date", async () => {
      const past = new Date(Date.now() - 3600000).toISOString();

      // lookupUserId
      resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
      // countActiveSessions (session limit check)
      // checkLimitFromRole bypasses for admin — no mock needed

      const caller = createCaller(true);
      await expect(
        caller.session.startWork({
          repoId: REPO_ID,
          entityType: "task",
          entityId: ENTITY_ID,
          scheduledFor: past,
        }),
      ).rejects.toThrow("scheduledFor must be in the future");
    });
  });
});
