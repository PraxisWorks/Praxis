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

import { appRouter } from "./index.js";

describe("ideaPhaseRouter", () => {
  const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
  const IDEA_ID = "660e8400-e29b-41d4-a716-446655440001";
  const SESSION_ID = "880e8400-e29b-41d4-a716-446655440003";

  const mockPhase1 = {
    id: "aa0e8400-e29b-41d4-a716-446655440010",
    ideaId: IDEA_ID,
    sessionId: SESSION_ID,
    phaseNumber: 1,
    phaseName: "Specification",
    content: "Phase 1 content",
    createdAt: new Date(),
  };

  const mockPhase2 = {
    id: "aa0e8400-e29b-41d4-a716-446655440011",
    ideaId: IDEA_ID,
    sessionId: SESSION_ID,
    phaseNumber: 2,
    phaseName: "Pseudocode",
    content: "Phase 2 content",
    createdAt: new Date(),
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
  });

  // --- list ---

  it("list returns phases ordered by phaseNumber", async () => {
    resultQueue.push([{ id: USER_ID }]); // lookupUserId (protectedProcedure middleware)
    resultQueue.push([{ id: IDEA_ID, userId: USER_ID }]); // idea ownership check
    mockDb.orderBy.mockResolvedValueOnce([mockPhase1, mockPhase2]); // phases query

    const caller = createCaller(true);
    const result = await caller.ideaPhase.list({ ideaId: IDEA_ID });

    expect(result).toEqual([mockPhase1, mockPhase2]);
  });

  it("list returns empty array when no phases exist", async () => {
    resultQueue.push([{ id: USER_ID }]); // lookupUserId
    resultQueue.push([{ id: IDEA_ID, userId: USER_ID }]); // idea ownership check
    mockDb.orderBy.mockResolvedValueOnce([]); // no phases

    const caller = createCaller(true);
    const result = await caller.ideaPhase.list({ ideaId: IDEA_ID });

    expect(result).toEqual([]);
  });

  it("list throws NOT_FOUND if idea does not belong to user", async () => {
    resultQueue.push([{ id: USER_ID }]); // lookupUserId
    resultQueue.push([]); // idea not found (ownership check fails)

    const caller = createCaller(true);
    await expect(caller.ideaPhase.list({ ideaId: IDEA_ID })).rejects.toThrow(
      "Idea not found",
    );
  });

  it("list requires auth", async () => {
    const caller = createCaller(false);
    await expect(caller.ideaPhase.list({ ideaId: IDEA_ID })).rejects.toThrow(
      "UNAUTHORIZED",
    );
  });
});
