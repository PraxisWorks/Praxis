import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock logger before imports
vi.mock("../logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock schema to avoid importing actual drizzle schema
const mockInsertValues = vi.fn().mockResolvedValue(undefined);
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });
const mockDb = { insert: mockInsert } as any;

const mockPublish = vi.fn().mockResolvedValue(undefined);
const mockPubsub = { publish: mockPublish } as any;

// Import after mocks
const { SessionOutputBuffer, stripAnsi } = await import("./output-buffer.js");

describe("SessionOutputBuffer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("append and flush", () => {
    it("buffers output and flushes on newline", async () => {
      const buffer = new SessionOutputBuffer("s1", mockDb, mockPubsub);
      buffer.append("hello world\n", "stdout");
      // Flush is triggered asynchronously by the newline — advance past one interval
      await vi.advanceTimersByTimeAsync(600);
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "s1",
          role: "system",
          content: "hello world\n",
        }),
      );
      buffer.stop();
    });

    it("flushes after 500ms even without newline", async () => {
      const buffer = new SessionOutputBuffer("s1", mockDb, mockPubsub);
      buffer.append("partial output", "stdout");
      // No newline, so only timer-based flush
      await vi.advanceTimersByTimeAsync(600);
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "partial output",
        }),
      );
      buffer.stop();
    });

    it("does not flush when buffer is empty", async () => {
      const buffer = new SessionOutputBuffer("s1", mockDb, mockPubsub);
      await vi.advanceTimersByTimeAsync(600);
      expect(mockInsert).not.toHaveBeenCalled();
      buffer.stop();
    });

    it("accumulates multiple chunks before flushing", async () => {
      const buffer = new SessionOutputBuffer("s1", mockDb, mockPubsub);
      buffer.append("chunk1 ", "stdout");
      buffer.append("chunk2 ", "stdout");
      buffer.append("chunk3\n", "stdout");
      await vi.advanceTimersByTimeAsync(600);
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "chunk1 chunk2 chunk3\n",
        }),
      );
      buffer.stop();
    });

    it("prefixes stderr output with [stderr]", async () => {
      const buffer = new SessionOutputBuffer("s1", mockDb, mockPubsub);
      buffer.append("error msg\n", "stderr");
      await vi.advanceTimersByTimeAsync(600);
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "[stderr] error msg\n",
        }),
      );
      buffer.stop();
    });

    it("publishes to scoped session messages channel on each flush", async () => {
      const buffer = new SessionOutputBuffer("s1", mockDb, mockPubsub);
      buffer.append("output\n", "stdout");
      await vi.advanceTimersByTimeAsync(600);
      expect(mockPublish).toHaveBeenCalledWith(
        "sync:session:s1:messages",
        expect.objectContaining({
          action: "created",
          data: expect.objectContaining({
            sessionId: "s1",
            role: "system",
          }),
        }),
      );
      buffer.stop();
    });
  });

  describe("stripAnsi", () => {
    it("removes color codes from output", async () => {
      const buffer = new SessionOutputBuffer("s1", mockDb, mockPubsub);
      buffer.append("\x1b[32mgreen text\x1b[0m\n", "stdout");
      await vi.advanceTimersByTimeAsync(600);
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "green text\n",
        }),
      );
      buffer.stop();
    });

    it("removes cursor movement sequences", async () => {
      const buffer = new SessionOutputBuffer("s1", mockDb, mockPubsub);
      buffer.append("\x1b[2J\x1b[H\x1b[1;34mblue\x1b[0m\n", "stdout");
      await vi.advanceTimersByTimeAsync(600);
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "blue\n",
        }),
      );
      buffer.stop();
    });

    it("passes through plain text unchanged", async () => {
      const buffer = new SessionOutputBuffer("s1", mockDb, mockPubsub);
      buffer.append("plain text\n", "stdout");
      await vi.advanceTimersByTimeAsync(600);
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "plain text\n",
        }),
      );
      buffer.stop();
    });
  });

  describe("stripAnsi (exported function)", () => {
    it("strips SGR sequences", () => {
      expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
    });

    it("returns empty string for only escape codes", () => {
      expect(stripAnsi("\x1b[0m")).toBe("");
    });

    it("passes plain text through unchanged", () => {
      expect(stripAnsi("hello")).toBe("hello");
    });
  });

  describe("configurable role", () => {
    it("uses 'system' role by default", async () => {
      const buffer = new SessionOutputBuffer("s1", mockDb, mockPubsub);
      buffer.append("output\n", "stdout");
      await vi.advanceTimersByTimeAsync(600);
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({ role: "system" }),
      );
      buffer.stop();
    });

    it("uses configured role when provided", async () => {
      const buffer = new SessionOutputBuffer("s1", mockDb, mockPubsub, {
        role: "assistant",
      });
      buffer.append("response\n", "stdout");
      await vi.advanceTimersByTimeAsync(600);
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({ role: "assistant" }),
      );
      expect(mockPublish).toHaveBeenCalledWith(
        "sync:session:s1:messages",
        expect.objectContaining({
          data: expect.objectContaining({ role: "assistant" }),
        }),
      );
      buffer.stop();
    });
  });

  describe("onFlush callback", () => {
    it("calls onFlush with accumulated content after each flush", async () => {
      const onFlush = vi.fn();
      const buffer = new SessionOutputBuffer("s1", mockDb, mockPubsub, {
        onFlush,
      });
      buffer.append("chunk1\n", "stdout");
      await vi.advanceTimersByTimeAsync(600);
      expect(onFlush).toHaveBeenCalledWith("chunk1\n");

      buffer.append("chunk2\n", "stdout");
      await vi.advanceTimersByTimeAsync(600);
      // Second call should have full accumulated content
      expect(onFlush).toHaveBeenCalledWith("chunk1\nchunk2\n");
      buffer.stop();
    });

    it("does not break flush pipeline if onFlush throws", async () => {
      const onFlush = vi.fn().mockImplementation(() => {
        throw new Error("callback error");
      });
      const buffer = new SessionOutputBuffer("s1", mockDb, mockPubsub, {
        onFlush,
      });
      buffer.append("output\n", "stdout");
      await vi.advanceTimersByTimeAsync(600);
      // Should still have written to DB despite callback error
      expect(mockInsertValues).toHaveBeenCalled();
      buffer.stop();
    });
  });

  describe("custom flush interval", () => {
    it("respects custom flushIntervalMs", async () => {
      const buffer = new SessionOutputBuffer("s1", mockDb, mockPubsub, {
        flushIntervalMs: 2000,
      });
      buffer.append("partial output", "stdout"); // no newline
      // After 600ms, should NOT have flushed (interval is 2000ms)
      await vi.advanceTimersByTimeAsync(600);
      expect(mockInsert).not.toHaveBeenCalled();
      // After 2100ms total, should flush
      await vi.advanceTimersByTimeAsync(1500);
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({ content: "partial output" }),
      );
      buffer.stop();
    });
  });

  describe("getAccumulated", () => {
    it("returns all flushed and buffered content", async () => {
      const buffer = new SessionOutputBuffer("s1", mockDb, mockPubsub);
      buffer.append("flushed\n", "stdout");
      await vi.advanceTimersByTimeAsync(600);
      buffer.append("buffered", "stdout");
      expect(buffer.getAccumulated()).toBe("flushed\nbuffered");
      buffer.stop();
    });
  });

  describe("stop", () => {
    it("stops the periodic flush timer", async () => {
      const buffer = new SessionOutputBuffer("s1", mockDb, mockPubsub);
      buffer.stop();
      // After stopping, timer-based flushes should not fire
      buffer.append("data", "stdout"); // no newline, only timer would flush
      await vi.advanceTimersByTimeAsync(1000);
      // The newline-less append does not trigger immediate flush,
      // and the timer is stopped, so no flush should occur.
      expect(mockInsert).not.toHaveBeenCalled();
    });
  });
});
