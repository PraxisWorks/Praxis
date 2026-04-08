import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/env.js", () => ({
  getEnv: vi.fn(() => ({
    DATABASE_URL: "postgresql://mock",
    AUTH0_ISSUER_BASE_URL: "https://example.auth0.com",
    AUTH0_AUDIENCE: "https://api.example.com",
    PORT: "3001",
    CORS_ORIGIN: "http://localhost:3000",
    RATE_LIMIT_MAX: "100",
    NODE_ENV: "development",
    LOG_LEVEL: "info",
  })),
}));

vi.mock("../../lib/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

const mockPubsub = {
  publish: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../../pubsub.js", () => ({
  PgPubSub: vi.fn().mockImplementation(() => mockPubsub),
}));

let insertResult: unknown[] = [];
let selectResult: unknown[] = [];

const mockDb = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(() => Promise.resolve(insertResult)),
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn(() => Promise.resolve(selectResult)),
  limit: vi.fn(() => Promise.resolve(selectResult)),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
};

vi.mock("../../db/index.js", () => ({
  getConnectionString: vi.fn(() => "postgresql://mock"),
  getDb: vi.fn(() => mockDb),
}));

import {
  handleSpecSessionStart,
  handleSpecSessionMessage,
  extractAndSaveSpec,
  generateStubResponse,
} from "./specSession.js";

describe("specSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertResult = [
      {
        id: "msg-1",
        sessionId: "sess-1",
        role: "assistant",
        content: "test",
        createdAt: new Date(),
      },
    ];
    selectResult = [];
  });

  describe("generateStubResponse", () => {
    it("returns phase 2 prompt when no user messages in history", () => {
      const history = [
        { role: "system", content: "You are a spec assistant..." },
        { role: "assistant", content: "Let's create a spec..." },
      ];

      const result = generateStubResponse(history, "It's a todo app");

      expect(result).toContain("Thanks for the overview!");
      expect(result).toContain("Target Users");
    });

    it("returns phase 3 prompt after 1 user message in history", () => {
      const history = [
        { role: "system", content: "prompt" },
        { role: "assistant", content: "opening" },
        { role: "user", content: "overview" },
        { role: "assistant", content: "ack 1" },
      ];

      const result = generateStubResponse(history, "developers and designers");

      expect(result).toContain("I understand the target users");
      expect(result).toContain("Constraints");
    });

    it("returns phase 4 prompt after 2 user messages in history", () => {
      const history = [
        { role: "system", content: "prompt" },
        { role: "assistant", content: "opening" },
        { role: "user", content: "overview" },
        { role: "assistant", content: "ack 1" },
        { role: "user", content: "users" },
        { role: "assistant", content: "ack 2" },
      ];

      const result = generateStubResponse(history, "tight budget");

      expect(result).toContain("Noted on the constraints");
      expect(result).toContain("Tech Stack");
    });

    it("returns phase 5 prompt after 3 user messages in history", () => {
      const history = [
        { role: "system", content: "prompt" },
        { role: "assistant", content: "opening" },
        { role: "user", content: "overview" },
        { role: "assistant", content: "ack 1" },
        { role: "user", content: "users" },
        { role: "assistant", content: "ack 2" },
        { role: "user", content: "constraints" },
        { role: "assistant", content: "ack 3" },
      ];

      const result = generateStubResponse(history, "React + Node");

      expect(result).toContain("Got it on the tech stack");
      expect(result).toContain("Boundaries");
    });

    it("generates spec summary after all phases are covered", () => {
      const history = [
        { role: "system", content: "prompt" },
        { role: "assistant", content: "opening" },
        { role: "user", content: "overview" },
        { role: "assistant", content: "ack 1" },
        { role: "user", content: "users" },
        { role: "assistant", content: "ack 2" },
        { role: "user", content: "constraints" },
        { role: "assistant", content: "ack 3" },
        { role: "user", content: "tech stack" },
        { role: "assistant", content: "ack 4" },
      ];

      const result = generateStubResponse(history, "v1 scope details");

      expect(result).toContain("Project Specification");
      expect(result).toContain("v1 scope details");
      expect(result).toContain("The spec is ready");
    });

    it("handles empty user content gracefully", () => {
      const history = [
        { role: "system", content: "prompt" },
        { role: "assistant", content: "opening" },
      ];

      const result = generateStubResponse(history, "");

      expect(result).toContain("Thanks for the overview!");
      expect(result).toContain("Target Users");
    });

    it("handles empty history gracefully", () => {
      const result = generateStubResponse([], "hello");

      expect(result).toContain("Thanks for the overview!");
      expect(result).toContain("Target Users");
    });
  });

  describe("handleSpecSessionStart", () => {
    it("writes system prompt and opening assistant message", async () => {
      await handleSpecSessionStart("sess-1");

      // Should have inserted twice: system prompt + assistant opening
      expect(mockDb.insert).toHaveBeenCalledTimes(2);
      expect(mockDb.values).toHaveBeenCalledTimes(2);

      // First call: system message
      const firstCall = mockDb.values.mock.calls[0][0];
      expect(firstCall.role).toBe("system");
      expect(firstCall.sessionId).toBe("sess-1");

      // Second call: assistant message
      const secondCall = mockDb.values.mock.calls[1][0];
      expect(secondCall.role).toBe("assistant");
      expect(secondCall.sessionId).toBe("sess-1");
      expect(secondCall.content).toContain("Project Overview");
    });

    it("publishes sync events for each message written", async () => {
      await handleSpecSessionStart("sess-1");

      // Two messages = two publish calls on the session messages channel
      expect(mockPubsub.publish).toHaveBeenCalledTimes(2);
      expect(mockPubsub.publish).toHaveBeenCalledWith(
        "sync:session:sess-1:messages",
        expect.objectContaining({ action: "created" }),
      );
    });

    it("updates session updatedAt for each message", async () => {
      await handleSpecSessionStart("sess-1");

      // Two messages = two session updates
      expect(mockDb.update).toHaveBeenCalledTimes(2);
      expect(mockDb.set).toHaveBeenCalledTimes(2);
    });
  });

  describe("handleSpecSessionMessage", () => {
    it("loads history, generates response, and writes assistant message", async () => {
      // Conversation history: system prompt + assistant opening (no user messages yet)
      selectResult = [
        { role: "system", content: "You are a spec assistant..." },
        { role: "assistant", content: "Let's create a spec..." },
      ];

      await handleSpecSessionMessage("sess-1", "It's a todo app for developers");

      // Should insert the assistant response
      expect(mockDb.insert).toHaveBeenCalled();
      const insertedMessage = mockDb.values.mock.calls[0][0];
      expect(insertedMessage.role).toBe("assistant");
      expect(insertedMessage.sessionId).toBe("sess-1");
      // The stub response should acknowledge and ask about target users
      expect(insertedMessage.content).toContain("Target Users");
    });

    it("generates spec summary after all phases", async () => {
      // Simulate 4 user messages already in history (all phases covered)
      selectResult = [
        { role: "system", content: "prompt" },
        { role: "assistant", content: "opening" },
        { role: "user", content: "overview" },
        { role: "assistant", content: "ack 1" },
        { role: "user", content: "users" },
        { role: "assistant", content: "ack 2" },
        { role: "user", content: "constraints" },
        { role: "assistant", content: "ack 3" },
        { role: "user", content: "tech stack" },
        { role: "assistant", content: "ack 4" },
      ];

      await handleSpecSessionMessage("sess-1", "v1 scope details");

      const insertedMessage = mockDb.values.mock.calls[0][0];
      expect(insertedMessage.content).toContain("Project Specification");
    });

    it("publishes sync event after writing response", async () => {
      selectResult = [
        { role: "system", content: "prompt" },
        { role: "assistant", content: "opening" },
      ];

      await handleSpecSessionMessage("sess-1", "My project idea");

      expect(mockPubsub.publish).toHaveBeenCalledWith(
        "sync:session:sess-1:messages",
        expect.objectContaining({ action: "created" }),
      );
    });
  });

  describe("extractAndSaveSpec", () => {
    it("extracts last assistant message and creates a new spec", async () => {
      // Mock: load messages returns conversation with a final spec
      selectResult = [
        { role: "system", content: "prompt" },
        { role: "assistant", content: "opening" },
        { role: "user", content: "overview" },
        { role: "assistant", content: "# Project Specification\n\nFinal spec content" },
      ];

      // Mock: no existing spec (limit returns empty)
      let limitCallCount = 0;
      mockDb.limit.mockImplementation(() => {
        limitCallCount++;
        if (limitCallCount === 1) {
          // No existing spec
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });

      // Mock: insert spec returns the created spec
      insertResult = [
        {
          id: "spec-1",
          repoId: "repo-1",
          title: "Project Specification",
          content: "# Project Specification\n\nFinal spec content",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      await extractAndSaveSpec("sess-1", "repo-1");

      // Should insert the spec
      expect(mockDb.insert).toHaveBeenCalled();
      const insertedSpec = mockDb.values.mock.calls[0][0];
      expect(insertedSpec.repoId).toBe("repo-1");
      expect(insertedSpec.title).toBe("Project Specification");
      expect(insertedSpec.content).toContain("Project Specification");

      // Should publish sync event
      expect(mockPubsub.publish).toHaveBeenCalledWith(
        "sync:spec",
        expect.objectContaining({ action: "created" }),
      );
    });

    it("updates existing spec if one already exists for the repo", async () => {
      selectResult = [
        { role: "system", content: "prompt" },
        { role: "assistant", content: "Updated spec content" },
      ];

      // Mock: existing spec found
      mockDb.limit.mockResolvedValueOnce([
        {
          id: "spec-existing",
          repoId: "repo-1",
          title: "Old Spec",
          content: "old content",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      // Mock: update returns the updated spec
      mockDb.returning.mockResolvedValueOnce([
        {
          id: "spec-existing",
          repoId: "repo-1",
          title: "Project Specification",
          content: "Updated spec content",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      await extractAndSaveSpec("sess-1", "repo-1");

      // Should update, not insert
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Project Specification",
          content: "Updated spec content",
        }),
      );

      // Should publish sync event as "updated"
      expect(mockPubsub.publish).toHaveBeenCalledWith(
        "sync:spec",
        expect.objectContaining({ action: "updated" }),
      );
    });

    it("does nothing if no assistant messages found", async () => {
      selectResult = [
        { role: "system", content: "prompt" },
        { role: "user", content: "hello" },
      ];

      await extractAndSaveSpec("sess-1", "repo-1");

      // Should not insert or update
      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockPubsub.publish).not.toHaveBeenCalled();
    });
  });
});
