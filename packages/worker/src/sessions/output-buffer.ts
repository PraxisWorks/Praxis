/**
 * Session output buffer.
 *
 * Buffers stdout/stderr output from child processes and periodically
 * flushes to the session_messages table + pubsub.
 */
import { getLogger } from "../logger.js";
import { sessionMessages } from "@praxis2/api/schema";
import type { DrizzleDb } from "../db.js";
import type { PgPubSub } from "@praxis2/shared";

/**
 * Strips ANSI escape codes (color, cursor movement, etc.) from a string.
 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

export interface SessionOutputBufferOptions {
  /** Message role. Default: "system". */
  role?: "system" | "assistant";
  /** Flush interval in ms. Default: 500. */
  flushIntervalMs?: number;
  /** Called after each flush with the full accumulated content. */
  onFlush?: (accumulated: string) => void;
  /** Worker name to attach to messages. */
  workerName?: string | null;
}

/**
 * Buffers output from a child process and periodically flushes
 * accumulated text to the database and pubsub channel.
 */
export class SessionOutputBuffer {
  private sessionId: string;
  private db: DrizzleDb;
  private pubsub: PgPubSub;
  private buffer = "";
  private accumulated = "";
  private role: "system" | "assistant";
  private flushIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private onFlush?: (accumulated: string) => void;
  private workerName: string | null;
  private logger = getLogger();

  constructor(
    sessionId: string,
    db: DrizzleDb,
    pubsub: PgPubSub,
    options?: SessionOutputBufferOptions,
  ) {
    this.sessionId = sessionId;
    this.db = db;
    this.pubsub = pubsub;
    this.role = options?.role ?? "system";
    this.flushIntervalMs = options?.flushIntervalMs ?? 500;
    this.onFlush = options?.onFlush;
    this.workerName = options?.workerName ?? null;

    this.timer = setInterval(() => {
      this.flush().catch((err) => {
        this.logger.error({ err }, "Flush error in SessionOutputBuffer");
      });
    }, this.flushIntervalMs);
  }

  /**
   * Appends a chunk of output to the buffer.
   * Strips ANSI codes and optionally prefixes stderr.
   */
  append(chunk: string, source: "stdout" | "stderr"): void {
    const cleaned = stripAnsi(chunk);
    const prefixed = source === "stderr" ? `[stderr] ${cleaned}` : cleaned;
    this.buffer += prefixed;

    // Trigger immediate flush if the chunk contains a newline
    if (chunk.includes("\n")) {
      this.flush().catch((err) => {
        this.logger.error({ err }, "Flush error on newline trigger");
      });
    }
  }

  /**
   * Flushes buffered content to the database and pubsub.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const content = this.buffer;
    this.buffer = "";
    this.accumulated += content;

    await this.db.insert(sessionMessages).values({
      sessionId: this.sessionId,
      role: this.role,
      content,
      workerName: this.workerName,
    });

    await this.pubsub.publish(`sync:session:${this.sessionId}:messages`, {
      action: "created",
      data: { sessionId: this.sessionId, role: this.role, content },
      timestamp: Date.now(),
    });

    if (this.onFlush) {
      try {
        this.onFlush(this.accumulated);
      } catch {
        // best effort
      }
    }
  }

  /** Returns all accumulated content (flushed + pending). */
  getAccumulated(): string {
    return this.accumulated + this.buffer;
  }

  /** Stops the periodic flush timer. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
