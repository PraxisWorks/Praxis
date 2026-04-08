import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startConversationalSession,
  handleConversationalMessage,
  stopConversationalSession,
  getConversationHistory,
  loadSessionContext,
  _getActiveSessions,
  resolveModelId,
} from "./conversational.js";

// ─── Mock Anthropic SDK ─────────────────────────────────────────────

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
  };
});

// ─── Mock config & logger ───────────────────────────────────────────

vi.mock("../config.js", () => ({
  getConfig: () => ({
    ANTHROPIC_API_KEY: "sk-ant-test-key",
    CLAUDE_MODEL: "opus",
  }),
}));

const mockLoggerWarn = vi.fn();
const mockLoggerInfo = vi.fn();

vi.mock("../logger.js", () => ({
  getLogger: () => ({
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: vi.fn(),
  }),
}));

// ─── Mock DB helpers ────────────────────────────────────────────────

/**
 * Build a chainable mock DB with configurable select results.
 *
 * `selectResults` is a list of row-arrays; each call to the terminal
 * `.limit()` / `.orderBy()` chain pops the next result off the front.
 */
function buildMockDb(selectResults: unknown[][] = [[]]) {
  const results = [...selectResults];
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn();
  const updateWhere = vi.fn().mockResolvedValue(undefined);

  updateSet.mockReturnValue({ where: updateWhere });

  const makeSelectChain = () => {
    const resolve = () => {
      const next = results.shift() ?? [];
      return Promise.resolve(next);
    };

    // Terminal methods that trigger resolution
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.orderBy = vi.fn().mockImplementation(() => resolve());
    chain.limit = vi.fn().mockImplementation(() => resolve());
    // If the chain is awaited without .limit() / .orderBy(), resolve
    chain.then = (fn: (v: unknown) => unknown) => resolve().then(fn);
    return chain;
  };

  return {
    select: vi.fn().mockImplementation(() => makeSelectChain()),
    insert: vi.fn().mockReturnValue({ values: insertValues }),
    update: vi.fn().mockReturnValue({ set: updateSet }),
    // expose spies for assertions
    _insertValues: insertValues,
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

describe("conversational session engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear the activeSessions map between tests
    const map = _getActiveSessions();
    map.clear();
  });

  afterEach(() => {
    const map = _getActiveSessions();
    map.clear();
  });

  // ─── resolveModelId ────────────────────────────────────────────

  describe("resolveModelId", () => {
    it("maps 'opus' to full Anthropic model ID", () => {
      expect(resolveModelId("opus")).toBe("claude-opus-4-20250514");
    });

    it("maps 'sonnet' to full Anthropic model ID", () => {
      expect(resolveModelId("sonnet")).toBe("claude-sonnet-4-20250514");
    });

    it("passes through unknown aliases unchanged", () => {
      expect(resolveModelId("claude-custom-model")).toBe("claude-custom-model");
    });
  });

  // ─── startConversationalSession ─────────────────────────────────

  describe("startConversationalSession", () => {
    it("sends initial message with correct system prompt for spec type", async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "Welcome! Let's define your project." }],
      });

      const db = buildMockDb([
        // session metadata check (no systemPrompt stored)
        [{ metadata: null }],
        // repo lookup
        [{ name: "my-repo" }],
        // spec lookup
        [],
      ]);
      const pubsub = buildMockPubsub();

      await startConversationalSession(db as any, pubsub, {
        sessionId: "s1",
        repoId: "r1",
        type: "spec",
      });

      // Anthropic called with system prompt containing "project specification"
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.system).toContain("project specification");
      expect(callArgs.messages).toEqual([
        { role: "user", content: "Begin the session." },
      ]);

      // DB insert includes assistant message
      expect(db._insertValues).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            sessionId: "s1",
            role: "assistant",
            content: "Welcome! Let's define your project.",
          }),
        ]),
      );

      // Sync published on scoped channel
      expect(pubsub.publish).toHaveBeenCalledWith(
        "sync:session:s1:messages",
        expect.objectContaining({
          action: "created",
          data: expect.objectContaining({
            sessionId: "s1",
            role: "assistant",
            content: "Welcome! Let's define your project.",
          }),
        }),
      );
    });

    it("loads repo and spec context for the system prompt", async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "Hi!" }],
      });

      const db = buildMockDb([
        // session metadata check (no systemPrompt stored)
        [{ metadata: null }],
        // repo lookup
        [{ name: "Acme App" }],
        // spec lookup
        [{ content: "# Existing Spec\nSome content" }],
      ]);
      const pubsub = buildMockPubsub();

      await startConversationalSession(db as any, pubsub, {
        sessionId: "s2",
        repoId: "r2",
        type: "spec",
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.system).toContain("Acme App");
      expect(callArgs.system).toContain("# Existing Spec");
    });

    it("loads idea context for architecture type", async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "Let's plan this." }],
      });

      const db = buildMockDb([
        // session metadata check (no systemPrompt stored)
        [{ metadata: null }],
        // repo lookup
        [{ name: "My Repo" }],
        // spec lookup
        [{ content: "Spec content" }],
        // idea lookup
        [{ title: "Auth Feature", description: "Add OAuth login" }],
      ]);
      const pubsub = buildMockPubsub();

      await startConversationalSession(db as any, pubsub, {
        sessionId: "s3",
        repoId: "r3",
        type: "architecture",
        entityType: "idea",
        entityId: "i1",
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.system).toContain("Auth Feature");
      expect(callArgs.system).toContain("Add OAuth login");
    });
  });

  // ─── handleConversationalMessage ────────────────────────────────

  describe("handleConversationalMessage", () => {
    it("loads history and sends full conversation to Anthropic", async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "Good question!" }],
      });

      // History includes the user message already persisted by the API
      const historyRows = [
        { role: "system", content: "Session started. Type: spec", createdAt: new Date("2026-01-01T00:00:00Z") },
        { role: "user", content: "msg1", createdAt: new Date("2026-01-01T00:01:00Z") },
        { role: "assistant", content: "reply1", createdAt: new Date("2026-01-01T00:02:00Z") },
        { role: "user", content: "msg2", createdAt: new Date("2026-01-01T00:03:00Z") },
        { role: "user", content: "new user message", createdAt: new Date("2026-01-01T00:04:00Z") },
      ];

      const db = buildMockDb([
        // session metadata check (no systemPrompt stored)
        [{ metadata: null }],
        // loadSessionContext: repo
        [{ name: "Test Repo" }],
        // loadSessionContext: spec
        [],
        // getConversationHistory (returns via orderBy, not limit)
        // Includes the user message already persisted by the API
        historyRows,
      ]);
      const pubsub = buildMockPubsub();

      await handleConversationalMessage(db as any, pubsub, {
        sessionId: "s1",
        repoId: "r1",
        sessionType: "spec",
        content: "new user message",
      });

      const callArgs = mockCreate.mock.calls[0][0];
      // History returns all 4 user/assistant messages (system filtered out)
      expect(callArgs.messages).toHaveLength(4);
      expect(callArgs.messages[0]).toEqual({ role: "user", content: "msg1" });
      expect(callArgs.messages[1]).toEqual({ role: "assistant", content: "reply1" });
      expect(callArgs.messages[2]).toEqual({ role: "user", content: "msg2" });
      expect(callArgs.messages[3]).toEqual({ role: "user", content: "new user message" });

      // User message is NOT written here (API already persisted it)
      // Only the assistant response should be inserted
      expect(db._insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "s1",
          role: "assistant",
          content: "Good question!",
        }),
      );
    });

    it("detects and saves spec output", async () => {
      const specContent = "# My Spec\n\nPurpose: Build a tool.";
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: `Here is your spec:\n\`\`\`spec\n${specContent}\`\`\`` }],
      });

      const db = buildMockDb([
        // session metadata check (no systemPrompt stored)
        [{ metadata: null }],
        // loadSessionContext: repo
        [{ name: "R" }],
        // loadSessionContext: spec
        [],
        // getConversationHistory
        [],
        // checkForOutputs: existing spec lookup
        [],
      ]);
      const pubsub = buildMockPubsub();

      await handleConversationalMessage(db as any, pubsub, {
        sessionId: "s1",
        repoId: "r1",
        sessionType: "spec",
        content: "Please finalize",
      });

      // Insert new spec
      expect(db._insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          repoId: "r1",
          title: "Project Spec",
          content: specContent,
        }),
      );

      // Sync published for spec
      expect(pubsub.publish).toHaveBeenCalledWith(
        "sync:spec",
        expect.objectContaining({
          action: "created",
          data: { repoId: "r1" },
        }),
      );
    });

    it("detects and saves proposal output for architecture sessions", async () => {
      const proposal = { epics: [{ key: "e1", title: "E1", description: "Epic 1", tasks: [{ key: "b1", title: "Setup", description: "Initial setup", priority: "high", dependsOn: [] }] }] };
      const proposalJson = JSON.stringify(proposal);
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: `Done!\n\`\`\`proposal\n${proposalJson}\n\`\`\`` }],
      });

      const db = buildMockDb([
        // session metadata check (no systemPrompt stored)
        [{ metadata: null }],
        // loadSessionContext: repo
        [{ name: "R" }],
        // loadSessionContext: spec
        [],
        // getConversationHistory
        [],
        // checkForOutputs: session lookup (to get entityId)
        [{ entityId: "idea-123" }],
      ]);
      const pubsub = buildMockPubsub();

      await handleConversationalMessage(db as any, pubsub, {
        sessionId: "s1",
        repoId: "r1",
        sessionType: "architecture",
        content: "Looks good, finalize",
      });

      // plan inserted (second insert call — first is the assistant message)
      expect(db._insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          ideaId: "idea-123",
          repoId: "r1",
          sessionId: "s1",
          proposal,
          status: "draft",
        }),
      );

      // idea status updated to planning
      expect(db._updateSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: "planning" }),
      );

      // Sync published for plan
      expect(pubsub.publish).toHaveBeenCalledWith(
        "sync:plan",
        expect.objectContaining({
          action: "created",
          data: { ideaId: "idea-123", repoId: "r1" },
        }),
      );

      // Follow-up friendly message inserted
      expect(db._insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "s1",
          role: "assistant",
          content: expect.stringContaining("plan proposal"),
        }),
      );
    });

    it("handles invalid proposal JSON gracefully", async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "```proposal\nnot-valid-json\n```" }],
      });

      const db = buildMockDb([
        // session metadata check (no systemPrompt stored)
        [{ metadata: null }],
        // loadSessionContext: repo
        [{ name: "R" }],
        // loadSessionContext: spec
        [],
        // getConversationHistory
        [],
      ]);
      const pubsub = buildMockPubsub();

      // Should NOT throw
      await handleConversationalMessage(db as any, pubsub, {
        sessionId: "s1",
        repoId: "r1",
        sessionType: "architecture",
        content: "finalize",
      });

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        "Failed to parse proposal JSON from assistant message",
      );
    });
  });

  // ─── stopConversationalSession ──────────────────────────────────

  describe("stopConversationalSession", () => {
    it("aborts the abort controller for the session", async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "Hello" }],
      });

      const db = buildMockDb([
        // session metadata check
        [{ metadata: null }],
        [{ name: "R" }],
        [],
      ]);
      const pubsub = buildMockPubsub();

      await startConversationalSession(db as any, pubsub, {
        sessionId: "s1",
        repoId: "r1",
        type: "spec",
      });

      const map = _getActiveSessions();
      expect(map.has("s1")).toBe(true);
      const controller = map.get("s1")!;

      await stopConversationalSession(db as any, pubsub, "s1");

      expect(controller.signal.aborted).toBe(true);
      expect(map.has("s1")).toBe(false);
    });
  });

  // ─── getConversationHistory ─────────────────────────────────────

  describe("getConversationHistory", () => {
    it("returns only user and assistant messages, ordered by createdAt", async () => {
      const rows = [
        { role: "system", content: "Session started", createdAt: new Date("2026-01-01T00:00:00Z") },
        { role: "user", content: "Hello", createdAt: new Date("2026-01-01T00:01:00Z") },
        { role: "assistant", content: "Hi there", createdAt: new Date("2026-01-01T00:02:00Z") },
        { role: "system", content: "internal note", createdAt: new Date("2026-01-01T00:03:00Z") },
        { role: "user", content: "Question", createdAt: new Date("2026-01-01T00:04:00Z") },
        { role: "assistant", content: "Answer", createdAt: new Date("2026-01-01T00:05:00Z") },
      ];

      const db = buildMockDb([rows]);
      const result = await getConversationHistory(db as any, "s1");

      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({ role: "user", content: "Hello" });
      expect(result[1]).toEqual({ role: "assistant", content: "Hi there" });
      expect(result[2]).toEqual({ role: "user", content: "Question" });
      expect(result[3]).toEqual({ role: "assistant", content: "Answer" });
    });
  });

  // ─── loadSessionContext ─────────────────────────────────────────

  describe("loadSessionContext", () => {
    it("returns repo name as Unknown when repo not found", async () => {
      const db = buildMockDb([
        [], // repo lookup: empty
        [], // spec lookup: empty
      ]);
      const ctx = await loadSessionContext(db as any, { repoId: "nonexistent" });
      expect(ctx.repoName).toBe("Unknown");
    });

    it("loads task context for epic entity type", async () => {
      const db = buildMockDb([
        [{ name: "Test Repo" }], // repo
        [],                      // spec
        [{ title: "Fix login", description: "Login page is broken" }], // task
      ]);
      const ctx = await loadSessionContext(db as any, {
        repoId: "r1",
        entityType: "epic",
        entityId: "b1",
      });
      expect(ctx.entityTitle).toBe("Fix login");
      expect(ctx.entityType).toBe("epic");
      expect(ctx.entityDescription).toBe("Login page is broken");
    });
  });
});
