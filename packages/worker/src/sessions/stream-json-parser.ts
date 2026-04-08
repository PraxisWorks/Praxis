import { getLogger } from "../logger.js";
import { sessionMessages, sessions } from "@praxis2/api/schema";
import { eq } from "drizzle-orm";
import type { DrizzleDb } from "../db.js";
import { StructuredQuestionMetadataSchema, type PgPubSub, type StructuredQuestionMetadata } from "@praxis2/shared";

export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

const TOOL_ACTIVITY_LABELS: Record<string, string> = {
  Read: "Reading files...",
  Glob: "Searching files...",
  Grep: "Searching code...",
  Write: "Writing files...",
  Edit: "Editing files...",
  Bash: "Running command...",
};

export interface StreamJsonEvent {
  type: "assistant" | "system" | "result" | "message_delta";
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      id?: string;
      input?: unknown;
    }>;
  };
  [key: string]: unknown;
}

export interface StreamJsonParserOptions {
  role?: "system" | "assistant";
  flushIntervalMs?: number;
  onText?: (accumulated: string) => void;
  onToolActivity?: (toolName: string, label: string) => void;
  onResult?: (event: StreamJsonEvent) => void;
  onStructuredQuestion?: (metadata: StructuredQuestionMetadata) => void;
  workerName?: string | null;
}

/**
 * Parses line-delimited JSON from Claude CLI's `--output-format stream-json`
 * stdout. Accumulates text content and flushes to the session_messages table
 * on a timer or on turn completion.
 */
export class StreamJsonParser {
  private lineBuffer = "";
  private textBuffer = "";
  private accumulated = "";
  private sessionId: string;
  private db: DrizzleDb;
  private pubsub: PgPubSub;
  private logger = getLogger();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushIntervalMs: number;
  private flushPromise: Promise<void> = Promise.resolve();
  private role: "system" | "assistant";
  private onText?: (accumulated: string) => void;
  private onToolActivity?: (toolName: string, label: string) => void;
  private onResult?: (event: StreamJsonEvent) => void;
  private onStructuredQuestion?: (metadata: StructuredQuestionMetadata) => void;
  private workerName: string | null;

  constructor(
    sessionId: string,
    db: DrizzleDb,
    pubsub: PgPubSub,
    options?: StreamJsonParserOptions,
  ) {
    this.sessionId = sessionId;
    this.db = db;
    this.pubsub = pubsub;
    this.role = options?.role ?? "assistant";
    this.flushIntervalMs = options?.flushIntervalMs ?? 2000;
    this.onText = options?.onText;
    this.onToolActivity = options?.onToolActivity;
    this.onResult = options?.onResult;
    this.onStructuredQuestion = options?.onStructuredQuestion;
    this.workerName = options?.workerName ?? null;

    this.flushTimer = setInterval(() => {
      if (this.textBuffer.length > 0) {
        this.flush().catch((err) => {
          this.logger.error(
            { sessionId: this.sessionId, err },
            "Stream JSON parser flush error",
          );
        });
      }
    }, this.flushIntervalMs);
  }

  /** Returns all accumulated text so far (flushed + pending). */
  getAccumulated(): string {
    return this.accumulated + this.textBuffer;
  }

  /**
   * Receives raw stdout chunks from the CLI process.
   * Buffers partial lines, parses each complete JSON line.
   */
  push(chunk: string): void {
    this.lineBuffer += chunk;

    const lines = this.lineBuffer.split("\n");
    // Last element is either empty (line ended with \n) or an incomplete line
    this.lineBuffer = lines.pop()!;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      this.parseLine(trimmed);
    }
  }

  private parseLine(line: string): void {
    let event: StreamJsonEvent;
    try {
      event = JSON.parse(stripAnsi(line));
    } catch {
      this.logger.debug({ line: line.slice(0, 200) }, "Non-JSON line from CLI, skipping");
      return;
    }

    if (event.type === "assistant" && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === "text" && block.text) {
          this.textBuffer += block.text;
        } else if (block.type === "tool_use" && block.name === "AskUserQuestion" && block.input) {
          // Flush any pending text first
          this.flush().catch((err) => {
            this.logger.error({ sessionId: this.sessionId, err }, "Flush error before structured question");
          });

          // Validate and persist the structured question
          const parsed = StructuredQuestionMetadataSchema.safeParse({
            type: "structured_question",
            questions: (block.input as Record<string, unknown>).questions,
            answered: false,
          });

          if (parsed.success) {
            const metadata = parsed.data;

            // Build human-readable fallback content
            const fallback = metadata.questions
              .map(
                (q) =>
                  `**${q.header ? `[${q.header}] ` : ""}${q.question}**\n${q.options.map((o) => `- ${o.label}: ${o.description}`).join("\n")}`,
              )
              .join("\n\n");

            // Persist with metadata
            this.db
              .insert(sessionMessages)
              .values({
                sessionId: this.sessionId,
                role: this.role,
                content: fallback,
                workerName: this.workerName,
                metadata,
              })
              .then(() => {
                // Set needsInput on the session for badge rendering
                return this.db
                  .update(sessions)
                  .set({ metadata: { needsInput: true } })
                  .where(eq(sessions.id, this.sessionId));
              })
              .then(() => {
                // Publish sync event WITHOUT metadata (stays under 8KB pg_notify limit)
                return this.pubsub.publish(`sync:session:${this.sessionId}:messages`, {
                  action: "created",
                  data: { sessionId: this.sessionId, role: this.role, content: fallback },
                  timestamp: Date.now(),
                });
              })
              .catch((err) => {
                this.logger.error({ sessionId: this.sessionId, err }, "Failed to persist structured question");
              });

            if (this.onStructuredQuestion) {
              try {
                this.onStructuredQuestion(metadata);
              } catch {
                // best effort
              }
            }
          } else {
            // Malformed input -- degrade gracefully to normal tool_activity
            this.logger.warn(
              { sessionId: this.sessionId, errors: parsed.error.issues },
              "AskUserQuestion input failed validation, treating as tool_activity",
            );
            if (this.onToolActivity) {
              try {
                this.onToolActivity("AskUserQuestion", "Asking question...");
              } catch {
                // best effort
              }
            }
          }
        } else if (block.type === "tool_use" && block.name) {
          const label =
            TOOL_ACTIVITY_LABELS[block.name] ?? `Using ${block.name}...`;
          if (this.onToolActivity) {
            try {
              this.onToolActivity(block.name, label);
            } catch {
              // best effort
            }
          }
        }
      }
    } else if (event.type === "result") {
      // Flush any remaining text before delivering the result
      this.flush().catch((err) => {
        this.logger.error(
          { sessionId: this.sessionId, err },
          "Flush error on result event",
        );
      });
      if (this.onResult) {
        try {
          this.onResult(event);
        } catch {
          // best effort
        }
      }
    }
  }

  /**
   * Serializes concurrent flush calls through a promise chain so that
   * only one flush runs at a time, preventing interleaved DB writes.
   */
  async flush(): Promise<void> {
    this.flushPromise = this.flushPromise.then(() => this._doFlush());
    return this.flushPromise;
  }

  private async _doFlush(): Promise<void> {
    if (this.textBuffer.length === 0) return;

    const content = this.textBuffer;
    this.textBuffer = "";
    this.accumulated += content;

    await this.db.insert(sessionMessages).values({
      sessionId: this.sessionId,
      role: this.role,
      content,
      workerName: this.workerName,
    });

    // Postgres NOTIFY has an 8000-byte payload limit. The full content is
    // persisted in sessionMessages above; the pubsub event just signals the
    // client. Truncate to stay safely under the limit.
    const MAX_NOTIFY_CONTENT = 6000;
    const truncated = content.length > MAX_NOTIFY_CONTENT
      ? content.slice(0, MAX_NOTIFY_CONTENT)
      : content;

    await this.pubsub.publish(`sync:session:${this.sessionId}:messages`, {
      action: "created",
      data: { sessionId: this.sessionId, role: this.role, content: truncated },
      timestamp: Date.now(),
    });

    if (this.onText) {
      try {
        this.onText(this.accumulated);
      } catch {
        // best effort — don't let callback errors break the flush pipeline
      }
    }
  }

  /** Stops the periodic flush timer. */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
