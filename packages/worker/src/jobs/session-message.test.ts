import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerSessionMessageHandler } from "./session-message.js";

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock("../logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@praxis2/shared", () => ({
  SESSION_MESSAGE: "session.message",
}));

vi.mock("./session-start.js", () => ({
  buildPxEnv: vi.fn().mockReturnValue({ PX_CLI: "/mock/px.js", PX_CLI_RUNNER: "node" }),
}));

vi.mock("../sessions/permissions.js", () => ({
  getPermissionArgs: vi.fn().mockReturnValue(["--dangerously-skip-permissions"]),
}));

vi.mock("../sessions/skills.js", () => ({
  getSystemPromptArgs: vi.fn().mockResolvedValue([]),
}));

const mockDownload = vi.fn();
function buildMockStorage() {
  return {
    upload: vi.fn(),
    download: mockDownload,
    delete: vi.fn(),
    getUrl: vi.fn(),
  };
}

const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
vi.mock("node:fs/promises", () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

vi.mock("../sessions/workspace-manager.js", () => ({
  getSessionWorkspace: () => ({ workDir: "/workspace/r1/sessions/s1" }),
}));

// ─── Helpers ────────────────────────────────────────────────────────

const defaultSession = {
  id: "s1",
  type: "working",
  status: "active",
  repoId: "r1",
  entityId: null,
  entityType: null,
  workerId: null,
  claimedBy: null,
  prompt: null,
  metadata: null,
};

const defaultRig = { id: "r1", repo: "owner/repo", name: "test-repo", status: "active", workspacePath: null, bdPrefix: "bd", orgId: "org1" };

function buildMockConnection(opts: {
  session?: typeof defaultSession | null;
  repo?: typeof defaultRig | null;
} = {}) {
  let capturedHandler: ((job: { id: string; data: unknown }) => Promise<void>) | null = null;

  return {
    onJob: vi.fn().mockImplementation(
      (_queueName: string, handler: (job: { id: string; data: unknown }) => Promise<void>) => {
        capturedHandler = handler;
        return Promise.resolve();
      },
    ),
    getSession: vi.fn().mockResolvedValue(opts.session !== undefined ? opts.session : defaultSession),
    getRepo: vi.fn().mockResolvedValue(opts.repo !== undefined ? opts.repo : defaultRig),
    publishSync: vi.fn().mockResolvedValue(undefined),
    getHandler: () => capturedHandler,
  };
}

function buildMockSessionManager() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    sendInput: vi.fn(),
    shutdownAll: vi.fn().mockResolvedValue(undefined),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("session-message handler", () => {
  let connection: ReturnType<typeof buildMockConnection>;
  let sessionManager: ReturnType<typeof buildMockSessionManager>;
  let storage: ReturnType<typeof buildMockStorage>;

  beforeEach(() => {
    vi.clearAllMocks();
    connection = buildMockConnection();
    sessionManager = buildMockSessionManager();
    storage = buildMockStorage();
  });

  it("registers a handler on the session.message queue", async () => {
    await registerSessionMessageHandler(
      connection as any,
      sessionManager as any,
      storage as any,
      "session.message",
    );

    expect(connection.onJob).toHaveBeenCalledWith(
      "session.message",
      expect.any(Function),
    );
  });

  it("forwards ALL session types to sessionManager.sendInput", async () => {
    for (const type of ["spec", "architecture", "debug", "working"] as const) {
      vi.clearAllMocks();
      connection = buildMockConnection({
        session: { ...defaultSession, type, status: "active" },
      });
      await registerSessionMessageHandler(
        connection as any,
        sessionManager as any,
        storage as any,
        "session.message",
      );
      const handler = connection.getHandler()!;

      await handler({
        id: "job-1",
        data: { sessionId: "s1", content: `hello from ${type}` },
      });

      expect(sessionManager.sendInput).toHaveBeenCalledWith(
        "s1",
        `hello from ${type}`,
        expect.objectContaining({ workDir: expect.any(String) }),
      );
    }
  });

  it("sends input without re-persisting user message", async () => {
    await registerSessionMessageHandler(
      connection as any,
      sessionManager as any,
      storage as any,
      "session.message",
    );
    const handler = connection.getHandler()!;

    await handler({
      id: "job-1",
      data: { sessionId: "s1", content: "run tests" },
    });

    // sendInput called with fallback context
    expect(sessionManager.sendInput).toHaveBeenCalledWith(
      "s1",
      "run tests",
      expect.objectContaining({ workDir: expect.any(String) }),
    );
  });

  it("throws when session not found", async () => {
    connection = buildMockConnection({ session: null });
    await registerSessionMessageHandler(
      connection as any,
      sessionManager as any,
      storage as any,
      "session.message",
    );
    const handler = connection.getHandler()!;

    await expect(
      handler({
        id: "job-1",
        data: { sessionId: "s1", content: "hello" },
      }),
    ).rejects.toThrow("Session s1 not found");
  });

  it("throws when session is not active", async () => {
    connection = buildMockConnection({
      session: { ...defaultSession, type: "spec", status: "completed" },
    });
    await registerSessionMessageHandler(
      connection as any,
      sessionManager as any,
      storage as any,
      "session.message",
    );
    const handler = connection.getHandler()!;

    await expect(
      handler({
        id: "job-1",
        data: { sessionId: "s1", content: "hello" },
      }),
    ).rejects.toThrow("Session s1 is not active (status: completed)");
  });

  it("downloads attachments to workspace and augments message", async () => {
    const fileData = Buffer.from("file content");
    mockDownload.mockResolvedValue({ data: fileData });

    await registerSessionMessageHandler(
      connection as any,
      sessionManager as any,
      storage as any,
      "session.message",
    );
    const handler = connection.getHandler()!;

    await handler({
      id: "job-1",
      data: {
        sessionId: "s1",
        content: "check this file",
        attachments: [{
          id: "a1",
          filename: "screenshot.png",
          mimeType: "image/png",
          sizeBytes: 1024,
          storageKey: "s1/uuid/screenshot.png",
        }],
      },
    });

    // Storage download called
    expect(mockDownload).toHaveBeenCalledWith("s1/uuid/screenshot.png");

    // File written to workspace uploads dir
    expect(mockMkdir).toHaveBeenCalledWith(
      "/workspace/r1/sessions/s1/uploads",
      { recursive: true },
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/workspace/r1/sessions/s1/uploads/screenshot.png",
      fileData,
    );

    // Augmented message sent to session with fallback context
    expect(sessionManager.sendInput).toHaveBeenCalledWith(
      "s1",
      expect.stringContaining("uploads/screenshot.png"),
      expect.objectContaining({ workDir: expect.any(String) }),
    );
  });

  it("continues sending message when attachment download fails", async () => {
    mockDownload.mockRejectedValue(new Error("storage error"));

    await registerSessionMessageHandler(
      connection as any,
      sessionManager as any,
      storage as any,
      "session.message",
    );
    const handler = connection.getHandler()!;

    await handler({
      id: "job-1",
      data: {
        sessionId: "s1",
        content: "check this",
        attachments: [{
          id: "a1",
          filename: "file.txt",
          mimeType: "text/plain",
          sizeBytes: 100,
          storageKey: "s1/uuid/file.txt",
        }],
      },
    });

    // Message still sent despite download failure, with fallback context
    expect(sessionManager.sendInput).toHaveBeenCalledWith(
      "s1",
      expect.stringContaining("check this"),
      expect.objectContaining({ workDir: expect.any(String) }),
    );
  });
});
