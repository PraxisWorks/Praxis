import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerSessionStartHandler, buildPxEnv } from "./session-start.js";

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock("../logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@praxis2/shared", () => ({
  SESSION_START: "session.start",
  syncChannel: (entity: string) => `sync:${entity}`,
  ProposalSchema: {
    parse: (data: unknown) => data,
  },
}));

const mockHandleDebugSession = vi.fn().mockResolvedValue(undefined);
vi.mock("../sessions/debug-session.js", () => ({
  handleDebugSession: (...args: unknown[]) =>
    mockHandleDebugSession(...args),
}));

const mockGenerateWorkingPrompt = vi.fn().mockReturnValue("working prompt");
const mockGenerateWorkingInitialMessage = vi.fn().mockReturnValue("working initial message");
const mockGenerateConversationalPrompt = vi.fn().mockReturnValue("conversational prompt");
const mockGenerateInitialMessage = vi.fn().mockReturnValue("initial message");
const mockGenerateResumeMessage = vi.fn().mockReturnValue("default resume message");
vi.mock("../sessions/prompts.js", () => ({
  generateWorkingPrompt: (...args: unknown[]) =>
    mockGenerateWorkingPrompt(...args),
  generateWorkingInitialMessage: (...args: unknown[]) =>
    mockGenerateWorkingInitialMessage(...args),
  generateConversationalPrompt: (...args: unknown[]) =>
    mockGenerateConversationalPrompt(...args),
  generateInitialMessage: (...args: unknown[]) =>
    mockGenerateInitialMessage(...args),
  generateResumeMessage: (...args: unknown[]) =>
    mockGenerateResumeMessage(...args),
}));

vi.mock("../sessions/permissions.js", () => ({
  getPermissionArgs: vi.fn().mockReturnValue(["--dangerously-skip-permissions"]),
}));

vi.mock("../sessions/skills.js", () => ({
  getSystemPromptArgs: vi.fn().mockResolvedValue([]),
}));

vi.mock("../sessions/repo-init.js", () => ({
  ensureRepoInitialized: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../sessions/task-sync.js", () => ({}));

const mockGetSessionWorkspace = vi.fn().mockReturnValue({ workDir: "/tmp/workspace" });
vi.mock("../sessions/workspace-manager.js", () => ({
  getSessionWorkspace: (...args: unknown[]) =>
    mockGetSessionWorkspace(...args),
  ensureSharedClone: vi.fn().mockReturnValue("/tmp/shared-clone"),
}));

vi.mock("../config.js", () => ({
  getConfig: () => ({
    WORKSPACE_ROOT: "/tmp/workspaces",
    WORKER_ID: "worker-1",
    WORKER_NAME: "test-worker",
  }),
}));

// Mock getDb() for code paths that still use it directly (handleDebugSession, etc.)
const mockDbSelectChain = () => {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockImplementation(() => Promise.resolve([]));
  chain.limit = vi.fn().mockImplementation(() => Promise.resolve([]));
  chain.then = (fn: (v: unknown) => unknown) => Promise.resolve([]).then(fn);
  return chain;
};
const mockDb = {
  select: vi.fn().mockImplementation(() => mockDbSelectChain()),
  insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
  update: vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(() => {
        const result = { returning: vi.fn().mockResolvedValue([]) } as any;
        result.then = (fn: any) => Promise.resolve(undefined).then(fn);
        return result;
      }),
    }),
  }),
};
vi.mock("../db.js", () => ({
  getDb: () => mockDb,
}));

// ─── Helpers ────────────────────────────────────────────────────────

function buildMockConnection(overrides?: Partial<Record<string, unknown>>) {
  let capturedHandler: ((job: { id: string; data: unknown }) => Promise<void>) | null = null;

  const connection = {
    onJob: vi.fn().mockImplementation(
      (_queueName: string, handler: (job: { id: string; data: unknown }) => Promise<void>) => {
        capturedHandler = handler;
        return Promise.resolve();
      },
    ),
    getRepo: vi.fn().mockResolvedValue(null),
    getSession: vi.fn().mockResolvedValue(null),
    claimSession: vi.fn().mockResolvedValue(true),
    getTask: vi.fn().mockResolvedValue(null),
    getTaskAncestors: vi.fn().mockResolvedValue([]),
    getTaskDescendants: vi.fn().mockResolvedValue([]),
    getTaskDependencies: vi.fn().mockResolvedValue([]),
    getSpec: vi.fn().mockResolvedValue(null),
    getIdea: vi.fn().mockResolvedValue(null),
    getSessionMessages: vi.fn().mockResolvedValue([]),
    getOrgSessionSettings: vi.fn().mockResolvedValue({ aiInstructions: null, systemInstructions: null }),
    getWorkerRepoInitSettings: vi.fn().mockResolvedValue(null),
    updateSessionStatus: vi.fn().mockResolvedValue(undefined),
    writeMessage: vi.fn().mockResolvedValue("msg-1"),
    publishSync: vi.fn().mockResolvedValue(undefined),
    upsertSpec: vi.fn().mockResolvedValue(undefined),
    getFile: vi.fn().mockResolvedValue({ data: Buffer.from("") }),
    ...overrides,
  };

  return {
    connection,
    getHandler: () => capturedHandler,
  };
}

function buildMockSessionManager() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    sendInput: vi.fn(),
    shutdownAll: vi.fn().mockResolvedValue(undefined),
  };
}

function buildMockStorage() {
  return {
    download: vi.fn().mockResolvedValue({ data: Buffer.from("file-content") }),
    upload: vi.fn().mockResolvedValue(undefined),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("session-start handler", () => {
  let sessionManager: ReturnType<typeof buildMockSessionManager>;
  let storage: ReturnType<typeof buildMockStorage>;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionManager = buildMockSessionManager();
    storage = buildMockStorage();
  });

  it("registers a handler on the session.start queue", async () => {
    const { connection } = buildMockConnection();
    await registerSessionStartHandler(
      connection as any,
      sessionManager as any,
      storage as any,
      "session.start",
    );

    expect(connection.onJob).toHaveBeenCalledWith(
      "session.start",
      expect.any(Function),
    );
  });

  it("starts spec session via CLI with assistant output role", async () => {
    const { connection, getHandler } = buildMockConnection();
    connection.getRepo.mockResolvedValue({ id: "r1", name: "My Rig", repo: null, workspacePath: null, bdPrefix: "TST", orgId: "org-1" });
    connection.getSession.mockResolvedValue({ id: "s1", prompt: null, status: "active", repoId: "r1", type: "spec", entityType: null, entityId: null, workerId: null, claimedBy: null, metadata: null });

    await registerSessionStartHandler(
      connection as any,
      sessionManager as any,
      storage as any,
      "session.start",
    );
    const handler = getHandler()!;

    await handler({
      id: "job-1",
      data: {
        sessionId: "s1",
        repoId: "r1",
        type: "spec",
        entityType: "repo",
      },
    });

    // Should mark session as active
    expect(connection.updateSessionStatus).toHaveBeenCalledWith("s1", "active");

    // Should get workspace path
    expect(mockGetSessionWorkspace).toHaveBeenCalledWith("r1", "s1", "spec", null);

    // Should generate conversational prompt (no skill loaded = empty systemPromptArgs)
    expect(mockGenerateConversationalPrompt).toHaveBeenCalledWith(
      "spec",
      expect.objectContaining({ repoName: "My Rig" }),
    );

    // Should call sessionManager.start with env and options
    expect(sessionManager.start).toHaveBeenCalledWith(
      "s1",
      "conversational prompt",
      "/tmp/workspace",
      undefined,
      expect.objectContaining({
        outputRole: "assistant",
        flushIntervalMs: 2000,
      }),
    );
  });

  it("starts architecture session via CLI", async () => {
    const { connection, getHandler } = buildMockConnection();
    connection.getRepo.mockResolvedValue({ id: "r1", name: "My Rig", repo: "https://github.com/example/repo", workspacePath: null, bdPrefix: "TST", orgId: "org-1" });
    connection.getSession.mockResolvedValue({ id: "s1", prompt: null, status: "active", repoId: "r1", type: "architecture", entityType: "idea", entityId: "i1", workerId: null, claimedBy: null, metadata: null });
    connection.getSpec.mockResolvedValue({ content: "Project spec content" });
    connection.getIdea.mockResolvedValue({ id: "i1", title: "Auth feature", description: "Add OAuth" });

    await registerSessionStartHandler(
      connection as any,
      sessionManager as any,
      storage as any,
      "session.start",
    );
    const handler = getHandler()!;

    await handler({
      id: "job-1",
      data: {
        sessionId: "s1",
        repoId: "r1",
        type: "architecture",
        entityType: "idea",
        entityId: "i1",
      },
    });

    // Should pass git URL to workspace manager
    expect(mockGetSessionWorkspace).toHaveBeenCalledWith(
      "r1", "s1", "architecture", "https://github.com/example/repo",
    );

    // Should generate prompt with context including idea
    expect(mockGenerateConversationalPrompt).toHaveBeenCalledWith(
      "architecture",
      expect.objectContaining({
        repoName: "My Rig",
        spec: "Project spec content",
        ideaTitle: "Auth feature",
        ideaDescription: "Add OAuth",
      }),
    );

    expect(sessionManager.start).toHaveBeenCalled();
  });

  it("starts debug session with entity: calls handleDebugSession first", async () => {
    const { connection, getHandler } = buildMockConnection();
    connection.getRepo.mockResolvedValue({ id: "r1", name: "My Rig", repo: null, workspacePath: null, bdPrefix: "TST", orgId: "org-1" });
    // getSession is called twice: once in startSession, once after handleDebugSession
    connection.getSession
      .mockResolvedValueOnce({ id: "s1", prompt: null, status: "active", repoId: "r1", type: "debug", entityType: "task", entityId: "b1", workerId: null, claimedBy: null, metadata: null })
      .mockResolvedValueOnce({ id: "s1", prompt: null, status: "active", repoId: "r1", type: "debug", entityType: "task", entityId: "b1", workerId: null, claimedBy: null, metadata: { systemPrompt: "Debug system prompt" } });
    connection.getTask.mockResolvedValue({ id: "b1", taskId: "TST-001", title: "Login bug", description: "Fix login", isEpic: false, status: "draft", priority: "high", parentId: null });

    await registerSessionStartHandler(
      connection as any,
      sessionManager as any,
      storage as any,
      "session.start",
    );
    const handler = getHandler()!;

    await handler({
      id: "job-1",
      data: {
        sessionId: "s1",
        repoId: "r1",
        type: "debug",
        entityType: "task",
        entityId: "b1",
      },
    });

    // Should call handleDebugSession first to build context
    expect(mockHandleDebugSession).toHaveBeenCalledWith(
      mockDb,
      { publish: expect.any(Function) },
      {
        sessionId: "s1",
        repoId: "r1",
        entityType: "task",
        entityId: "b1",
      },
    );

    // Should start CLI session
    expect(sessionManager.start).toHaveBeenCalled();
  });

  it("starts debug session without entity (no handleDebugSession call)", async () => {
    const { connection, getHandler } = buildMockConnection();
    connection.getRepo.mockResolvedValue({ id: "r1", name: "My Rig", repo: null, workspacePath: null, bdPrefix: "TST", orgId: "org-1" });
    connection.getSession.mockResolvedValue({ id: "s1", prompt: null, status: "active", repoId: "r1", type: "debug", entityType: null, entityId: null, workerId: null, claimedBy: null, metadata: null });

    await registerSessionStartHandler(
      connection as any,
      sessionManager as any,
      storage as any,
      "session.start",
    );
    const handler = getHandler()!;

    await handler({
      id: "job-1",
      data: {
        sessionId: "s1",
        repoId: "r1",
        type: "debug",
      },
    });

    // Should NOT call handleDebugSession
    expect(mockHandleDebugSession).not.toHaveBeenCalled();

    // Should still start CLI session
    expect(sessionManager.start).toHaveBeenCalled();
  });

  it("starts working session with generated prompt and task context", async () => {
    const { connection, getHandler } = buildMockConnection();
    connection.getRepo.mockResolvedValue({ id: "r1", name: "My Rig", repo: null, workspacePath: "/projects/repo", bdPrefix: "TST", orgId: "org-1" });
    connection.getSession.mockResolvedValue({ id: "s1", prompt: "custom prompt", status: "active", repoId: "r1", type: "working", entityType: "task", entityId: "b1", workerId: null, claimedBy: null, metadata: null });
    connection.getTask.mockResolvedValue({
      id: "b1",
      taskId: "TST-001",
      title: "Fix login",
      description: "Fix the login page",
      isEpic: false,
      status: "draft",
      priority: "high",
      parentId: null,
    });
    connection.getTaskDependencies.mockResolvedValue([]);

    await registerSessionStartHandler(
      connection as any,
      sessionManager as any,
      storage as any,
      "session.start",
    );
    const handler = getHandler()!;

    await handler({
      id: "job-1",
      data: {
        sessionId: "s1",
        repoId: "r1",
        type: "working",
        entityType: "task",
        entityId: "b1",
      },
    });

    // Should call generateWorkingPrompt with task context instead of taskSetupScript
    expect(mockGenerateWorkingPrompt).toHaveBeenCalledWith(
      { prompt: "custom prompt" },
      expect.objectContaining({
        taskId: "TST-001",
        epicId: null,
        title: "Fix login",
        description: "Fix the login page",
        taskContext: expect.any(String),
      }),
      { repoName: "My Rig", projectPath: "/tmp/workspace" },
    );

    // Should call sessionManager.start with px env and options
    expect(sessionManager.start).toHaveBeenCalledWith(
      "s1",
      "working prompt",
      "/tmp/workspace",
      expect.objectContaining({
        PX_CLI_RUNNER: expect.any(String),
        PX_CLI: expect.any(String),
        PX_REPO_ID: "r1",
        PX_SESSION_ID: "s1",
      }),
      expect.objectContaining({
        outputRole: "system",
      }),
    );
  });

  it("throws when repo not found", async () => {
    const { connection, getHandler } = buildMockConnection();
    connection.getRepo.mockResolvedValue(null);

    await registerSessionStartHandler(
      connection as any,
      sessionManager as any,
      storage as any,
      "session.start",
    );
    const handler = getHandler()!;

    await expect(
      handler({
        id: "job-1",
        data: { sessionId: "s1", repoId: "r1", type: "working" },
      }),
    ).rejects.toThrow("Repo r1 not found");

    expect(connection.updateSessionStatus).toHaveBeenCalledWith(
      "s1",
      "error",
      expect.objectContaining({ clearClaim: true }),
    );
  });

  it("sets session to error status on failure and re-throws", async () => {
    sessionManager.start.mockRejectedValueOnce(new Error("CLI spawn failed"));

    const { connection, getHandler } = buildMockConnection();
    connection.getRepo.mockResolvedValue({ id: "r1", name: "My Rig", repo: null, workspacePath: null, bdPrefix: "TST", orgId: "org-1" });
    connection.getSession.mockResolvedValue({ id: "s1", prompt: null, status: "active", repoId: "r1", type: "spec", entityType: null, entityId: null, workerId: null, claimedBy: null, metadata: null });

    await registerSessionStartHandler(
      connection as any,
      sessionManager as any,
      storage as any,
      "session.start",
    );
    const handler = getHandler()!;

    await expect(
      handler({
        id: "job-1",
        data: { sessionId: "s1", repoId: "r1", type: "spec" },
      }),
    ).rejects.toThrow("CLI spawn failed");

    // Error status published
    expect(connection.publishSync).toHaveBeenCalledWith(
      "sync:session",
      expect.objectContaining({
        data: { id: "s1", status: "error" },
      }),
    );
  });

  it("handles isResume by calling sessionManager.resume", async () => {
    const { connection, getHandler } = buildMockConnection();
    connection.getRepo.mockResolvedValue({ id: "r1", name: "My Rig", repo: null, workspacePath: null, bdPrefix: "TST", orgId: "org-1" });
    connection.getSession.mockResolvedValue({ id: "s1", status: "active", type: "working", repoId: "r1", entityType: null, entityId: null, workerId: null, claimedBy: null, metadata: null });

    await registerSessionStartHandler(
      connection as any,
      sessionManager as any,
      storage as any,
      "session.start",
    );
    const handler = getHandler()!;

    await handler({
      id: "job-1",
      data: {
        sessionId: "s1",
        repoId: "r1",
        type: "working",
        isResume: true,
      },
    });

    // Should NOT call sessionManager.start
    expect(sessionManager.start).not.toHaveBeenCalled();

    // Should call sessionManager.resume with sessionId, workDir, px env, and options
    expect(sessionManager.resume).toHaveBeenCalledWith(
      "s1",
      "/tmp/workspace",
      expect.objectContaining({
        PX_CLI_RUNNER: expect.any(String),
        PX_CLI: expect.any(String),
        PX_REPO_ID: "r1",
        PX_SESSION_ID: "s1",
      }),
      expect.objectContaining({
        outputRole: "system",
        flushIntervalMs: 2000,
      }),
    );

    // Should send resume message via sendInput
    expect(sessionManager.sendInput).toHaveBeenCalledWith("s1", expect.any(String));
  });

  it("skips resume when session is no longer active", async () => {
    const { connection, getHandler } = buildMockConnection();
    connection.getRepo.mockResolvedValue({ id: "r1", name: "My Rig", repo: null, workspacePath: null, bdPrefix: "TST", orgId: "org-1" });
    connection.getSession.mockResolvedValue({ id: "s1", status: "completed", type: "working", repoId: "r1", entityType: null, entityId: null, workerId: null, claimedBy: null, metadata: null });

    await registerSessionStartHandler(
      connection as any,
      sessionManager as any,
      storage as any,
      "session.start",
    );
    const handler = getHandler()!;

    await handler({
      id: "job-1",
      data: {
        sessionId: "s1",
        repoId: "r1",
        type: "working",
        isResume: true,
      },
    });

    expect(sessionManager.resume).not.toHaveBeenCalled();
  });

  it("passes custom resumeMessage to sendInput on resume", async () => {
    const { connection, getHandler } = buildMockConnection();
    connection.getRepo.mockResolvedValue({ id: "r1", name: "My Rig", repo: null, workspacePath: null, bdPrefix: "TST", orgId: "org-1" });
    connection.getSession.mockResolvedValue({ id: "s1", status: "active", type: "working", repoId: "r1", entityType: null, entityId: null, workerId: null, claimedBy: null, metadata: null });

    await registerSessionStartHandler(
      connection as any,
      sessionManager as any,
      storage as any,
      "session.start",
    );
    const handler = getHandler()!;

    await handler({
      id: "job-1",
      data: {
        sessionId: "s1",
        repoId: "r1",
        type: "working",
        isResume: true,
        resumeMessage: "Custom resume instruction",
      },
    });

    expect(sessionManager.sendInput).toHaveBeenCalledWith("s1", "Custom resume instruction");
    expect(mockGenerateResumeMessage).not.toHaveBeenCalled();
  });

  it("generates default resume message when no resumeMessage provided", async () => {
    const { connection, getHandler } = buildMockConnection();
    connection.getRepo.mockResolvedValue({ id: "r1", name: "My Rig", repo: null, workspacePath: null, bdPrefix: "TST", orgId: "org-1" });
    connection.getSession.mockResolvedValue({ id: "s1", status: "active", type: "working", repoId: "r1", entityType: "task", entityId: "b1", workerId: null, claimedBy: null, metadata: null });

    await registerSessionStartHandler(
      connection as any,
      sessionManager as any,
      storage as any,
      "session.start",
    );
    const handler = getHandler()!;

    await handler({
      id: "job-1",
      data: {
        sessionId: "s1",
        repoId: "r1",
        type: "working",
        isResume: true,
      },
    });

    expect(mockGenerateResumeMessage).toHaveBeenCalledWith("working", {
      epicId: undefined,
      taskId: "b1",
    });
    expect(sessionManager.sendInput).toHaveBeenCalledWith("s1", "default resume message");
  });

  it("skips resume when session not found", async () => {
    const { connection, getHandler } = buildMockConnection();
    connection.getRepo.mockResolvedValue({ id: "r1", name: "My Rig", repo: null, workspacePath: null, bdPrefix: "TST", orgId: "org-1" });
    connection.getSession.mockResolvedValue(null);

    await registerSessionStartHandler(
      connection as any,
      sessionManager as any,
      storage as any,
      "session.start",
    );
    const handler = getHandler()!;

    await handler({
      id: "job-1",
      data: {
        sessionId: "s1",
        repoId: "r1",
        type: "working",
        isResume: true,
      },
    });

    expect(sessionManager.resume).not.toHaveBeenCalled();
  });

  it("auto-resume failure sets status to paused (not error)", async () => {
    sessionManager.resume.mockRejectedValueOnce(new Error("CLI process failed"));

    const { connection, getHandler } = buildMockConnection();
    connection.getRepo.mockResolvedValue({ id: "r1", name: "My Rig", repo: null, workspacePath: null, bdPrefix: "TST", orgId: "org-1" });
    connection.getSession.mockResolvedValue({ id: "s1", status: "active", type: "working", repoId: "r1", entityType: null, entityId: null, workerId: null, claimedBy: null, metadata: null });

    await registerSessionStartHandler(
      connection as any,
      sessionManager as any,
      storage as any,
      "session.start",
    );
    const handler = getHandler()!;

    await expect(
      handler({
        id: "job-1",
        data: {
          sessionId: "s1",
          repoId: "r1",
          type: "working",
          isResume: true,
          isAutoResume: true,
        },
      }),
    ).rejects.toThrow("CLI process failed");

    // Should set status to 'paused' (not 'error') for auto-resume failure
    expect(connection.updateSessionStatus).toHaveBeenCalledWith(
      "s1",
      "paused",
      expect.objectContaining({ clearClaim: true }),
    );

    // Should publish paused status
    expect(connection.publishSync).toHaveBeenCalledWith(
      "sync:session",
      expect.objectContaining({
        data: { id: "s1", status: "paused" },
      }),
    );

    // System message should mention auto-resume
    expect(connection.writeMessage).toHaveBeenCalledWith(
      "s1",
      "system",
      expect.stringContaining("Auto-resume failed"),
      "test-worker",
    );
  });

  it("user-initiated resume failure sets status to error (no regression)", async () => {
    sessionManager.resume.mockRejectedValueOnce(new Error("CLI process failed"));

    const { connection, getHandler } = buildMockConnection();
    connection.getRepo.mockResolvedValue({ id: "r1", name: "My Rig", repo: null, workspacePath: null, bdPrefix: "TST", orgId: "org-1" });
    connection.getSession.mockResolvedValue({ id: "s1", status: "active", type: "working", repoId: "r1", entityType: null, entityId: null, workerId: null, claimedBy: null, metadata: null });

    await registerSessionStartHandler(
      connection as any,
      sessionManager as any,
      storage as any,
      "session.start",
    );
    const handler = getHandler()!;

    await expect(
      handler({
        id: "job-1",
        data: {
          sessionId: "s1",
          repoId: "r1",
          type: "working",
          isResume: true,
          isAutoResume: false,
        },
      }),
    ).rejects.toThrow("CLI process failed");

    // Should set status to 'error' (existing behavior) for user-initiated resume
    expect(connection.updateSessionStatus).toHaveBeenCalledWith(
      "s1",
      "error",
      expect.objectContaining({ clearClaim: true }),
    );

    // Should publish error status
    expect(connection.publishSync).toHaveBeenCalledWith(
      "sync:session",
      expect.objectContaining({
        data: { id: "s1", status: "error" },
      }),
    );
  });

  it("auto-resume uses correct resume message", async () => {
    const { connection, getHandler } = buildMockConnection();
    connection.getRepo.mockResolvedValue({ id: "r1", name: "My Rig", repo: null, workspacePath: null, bdPrefix: "TST", orgId: "org-1" });
    connection.getSession.mockResolvedValue({ id: "s1", status: "active", type: "working", repoId: "r1", entityType: null, entityId: null, workerId: null, claimedBy: null, metadata: null });

    await registerSessionStartHandler(
      connection as any,
      sessionManager as any,
      storage as any,
      "session.start",
    );
    const handler = getHandler()!;

    await handler({
      id: "job-1",
      data: {
        sessionId: "s1",
        repoId: "r1",
        type: "working",
        isResume: true,
        isAutoResume: true,
      },
    });

    // Should send the auto-resume specific message
    expect(sessionManager.sendInput).toHaveBeenCalledWith(
      "s1",
      "Continue where you left off. The worker was restarted.",
    );
    // Should NOT call generateResumeMessage
    expect(mockGenerateResumeMessage).not.toHaveBeenCalled();
  });

  it("when autoAccept is true in payload, PX_AUTO_ACCEPT is in the env vars passed to sessionManager.start", async () => {
    const { connection, getHandler } = buildMockConnection();
    connection.getRepo.mockResolvedValue({ id: "r1", name: "My Rig", repo: "https://github.com/example/repo", workspacePath: null, bdPrefix: "TST", orgId: "org-1" });
    connection.getSession.mockResolvedValue({ id: "s1", prompt: null, status: "active", repoId: "r1", type: "architecture", entityType: "idea", entityId: "i1", workerId: null, claimedBy: null, metadata: null });
    connection.getSpec.mockResolvedValue({ content: "Project spec content" });
    connection.getIdea.mockResolvedValue({ id: "i1", title: "Auth feature", description: "Add OAuth" });

    await registerSessionStartHandler(
      connection as any,
      sessionManager as any,
      storage as any,
      "session.start",
    );
    const handler = getHandler()!;

    await handler({
      id: "job-1",
      data: {
        sessionId: "s1",
        repoId: "r1",
        type: "architecture",
        entityType: "idea",
        entityId: "i1",
        autoAccept: true,
      },
    });

    // sessionManager.start should be called with env (4th arg) containing PX_AUTO_ACCEPT
    expect(sessionManager.start).toHaveBeenCalledWith(
      "s1",
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        PX_AUTO_ACCEPT: "true",
      }),
      expect.any(Object),
    );
  });

  it("auto-resume failure without isAutoResume defaults to error behavior", async () => {
    sessionManager.resume.mockRejectedValueOnce(new Error("CLI process failed"));

    const { connection, getHandler } = buildMockConnection();
    connection.getRepo.mockResolvedValue({ id: "r1", name: "My Rig", repo: null, workspacePath: null, bdPrefix: "TST", orgId: "org-1" });
    connection.getSession.mockResolvedValue({ id: "s1", status: "active", type: "working", repoId: "r1", entityType: null, entityId: null, workerId: null, claimedBy: null, metadata: null });

    await registerSessionStartHandler(
      connection as any,
      sessionManager as any,
      storage as any,
      "session.start",
    );
    const handler = getHandler()!;

    await expect(
      handler({
        id: "job-1",
        data: {
          sessionId: "s1",
          repoId: "r1",
          type: "working",
          isResume: true,
          // isAutoResume NOT set (undefined) — should default to error behavior
        },
      }),
    ).rejects.toThrow("CLI process failed");

    // When isAutoResume is undefined (not set), should default to 'error' (existing behavior)
    expect(connection.updateSessionStatus).toHaveBeenCalledWith(
      "s1",
      "error",
      expect.objectContaining({ clearClaim: true }),
    );

    // Should publish error status (not paused)
    expect(connection.publishSync).toHaveBeenCalledWith(
      "sync:session",
      expect.objectContaining({
        data: { id: "s1", status: "error" },
      }),
    );
  });
});

// ─── buildPxEnv Unit Tests ───────────────────────────────────────────

describe("buildPxEnv", () => {
  it("returns PX_CLI ending with /cli/praxis.ts and PX_CLI_RUNNER=tsx in dev mode", () => {
    // In test (dev) mode, the source file ends in .ts so should derive cli/praxis.ts
    const env = buildPxEnv({
      repoId: "repo-1",
      sessionId: "sess-1",
    });

    expect(env.PX_CLI).toMatch(/\/cli\/praxis\.ts$/);
    expect(env.PX_CLI_RUNNER).toBe("tsx");
    expect(env.PX_REPO_ID).toBe("repo-1");
    expect(env.PX_SESSION_ID).toBe("sess-1");
  });

  it("does not include PX_IDEA_ID when entityId is undefined", () => {
    const env = buildPxEnv({
      repoId: "repo-1",
      sessionId: "sess-1",
    });

    expect(env.PX_IDEA_ID).toBeUndefined();
  });

  it("includes PX_IDEA_ID when entityId is provided", () => {
    const env = buildPxEnv({
      entityId: "idea-1",
      repoId: "repo-1",
      sessionId: "sess-1",
    });

    expect(env.PX_IDEA_ID).toBe("idea-1");
  });

  it("includes PX_AUTO_ACCEPT when autoAccept is true", () => {
    const env = buildPxEnv({
      repoId: "repo-1",
      sessionId: "sess-1",
      autoAccept: true,
    });

    expect(env.PX_AUTO_ACCEPT).toBe("true");
  });

  it("does not include PX_AUTO_ACCEPT when autoAccept is false or omitted", () => {
    const envOmitted = buildPxEnv({
      repoId: "repo-1",
      sessionId: "sess-1",
    });
    expect(envOmitted.PX_AUTO_ACCEPT).toBeUndefined();

    const envFalse = buildPxEnv({
      repoId: "repo-1",
      sessionId: "sess-1",
      autoAccept: false,
    });
    expect(envFalse.PX_AUTO_ACCEPT).toBeUndefined();
  });

  it("derives correct path structure: PX_CLI path replaces /jobs/session-start with /cli/praxis", () => {
    const env = buildPxEnv({ repoId: "r", sessionId: "s" });

    // The path should NOT contain /jobs/ — it should have navigated from jobs/ to cli/
    expect(env.PX_CLI).not.toMatch(/\/jobs\//);
    expect(env.PX_CLI).toMatch(/\/cli\/praxis\.(ts|js)$/);
  });

  it("dev path resolves from src/jobs/session-start.ts to src/cli/praxis.ts", () => {
    // Since tests run in dev mode (.ts), import.meta.url resolves to the .ts source
    const env = buildPxEnv({ repoId: "r", sessionId: "s" });

    // The resolved path should contain /src/cli/praxis.ts (dev layout)
    expect(env.PX_CLI).toMatch(/\/src\/cli\/praxis\.ts$/);
  });
});
