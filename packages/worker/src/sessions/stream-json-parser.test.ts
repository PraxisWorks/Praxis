import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the logger module
vi.mock("../logger.js", () => ({
  getLogger: vi.fn(() => ({
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  })),
}));

// Mock @praxis2/api/schema — provide table references for DB insert/update
vi.mock("@praxis2/api/schema", () => ({
  sessionMessages: { _: "sessionMessages" },
  sessions: { id: "sessions.id", _: "sessions" },
}));

// Mock drizzle-orm eq function
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ _op: "eq", left: a, right: b })),
}));

import { StreamJsonParser, type StreamJsonParserOptions } from "./stream-json-parser.js";

function createMockDb() {
  const mock = {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
  return mock;
}

function createMockPubsub() {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    close: vi.fn(),
  };
}

const VALID_QUESTION_INPUT = {
  questions: [
    {
      question: "Which approach?",
      header: "Approach",
      options: [
        { label: "Option A", description: "First approach" },
        { label: "Option B", description: "Second approach" },
      ],
      multiSelect: false,
    },
  ],
};

function makeAskUserQuestionLine(input: unknown, id = "tool-1") {
  return JSON.stringify({
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          name: "AskUserQuestion",
          id,
          input,
        },
      ],
    },
  });
}

function makeToolUseLine(name: string, id = "tool-1") {
  return JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", name, id }],
    },
  });
}

function makeTextLine(text: string) {
  return JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "text", text }],
    },
  });
}

function makeMixedLine(text: string, toolInput: unknown, toolId = "tool-3") {
  return JSON.stringify({
    type: "assistant",
    message: {
      content: [
        { type: "text", text },
        {
          type: "tool_use",
          name: "AskUserQuestion",
          id: toolId,
          input: toolInput,
        },
      ],
    },
  });
}

/** Wait for microtask queue to drain and pending .then() chains to settle. */
async function flushPromises(ms = 20): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe("StreamJsonParser", () => {
  let db: ReturnType<typeof createMockDb>;
  let pubsub: ReturnType<typeof createMockPubsub>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    pubsub = createMockPubsub();
  });

  afterEach(() => {
    // parsers are stopped individually in each test
  });

  describe("AskUserQuestion tool_use with valid input", () => {
    it("persists structured question with metadata to DB", async () => {
      const parser = new StreamJsonParser("s1", db as any, pubsub as any, {
        flushIntervalMs: 60_000, // large interval so timer doesn't interfere
      });

      parser.push(makeAskUserQuestionLine(VALID_QUESTION_INPUT) + "\n");
      await flushPromises();

      // db.insert should have been called for the question message
      expect(db.insert).toHaveBeenCalled();
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "s1",
          role: "assistant",
          metadata: expect.objectContaining({
            type: "structured_question",
            answered: false,
          }),
        }),
      );

      // db.update should have been called to set needsInput on sessions
      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { needsInput: true },
        }),
      );

      // pubsub.publish should have been called with sync event
      expect(pubsub.publish).toHaveBeenCalledWith(
        "sync:session:s1:messages",
        expect.objectContaining({
          action: "created",
          data: expect.objectContaining({
            sessionId: "s1",
            role: "assistant",
          }),
        }),
      );

      parser.stop();
    });
  });

  describe("malformed AskUserQuestion falls back to tool_activity", () => {
    it("calls onToolActivity when question input fails validation", async () => {
      const onToolActivity = vi.fn();
      const parser = new StreamJsonParser("s1", db as any, pubsub as any, {
        flushIntervalMs: 60_000,
        onToolActivity,
      });

      // Only 1 option -- min 2 required by schema
      const badInput = {
        questions: [
          {
            question: "Bad question",
            header: "Bad",
            options: [{ label: "Only one", description: "Not enough" }],
          },
        ],
      };

      parser.push(makeAskUserQuestionLine(badInput, "tool-2") + "\n");
      await flushPromises();

      expect(onToolActivity).toHaveBeenCalledWith(
        "AskUserQuestion",
        "Asking question...",
      );

      // Should NOT have inserted the question message into DB
      // (flush may have been called but with empty textBuffer, so no insert for text either)
      // Check that values was NOT called with metadata containing structured_question
      const valuesCallsWithMetadata = db.values.mock.calls.filter(
        (call: unknown[]) => {
          const arg = call[0] as Record<string, unknown>;
          return arg?.metadata && (arg.metadata as Record<string, unknown>).type === "structured_question";
        },
      );
      expect(valuesCallsWithMetadata).toHaveLength(0);

      parser.stop();
    });
  });

  describe("text + AskUserQuestion in same event", () => {
    it("flushes text before persisting the question", async () => {
      const parser = new StreamJsonParser("s1", db as any, pubsub as any, {
        flushIntervalMs: 60_000,
      });

      const line = makeMixedLine("Here are some options:", VALID_QUESTION_INPUT);
      parser.push(line + "\n");
      await flushPromises();

      // db.insert should have been called at least twice:
      // 1. flush of text content ("Here are some options:")
      // 2. persist of structured question with metadata
      const insertCalls = db.values.mock.calls;
      expect(insertCalls.length).toBeGreaterThanOrEqual(2);

      // Find the text flush call
      const textCall = insertCalls.find((call: unknown[]) => {
        const arg = call[0] as Record<string, unknown>;
        return arg?.content === "Here are some options:" && !arg?.metadata;
      });
      expect(textCall).toBeDefined();

      // Find the question persist call
      const questionCall = insertCalls.find((call: unknown[]) => {
        const arg = call[0] as Record<string, unknown>;
        return (
          arg?.metadata &&
          (arg.metadata as Record<string, unknown>).type === "structured_question"
        );
      });
      expect(questionCall).toBeDefined();

      parser.stop();
    });
  });

  describe("non-AskUserQuestion tool_use", () => {
    it("fires onToolActivity with correct label for known tools", async () => {
      const onToolActivity = vi.fn();
      const parser = new StreamJsonParser("s1", db as any, pubsub as any, {
        flushIntervalMs: 60_000,
        onToolActivity,
      });

      parser.push(makeToolUseLine("Read", "tool-4") + "\n");
      await flushPromises();

      expect(onToolActivity).toHaveBeenCalledWith("Read", "Reading files...");

      // Should NOT insert a structured question message
      const valuesCallsWithMetadata = db.values.mock.calls.filter(
        (call: unknown[]) => {
          const arg = call[0] as Record<string, unknown>;
          return arg?.metadata && (arg.metadata as Record<string, unknown>).type === "structured_question";
        },
      );
      expect(valuesCallsWithMetadata).toHaveLength(0);

      parser.stop();
    });

    it("generates a fallback label for unknown tools", async () => {
      const onToolActivity = vi.fn();
      const parser = new StreamJsonParser("s1", db as any, pubsub as any, {
        flushIntervalMs: 60_000,
        onToolActivity,
      });

      parser.push(makeToolUseLine("CustomTool", "tool-5") + "\n");
      await flushPromises();

      expect(onToolActivity).toHaveBeenCalledWith(
        "CustomTool",
        "Using CustomTool...",
      );

      parser.stop();
    });
  });

  describe("onStructuredQuestion callback", () => {
    it("fires with parsed metadata on valid AskUserQuestion", async () => {
      const onStructuredQuestion = vi.fn();
      const parser = new StreamJsonParser("s1", db as any, pubsub as any, {
        flushIntervalMs: 60_000,
        onStructuredQuestion,
      });

      parser.push(makeAskUserQuestionLine(VALID_QUESTION_INPUT) + "\n");
      await flushPromises();

      expect(onStructuredQuestion).toHaveBeenCalledTimes(1);
      const metadata = onStructuredQuestion.mock.calls[0][0];
      expect(metadata.type).toBe("structured_question");
      expect(metadata.answered).toBe(false);
      expect(metadata.questions).toHaveLength(1);
      expect(metadata.questions[0].question).toBe("Which approach?");
      expect(metadata.questions[0].options).toHaveLength(2);

      parser.stop();
    });

    it("does not fire on malformed AskUserQuestion", async () => {
      const onStructuredQuestion = vi.fn();
      const parser = new StreamJsonParser("s1", db as any, pubsub as any, {
        flushIntervalMs: 60_000,
        onStructuredQuestion,
      });

      const badInput = {
        questions: [
          {
            question: "Bad",
            header: "Bad",
            options: [{ label: "Only one", description: "Not enough" }],
          },
        ],
      };

      parser.push(makeAskUserQuestionLine(badInput) + "\n");
      await flushPromises();

      expect(onStructuredQuestion).not.toHaveBeenCalled();

      parser.stop();
    });
  });

  describe("sync event published without metadata", () => {
    it("does not include metadata in published sync event data", async () => {
      const parser = new StreamJsonParser("s1", db as any, pubsub as any, {
        flushIntervalMs: 60_000,
      });

      parser.push(makeAskUserQuestionLine(VALID_QUESTION_INPUT) + "\n");
      await flushPromises();

      // Find the publish call for the structured question (not a text flush)
      const publishCalls = pubsub.publish.mock.calls;
      const syncCall = publishCalls.find((call: unknown[]) => {
        const channel = call[0] as string;
        return channel === "sync:session:s1:messages";
      });

      expect(syncCall).toBeDefined();
      const payload = syncCall![1] as Record<string, unknown>;
      const data = payload.data as Record<string, unknown>;

      // Data should contain sessionId, role, content but NOT metadata
      expect(data.sessionId).toBe("s1");
      expect(data.role).toBe("assistant");
      expect(data.content).toBeDefined();
      expect(data).not.toHaveProperty("metadata");

      parser.stop();
    });
  });

  describe("result event", () => {
    it("fires onResult callback on result event", async () => {
      const onResult = vi.fn();
      const parser = new StreamJsonParser("s1", db as any, pubsub as any, {
        flushIntervalMs: 60_000,
        onResult,
      });

      const resultLine = JSON.stringify({ type: "result", data: "done" });
      parser.push(resultLine + "\n");
      await flushPromises();

      expect(onResult).toHaveBeenCalledTimes(1);
      expect(onResult).toHaveBeenCalledWith(
        expect.objectContaining({ type: "result" }),
      );

      parser.stop();
    });
  });

  describe("text accumulation and flush", () => {
    it("accumulates text content across multiple pushes", async () => {
      const onText = vi.fn();
      const parser = new StreamJsonParser("s1", db as any, pubsub as any, {
        flushIntervalMs: 60_000,
        onText,
      });

      parser.push(makeTextLine("Hello ") + "\n");
      parser.push(makeTextLine("world") + "\n");

      expect(parser.getAccumulated()).toBe("Hello world");

      // Trigger flush
      await parser.flush();
      await flushPromises();

      expect(db.insert).toHaveBeenCalled();
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "s1",
          role: "assistant",
          content: "Hello world",
        }),
      );

      parser.stop();
    });
  });

  describe("non-JSON lines are skipped", () => {
    it("does not throw on non-JSON input", async () => {
      const parser = new StreamJsonParser("s1", db as any, pubsub as any, {
        flushIntervalMs: 60_000,
      });

      // Should not throw
      parser.push("this is not JSON\n");
      parser.push("{ malformed json\n");
      await flushPromises();

      // No DB calls for non-JSON lines
      expect(db.insert).not.toHaveBeenCalled();

      parser.stop();
    });
  });

  describe("stop clears the flush timer", () => {
    it("prevents timer-based flushes after stop", async () => {
      vi.useFakeTimers();
      const parser = new StreamJsonParser("s1", db as any, pubsub as any, {
        flushIntervalMs: 1000,
      });

      parser.push(makeTextLine("buffered text") + "\n");
      parser.stop();

      // Advance past multiple intervals
      await vi.advanceTimersByTimeAsync(5000);

      // No flush should have happened since we stopped before the timer fired
      expect(db.insert).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe("workerName passed through to DB writes", () => {
    it("includes workerName in question message values", async () => {
      const parser = new StreamJsonParser("s1", db as any, pubsub as any, {
        flushIntervalMs: 60_000,
        workerName: "worker-1",
      });

      parser.push(makeAskUserQuestionLine(VALID_QUESTION_INPUT) + "\n");
      await flushPromises();

      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          workerName: "worker-1",
        }),
      );

      parser.stop();
    });
  });
});
