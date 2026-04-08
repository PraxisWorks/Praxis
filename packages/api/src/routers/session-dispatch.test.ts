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

vi.mock("../lib/requireOrgMember.js", () => ({
  requireOrgMember: vi.fn().mockResolvedValue({ orgId: "mock", userId: "mock", role: "owner" }),
}));

vi.mock("../lib/orgSyncFilter.js", () => ({
  getUserOrgIds: vi.fn().mockResolvedValue(new Set(["mock-org"])),
  shouldForwardOrgEvent: vi.fn().mockReturnValue(true),
}));

import { appRouter } from "./index.js";
import { enqueueJob } from "../jobs/index.js";

describe("session dispatch routing", () => {
  const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
  const REPO_ID = "660e8400-e29b-41d4-a716-446655440001";
  const SESSION_ID = "770e8400-e29b-41d4-a716-446655440002";
  const MESSAGE_ID = "880e8400-e29b-41d4-a716-446655440003";
  const WORKER_ID = "990e8400-e29b-41d4-a716-446655440004";

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
    workerId: null as string | null,
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
    groupBy: vi.fn().mockReturnThis(),
    as: vi.fn().mockReturnValue("subquery"),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };

  const createCaller = () =>
    appRouter.createCaller({
      user: { sub: "user123", email: "test@example.com" },
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
    mockDb.groupBy.mockReturnThis();
    mockDb.as.mockReturnValue("subquery");
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValue([]);
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.delete.mockReturnThis();
  });

  // --- create: user has no activeWorkerId ---

  it("create calls enqueueJob without workerId when user has no activeWorkerId", async () => {
    // lookupUserId (role: "admin" bypasses dynamic permission check in create)
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // checkLimitFromRole bypasses for admin — no mock needed
    // requireAccessibleRepo: repo lookup + requireOrgMember (mocked)
    resultQueue.push([mockRepo]);
    // resolveWorkerForSession: repo lookup (orgId)
    resultQueue.push([{ orgId: "mock-org" }]);
    // resolveWorkerForSession: org lookup (workerPolicy)
    resultQueue.push([{ workerPolicy: "user_default", centralWorkerId: null }]);
    // resolveWorkerForSession: user activeWorkerId lookup
    resultQueue.push([{ activeWorkerId: null }]);
    // resolveWorkerForSession: central worker online check (fallback)
    resultQueue.push([{ id: "00000000-0000-0000-0000-000000000000" }]);
    // insert session returning
    mockDb.returning.mockResolvedValueOnce([{ ...mockSession, workerId: null }]);

    const caller = createCaller();
    await caller.session.create({
      repoId: REPO_ID,
      type: "spec",
      title: "Spec Session",
    });

    expect(enqueueJob).toHaveBeenCalledWith(
      "session.start",
      expect.objectContaining({ sessionId: SESSION_ID }),
      undefined,
    );
  });

  // --- create: user has activeWorkerId ---

  it("create calls enqueueJob with workerId when user has activeWorkerId", async () => {
    // lookupUserId (role: "admin" bypasses dynamic permission check in create)
    resultQueue.push([{ id: USER_ID, role: "admin", roleId: null }]);
    // checkLimitFromRole bypasses for admin — no mock needed
    // requireAccessibleRepo: repo lookup + requireOrgMember (mocked)
    resultQueue.push([mockRepo]);
    // resolveWorkerForSession: repo lookup (orgId)
    resultQueue.push([{ orgId: "mock-org" }]);
    // resolveWorkerForSession: org lookup (workerPolicy)
    resultQueue.push([{ workerPolicy: "user_default", centralWorkerId: null }]);
    // resolveWorkerForSession: user activeWorkerId lookup
    resultQueue.push([{ activeWorkerId: WORKER_ID }]);
    // insert session returning
    mockDb.returning.mockResolvedValueOnce([{ ...mockSession, workerId: WORKER_ID }]);

    const caller = createCaller();
    await caller.session.create({
      repoId: REPO_ID,
      type: "spec",
      title: "Spec Session",
    });

    expect(enqueueJob).toHaveBeenCalledWith(
      "session.start",
      expect.objectContaining({ sessionId: SESSION_ID }),
      { workerId: WORKER_ID },
    );
  });

  // --- addMessage: uses session.workerId, not user's activeWorkerId ---

  it("addMessage routes to session workerId, not user activeWorkerId", async () => {
    const sessionWithWorker = { ...mockSession, workerId: WORKER_ID };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // fetch session
    resultQueue.push([sessionWithWorker]);
    // repo ownership check
    resultQueue.push([mockRepo]);
    // insert message returning
    mockDb.returning.mockResolvedValueOnce([mockMessage]);

    const caller = createCaller();
    await caller.session.addMessage({
      sessionId: SESSION_ID,
      content: "Hello",
    });

    expect(enqueueJob).toHaveBeenCalledWith(
      "session.message",
      expect.objectContaining({ sessionId: SESSION_ID }),
      { workerId: WORKER_ID },
    );
  });

  it("addMessage calls enqueueJob without workerId when session has no workerId", async () => {
    const sessionNoWorker = { ...mockSession, workerId: null };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // fetch session
    resultQueue.push([sessionNoWorker]);
    // repo ownership check
    resultQueue.push([mockRepo]);
    // insert message returning
    mockDb.returning.mockResolvedValueOnce([mockMessage]);

    const caller = createCaller();
    await caller.session.addMessage({
      sessionId: SESSION_ID,
      content: "Hello",
    });

    expect(enqueueJob).toHaveBeenCalledWith(
      "session.message",
      expect.objectContaining({ sessionId: SESSION_ID }),
      undefined,
    );
  });

  // --- stop: uses session.workerId ---

  it("stop routes to session workerId", async () => {
    const sessionWithWorker = { ...mockSession, workerId: WORKER_ID };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // fetch session
    resultQueue.push([sessionWithWorker]);
    // repo ownership check
    resultQueue.push([mockRepo]);

    const caller = createCaller();
    await caller.session.stop({ id: SESSION_ID });

    expect(enqueueJob).toHaveBeenCalledWith(
      "session.stop",
      expect.objectContaining({ sessionId: SESSION_ID }),
      { workerId: WORKER_ID },
    );
  });

  // --- pause: uses session.workerId ---

  it("pause routes to session workerId", async () => {
    const sessionWithWorker = { ...mockSession, workerId: WORKER_ID, status: "active" };
    const pausedSession = { ...sessionWithWorker, status: "paused" };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // fetch session
    resultQueue.push([sessionWithWorker]);
    // repo ownership check
    resultQueue.push([mockRepo]);
    // update returning
    mockDb.returning.mockResolvedValueOnce([pausedSession]);
    // insert system message returning
    mockDb.returning.mockResolvedValueOnce([mockMessage]);

    const caller = createCaller();
    await caller.session.pause({ sessionId: SESSION_ID });

    expect(enqueueJob).toHaveBeenCalledWith(
      "session.stop",
      expect.objectContaining({ sessionId: SESSION_ID, action: "pause" }),
      { workerId: WORKER_ID },
    );
  });

  // --- resume: re-resolves worker via resolveWorkerForSession ---

  it("resume routes to re-resolved workerId", async () => {
    const pausedSession = { ...mockSession, workerId: WORKER_ID, status: "paused" };
    const activeSession = { ...pausedSession, status: "active" };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // fetch session
    resultQueue.push([pausedSession]);
    // repo ownership check
    resultQueue.push([mockRepo]);
    // resolveWorkerForSession: repo lookup (orgId)
    resultQueue.push([{ orgId: "mock-org" }]);
    // resolveWorkerForSession: org lookup (workerPolicy)
    resultQueue.push([{ workerPolicy: "user_default", centralWorkerId: null }]);
    // resolveWorkerForSession: user activeWorkerId lookup
    resultQueue.push([{ activeWorkerId: WORKER_ID }]);
    // update returning
    mockDb.returning.mockResolvedValueOnce([activeSession]);
    // insert system message returning
    mockDb.returning.mockResolvedValueOnce([mockMessage]);

    const caller = createCaller();
    await caller.session.resume({ sessionId: SESSION_ID });

    expect(enqueueJob).toHaveBeenCalledWith(
      "session.start",
      expect.objectContaining({ sessionId: SESSION_ID, isResume: true }),
      { workerId: WORKER_ID },
    );
  });

  // --- complete: uses session.workerId ---

  it("complete routes stop job to session workerId for active sessions", async () => {
    const activeSessionWithWorker = { ...mockSession, workerId: WORKER_ID, status: "active" };
    const completedSession = { ...activeSessionWithWorker, status: "completed" };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // fetch session
    resultQueue.push([activeSessionWithWorker]);
    // repo ownership check
    resultQueue.push([mockRepo]);
    // update returning
    mockDb.returning.mockResolvedValueOnce([completedSession]);
    // insert system message returning
    mockDb.returning.mockResolvedValueOnce([mockMessage]);

    const caller = createCaller();
    await caller.session.complete({ sessionId: SESSION_ID });

    expect(enqueueJob).toHaveBeenCalledWith(
      "session.stop",
      expect.objectContaining({ sessionId: SESSION_ID, action: "pause" }),
      { workerId: WORKER_ID },
    );
  });
});
