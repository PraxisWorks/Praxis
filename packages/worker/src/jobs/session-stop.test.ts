import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerSessionStopHandler } from "./session-stop.js";

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock("../logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@praxis2/shared", () => ({
  SESSION_STOP: "session.stop",
  syncChannel: (entity: string) => `sync:${entity}`,
}));

// ─── Helpers ────────────────────────────────────────────────────────

function buildMockConnection(sessionResult: unknown = null) {
  let capturedHandler: ((job: { id: string; data: unknown }) => Promise<void>) | null = null;

  return {
    onJob: vi.fn().mockImplementation(
      (_name: string, handler: (job: { id: string; data: unknown }) => Promise<void>) => {
        capturedHandler = handler;
        return Promise.resolve();
      },
    ),
    getSession: vi.fn().mockResolvedValue(sessionResult),
    updateSessionStatus: vi.fn().mockResolvedValue(undefined),
    publishSync: vi.fn().mockResolvedValue(undefined),
    getHandler: () => capturedHandler,
  };
}

function buildMockSessionManager() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(0),
    isAlive: vi.fn().mockReturnValue(false),
    sendInput: vi.fn(),
    shutdownAll: vi.fn().mockResolvedValue(undefined),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("session-stop handler", () => {
  let sessionManager: ReturnType<typeof buildMockSessionManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionManager = buildMockSessionManager();
  });

  it("registers a handler on the session.stop queue", async () => {
    const connection = buildMockConnection();
    await registerSessionStopHandler(
      connection as any,
      sessionManager as any,
      "session.stop",
    );

    expect(connection.onJob).toHaveBeenCalledWith(
      "session.stop",
      expect.any(Function),
    );
  });

  it("stops ALL session types via sessionManager.stop", async () => {
    for (const type of ["spec", "architecture", "debug", "working"] as const) {
      vi.clearAllMocks();
      sessionManager = buildMockSessionManager();
      const connection = buildMockConnection(
        { id: "s1", type, status: "active", repoId: "r1" },
      );
      await registerSessionStopHandler(
        connection as any,
        sessionManager as any,
        "session.stop",
      );
      const handler = connection.getHandler()!;

      await handler({ id: "job-1", data: { sessionId: "s1" } });

      // All types go through sessionManager.stop
      expect(sessionManager.stop).toHaveBeenCalledWith("s1");

      // Should mark session as completed
      expect(connection.updateSessionStatus).toHaveBeenCalledWith(
        "s1",
        "completed",
        { clearClaim: true },
      );

      // Should publish sync event
      expect(connection.publishSync).toHaveBeenCalledWith(
        "sync:session",
        expect.objectContaining({
          action: "updated",
          data: { id: "s1", status: "completed" },
        }),
      );
    }
  });

  it("marks session as error when process exits with non-zero code", async () => {
    sessionManager.stop.mockResolvedValue(1);
    const connection = buildMockConnection(
      { id: "s1", type: "working", status: "active", repoId: "r1" },
    );
    await registerSessionStopHandler(
      connection as any,
      sessionManager as any,
      "session.stop",
    );
    const handler = connection.getHandler()!;

    await handler({ id: "job-1", data: { sessionId: "s1" } });

    expect(connection.updateSessionStatus).toHaveBeenCalledWith(
      "s1",
      "error",
      { clearClaim: true },
    );
  });

  it("handles pause action by killing process without updating final status", async () => {
    const connection = buildMockConnection(
      { id: "s1", type: "working", status: "paused", repoId: "r1" },
    );
    await registerSessionStopHandler(
      connection as any,
      sessionManager as any,
      "session.stop",
    );
    const handler = connection.getHandler()!;

    await handler({ id: "job-1", data: { sessionId: "s1", action: "pause" } });

    expect(sessionManager.stop).toHaveBeenCalledWith("s1");
    // Pause clears claimedBy, keeps existing status
    expect(connection.updateSessionStatus).toHaveBeenCalledWith(
      "s1",
      "paused",
      { clearClaim: true },
    );
    expect(connection.publishSync).not.toHaveBeenCalled();
  });

  it("handles pause for conversational session types too", async () => {
    const connection = buildMockConnection(
      { id: "s1", type: "spec", status: "paused", repoId: "r1" },
    );
    await registerSessionStopHandler(
      connection as any,
      sessionManager as any,
      "session.stop",
    );
    const handler = connection.getHandler()!;

    await handler({ id: "job-1", data: { sessionId: "s1", action: "pause" } });

    expect(sessionManager.stop).toHaveBeenCalledWith("s1");
    expect(connection.updateSessionStatus).toHaveBeenCalledWith(
      "s1",
      "paused",
      { clearClaim: true },
    );
  });

  it("gracefully handles missing session by killing orphaned process if alive", async () => {
    sessionManager.isAlive.mockReturnValue(true);
    const connection = buildMockConnection(null);
    await registerSessionStopHandler(
      connection as any,
      sessionManager as any,
      "session.stop",
    );
    const handler = connection.getHandler()!;

    await handler({ id: "job-1", data: { sessionId: "s1" } });

    expect(sessionManager.isAlive).toHaveBeenCalledWith("s1");
    expect(sessionManager.stop).toHaveBeenCalledWith("s1");
    expect(connection.updateSessionStatus).not.toHaveBeenCalled();
  });

  it("gracefully handles missing session with no orphaned process", async () => {
    sessionManager.isAlive.mockReturnValue(false);
    const connection = buildMockConnection(null);
    await registerSessionStopHandler(
      connection as any,
      sessionManager as any,
      "session.stop",
    );
    const handler = connection.getHandler()!;

    await handler({ id: "job-1", data: { sessionId: "s1" } });

    expect(sessionManager.isAlive).toHaveBeenCalledWith("s1");
    expect(sessionManager.stop).not.toHaveBeenCalled();
  });
});
