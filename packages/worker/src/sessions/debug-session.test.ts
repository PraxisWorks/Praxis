import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleDebugSession } from "./debug-session.js";

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock("../logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@praxis2/api/schema", () => ({
  sessions: { id: "sessions.id" },
  sessionMessages: { sessionId: "sessionMessages.sessionId" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
}));

const mockBuildDebugContext = vi.fn();
vi.mock("./build-debug-context.js", () => ({
  buildDebugContext: (...args: unknown[]) => mockBuildDebugContext(...args),
}));

// ─── Helpers ────────────────────────────────────────────────────────

function buildMockDb() {
  const insertReturning = vi.fn().mockResolvedValue([{
    id: "msg-1",
    sessionId: "s1",
    role: "system",
    content: "Debug session started for task: Fix login",
    createdAt: new Date(),
  }]);
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

  return {
    insert: vi.fn().mockReturnValue({ values: insertValues }),
    update: vi.fn().mockReturnValue({ set: updateSet }),
    _insertValues: insertValues,
    _insertReturning: insertReturning,
    _updateSet: updateSet,
    _updateWhere: updateWhere,
  };
}

function buildMockPubsub() {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("handleDebugSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildDebugContext.mockResolvedValue({
      systemPrompt: "You are a debugging assistant...",
      entityTitle: "Fix login",
      entityDescription: "Login page is broken",
    });
  });

  it("writes system message to session_messages", async () => {
    const db = buildMockDb();
    const pubsub = buildMockPubsub();

    await handleDebugSession(db as any, pubsub, {
      sessionId: "s1",
      repoId: "r1",
      entityType: "task",
      entityId: "b1",
    });

    expect(db._insertValues).toHaveBeenCalledWith({
      sessionId: "s1",
      role: "system",
      content: "Debug session started for task: Fix login",
    });
  });

  it("publishes sync event on scoped channel", async () => {
    const db = buildMockDb();
    const pubsub = buildMockPubsub();

    await handleDebugSession(db as any, pubsub, {
      sessionId: "s1",
      repoId: "r1",
      entityType: "task",
      entityId: "b1",
    });

    expect(pubsub.publish).toHaveBeenCalledWith(
      "sync:session:s1:messages",
      expect.objectContaining({
        action: "created",
        data: expect.objectContaining({
          sessionId: "s1",
          role: "system",
        }),
      }),
    );
  });

  it("stores systemPrompt in session metadata", async () => {
    const db = buildMockDb();
    const pubsub = buildMockPubsub();

    await handleDebugSession(db as any, pubsub, {
      sessionId: "s1",
      repoId: "r1",
      entityType: "task",
      entityId: "b1",
    });

    expect(db._updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { systemPrompt: "You are a debugging assistant..." },
      }),
    );
  });

  it("calls buildDebugContext with correct params", async () => {
    const db = buildMockDb();
    const pubsub = buildMockPubsub();

    await handleDebugSession(db as any, pubsub, {
      sessionId: "s1",
      repoId: "r1",
      entityType: "epic",
      entityId: "e1",
    });

    expect(mockBuildDebugContext).toHaveBeenCalledWith(db, {
      repoId: "r1",
      entityType: "epic",
      entityId: "e1",
    });
  });

  it("uses entityType in the system message", async () => {
    mockBuildDebugContext.mockResolvedValue({
      systemPrompt: "...",
      entityTitle: "Auth Epic",
      entityDescription: "Auth work",
    });

    const db = buildMockDb();
    const pubsub = buildMockPubsub();

    await handleDebugSession(db as any, pubsub, {
      sessionId: "s1",
      repoId: "r1",
      entityType: "epic",
      entityId: "e1",
    });

    expect(db._insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Debug session started for epic: Auth Epic",
      }),
    );
  });
});
