import { spawn, type ChildProcess } from "node:child_process";
import { getLogger } from "../logger.js";
import { syncChannel } from "@praxis2/shared";
import { StreamJsonParser, type StreamJsonParserOptions } from "./stream-json-parser.js";
import { getDb } from "../db.js";
import type { WorkerConnection } from "../connection/index.js";
import { buildChildPath } from "../child-env.js";

// ─── Types ───

export interface SessionStartOptions {
  /** Role for output messages. Default: "assistant". */
  outputRole?: "system" | "assistant";
  /** Flush interval for parser. Default: 2000ms. */
  flushIntervalMs?: number;
  /** Called after each output flush with full accumulated output. */
  onOutput?: (accumulatedContent: string) => void;
  /** Called when a tool_use block is detected. */
  onToolActivity?: (toolName: string, label: string) => void;
  /** Permission args (from permissions.ts). */
  permissionArgs?: string[];
  /** System prompt args (from skills.ts). */
  systemPromptArgs?: string[];
  /** Session type for logging. */
  sessionType?: string;
}

type ManagedSession = {
  process: ChildProcess;
  parser: StreamJsonParser;
  sessionId: string;
  workDir: string;
  env: Record<string, string | undefined>;
  options?: SessionStartOptions;
  startedAt: Date;
  /** Set to true when stop() is called externally (e.g. by the job handler). */
  stoppedExternally: boolean;
  stdinOpen: boolean;
};

// ─── SessionManager ───

/**
 * Manages all active child processes for working sessions.
 * Each session runs a `claude` CLI process spawned via child_process.spawn
 * using stream-json format with stdin piping for long-lived processes.
 * The manager handles stdin input for bidirectional communication and cleans up on exit.
 */
export class SessionManager {
  private sessions = new Map<string, ManagedSession>();
  /** Stores session context (workDir, env) after process exits so sendInput can resume. */
  private lastSessionContext = new Map<string, Pick<ManagedSession, "workDir" | "env" | "options">>();
  private connection: WorkerConnection;
  private workerName: string | null;
  private logger = getLogger();

  constructor(connection: WorkerConnection, workerName?: string) {
    this.connection = connection;
    this.workerName = workerName ?? null;
  }

  // ─── Start ───

  /**
   * Spawns a long-lived `claude` process using stream-json format.
   * The initial prompt is sent via stdin (not as a CLI arg).
   *
   * - cwd is set to workDir so Claude operates in the correct project directory.
   * - env is optionally extended (for PATH, API keys, etc.).
   * - stdout is piped to a StreamJsonParser which parses line-delimited JSON
   *   and flushes text content to session_messages.
   * - On process exit: session status -> "error" on non-zero exit, NOTIFY.
   * - On process error (spawn failure): session status -> "error", log the error.
   *
   */
  async start(
    sessionId: string,
    prompt: string,
    workDir: string,
    env?: Record<string, string>,
    options?: SessionStartOptions,
  ): Promise<void> {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} is already running`);
    }

    const permissionArgs = options?.permissionArgs ?? ["--dangerously-skip-permissions"];
    const systemPromptArgs = options?.systemPromptArgs ?? [];

    // IMPORTANT: --system-prompt MUST come before --allowedTools because
    // --allowedTools is variadic and will consume all subsequent args including
    // --system-prompt if it comes after. This caused architecture/spec sessions
    // to silently lose their skill-based system prompts.
    const args = [
      "--print",
      "--verbose",
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--session-id", sessionId,
      ...systemPromptArgs,
      ...permissionArgs,
    ];

    this.logger.info(
      { sessionId, workDir, promptLength: prompt.length, argsCount: args.length },
      "Spawning session",
    );

    const mergedEnv = { ...process.env, ...(env ?? {}), PATH: buildChildPath(), BD_ACTOR: "claude-agent", CLAUDECODE: undefined, ANTHROPIC_API_KEY: undefined };

    const proc = spawn("claude", args, {
      cwd: workDir,
      env: mergedEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Send the initial prompt via stdin
    const stdinMsg = JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: prompt }] },
    }) + "\n";
    proc.stdin?.write(stdinMsg);

    const parser = this.createParser(sessionId, options);

    this.attachProcessHandlers(sessionId, proc, parser);

    this.sessions.set(sessionId, {
      process: proc,
      parser,
      sessionId,
      workDir,
      env: mergedEnv,
      options,
      startedAt: new Date(),
      stoppedExternally: false,
      stdinOpen: true,
    });

    // Clear needsInput so the UI stops showing "Waiting for you"
    await this.connection.updateSessionStatus(sessionId, "active", {
      metadata: { needsInput: false },
    });

    await this.connection.writeMessage(sessionId, "system", `Session launched (pid: ${proc.pid})`, this.workerName);

    await this.connection.publishSync(`sync:session:${sessionId}:messages`, {
      action: "created",
      data: { sessionId, role: "system", content: "Session launched", workerName: this.workerName },
      timestamp: Date.now(),
    });
  }

  // ─── Resume ───

  /**
   * Resumes a previously paused working session by spawning
   * `claude --resume {sessionId}` with stream-json format.
   */
  async resume(
    sessionId: string,
    workDir: string,
    env?: Record<string, string>,
    options?: SessionStartOptions,
  ): Promise<void> {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} is already running`);
    }

    // Try to recover options from lastSessionContext if not provided
    const ctx = this.lastSessionContext.get(sessionId);
    const effectiveOptions = options ?? ctx?.options;

    this.logger.info({ sessionId, workDir }, "Resuming session");

    const mergedEnv = { ...process.env, ...(env ?? {}), PATH: buildChildPath(), BD_ACTOR: "claude-agent", CLAUDECODE: undefined, ANTHROPIC_API_KEY: undefined };
    const permissionArgs = effectiveOptions?.permissionArgs ?? ["--dangerously-skip-permissions"];
    const systemPromptArgs = effectiveOptions?.systemPromptArgs ?? [];

    const proc = spawn(
      "claude",
      [
        "--print",
        "--verbose",
        "--output-format", "stream-json",
        "--input-format", "stream-json",
        "--resume", sessionId,
        ...systemPromptArgs,
        ...permissionArgs,
      ],
      {
        cwd: workDir,
        env: mergedEnv,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    const parser = this.createParser(sessionId, effectiveOptions);

    this.attachProcessHandlers(sessionId, proc, parser);

    this.sessions.set(sessionId, {
      process: proc,
      parser,
      sessionId,
      workDir,
      env: mergedEnv,
      options: effectiveOptions,
      startedAt: new Date(),
      stoppedExternally: false,
      stdinOpen: true,
    });

    // Clear needsInput so the UI stops showing "Waiting for you"
    await this.connection.updateSessionStatus(sessionId, "active", {
      metadata: { needsInput: false },
    });

    await this.connection.writeMessage(sessionId, "system", `Session resumed (pid: ${proc.pid})`, this.workerName);

    await this.connection.publishSync(`sync:session:${sessionId}:messages`, {
      action: "created",
      data: { sessionId, role: "system", content: "Session resumed", workerName: this.workerName },
      timestamp: Date.now(),
    });
  }

  // ─── Send Input ───

  /**
   * Sends a follow-up message to a session.
   * If the process is alive and stdin is open, writes directly to stdin.
   * If the process has exited, spawns a new `claude --resume` process
   * with stream-json format and sends the message via stdin.
   *
   * @param fallbackCtx Optional context to use when in-memory context is lost
   *   (e.g. after a worker restart). The caller can reconstruct this from DB.
   */
  async sendInput(
    sessionId: string,
    message: string,
    fallbackCtx?: { workDir: string; env: Record<string, string | undefined>; options?: SessionStartOptions },
  ): Promise<void> {
    const managed = this.sessions.get(sessionId);

    // If process is alive and stdin is open, write directly
    if (managed && this.isAlive(sessionId) && managed.stdinOpen) {
      this.logger.info({ sessionId }, "Writing follow-up to stdin");
      const msg = JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "text", text: message }] },
      }) + "\n";
      managed.process.stdin?.write(msg);
      return;
    }

    // Process has exited — auto-resume via --resume with stream-json
    const ctx = managed ?? this.lastSessionContext.get(sessionId) ?? fallbackCtx;
    if (!ctx) {
      throw new Error(`Session ${sessionId} has no stored context for resume`);
    }

    if (fallbackCtx && !managed && !this.lastSessionContext.has(sessionId)) {
      this.logger.info({ sessionId }, "Using reconstructed context for resume (in-memory context was lost)");
    }

    this.logger.info({ sessionId }, "Auto-resuming session via --resume");

    const permissionArgs = ctx.options?.permissionArgs ?? ["--dangerously-skip-permissions"];
    const systemPromptArgs = ctx.options?.systemPromptArgs ?? [];

    const proc = spawn(
      "claude",
      [
        "--print",
        "--verbose",
        "--output-format", "stream-json",
        "--input-format", "stream-json",
        "--resume", sessionId,
        ...systemPromptArgs,
        ...permissionArgs,
      ],
      {
        cwd: ctx.workDir,
        env: ctx.env,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    const parser = this.createParser(sessionId, ctx.options);

    this.attachProcessHandlers(sessionId, proc, parser);

    this.sessions.set(sessionId, {
      process: proc,
      parser,
      sessionId,
      workDir: ctx.workDir,
      env: ctx.env,
      options: ctx.options,
      startedAt: new Date(),
      stoppedExternally: false,
      stdinOpen: true,
    });

    // Clear needsInput so the UI stops showing "Waiting for you"
    await this.connection.updateSessionStatus(sessionId, "active", {
      metadata: { needsInput: false },
    });

    await this.connection.writeMessage(sessionId, "system", `Session auto-resumed (pid: ${proc.pid})`, this.workerName);

    await this.connection.publishSync(`sync:session:${sessionId}:messages`, {
      action: "created",
      data: { sessionId, role: "system", content: "Session auto-resumed", workerName: this.workerName },
      timestamp: Date.now(),
    });

    // Send the message via stdin
    const msg = JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: message }] },
    }) + "\n";
    proc.stdin?.write(msg);
  }

  // ─── Stop ───

  /**
   * Gracefully stops a working session.
   * Closes stdin first, then sends SIGTERM after a brief delay.
   * If the process does not exit within 5 seconds, sends SIGKILL.
   *
   * Sets the `stoppedExternally` flag so the exit handler skips its own
   * status write -- the caller (job handler) owns the final status.
   *
   * Resolves with the exit code so the caller can decide the final status.
   */
  async stop(sessionId: string): Promise<number | null> {
    const managed = this.sessions.get(sessionId);
    if (!managed) {
      this.logger.info(
        { sessionId },
        "Session not found in manager, may have already exited",
      );
      return null;
    }

    managed.stoppedExternally = true;

    this.logger.info(
      { sessionId, pid: managed.process.pid },
      "Stopping session",
    );

    // Close stdin gracefully first
    try {
      managed.process.stdin?.end();
      managed.stdinOpen = false;
    } catch {
      // stdin may already be closed
    }

    return new Promise<number | null>((resolve) => {
      const timeout = setTimeout(() => {
        if (this.isAlive(sessionId)) {
          this.logger.warn(
            { sessionId },
            "Session did not exit after SIGTERM, sending SIGKILL",
          );
          managed.process.kill("SIGKILL");
        }
        resolve(managed.process.exitCode);
      }, 5000);

      managed.process.on("exit", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });

      // Brief delay after stdin close, then SIGTERM
      setTimeout(() => {
        if (this.isAlive(sessionId)) {
          managed.process.kill("SIGTERM");
        }
      }, 500);
    });
  }

  // ─── Is Alive ───

  /**
   * Returns true if the session's child process is still running.
   */
  isAlive(sessionId: string): boolean {
    const managed = this.sessions.get(sessionId);
    if (!managed) {
      return false;
    }
    return managed.process.exitCode === null && !managed.process.killed;
  }

  // ─── Active Count ───

  getActiveCount(): number {
    return this.sessions.size;
  }

  // ─── Shutdown All ───

  /**
   * Stops all active sessions. Called during Worker shutdown.
   */
  async shutdownAll(): Promise<void> {
    this.logger.info(
      { count: this.sessions.size },
      "Shutting down all working sessions",
    );

    // Mark ALL sessions as externally stopped BEFORE sending any signals.
    // This prevents the race where a child process exits (from a propagated
    // SIGTERM to the process group) before stop() gets to set the flag,
    // which would cause the exit handler to mark the session as "error".
    for (const [, managed] of this.sessions) {
      managed.stoppedExternally = true;
    }

    const promises: Promise<number | null>[] = [];
    for (const [sessionId] of this.sessions) {
      promises.push(this.stop(sessionId));
    }
    await Promise.all(promises);
  }

  // ─── Private Helpers ───

  /**
   * Creates a StreamJsonParser. Uses getDb() for backward compatibility
   * since StreamJsonParser still expects DrizzleDb + PgPubSub directly.
   * The pubsub adapter wraps connection.publishSync().
   */
  private createParser(sessionId: string, options?: SessionStartOptions): StreamJsonParser {
    const db = getDb();
    // Create a PgPubSub-compatible adapter that delegates to connection.publishSync().
    // When a non-user message is created (text flush), clear currentActivity from
    // session metadata so the session list stops showing stale tool labels.
    const connection = this.connection;
    const pubsubAdapter = {
      publish: async (channel: string, data: unknown) => {
        await connection.publishSync(channel, data as import("@praxis2/shared").SyncEvent);

        // Clear currentActivity when assistant/system text flushes
        const event = data as { action?: string; data?: { role?: string; sessionId?: string } };
        if (event.action === "created" && event.data?.role && event.data.role !== "user") {
          void connection.updateSessionStatus(sessionId, "active", {
            metadata: { currentActivity: null },
          });
          void connection.publishSync(syncChannel("session"), {
            action: "updated",
            data: { id: sessionId, metadata: { currentActivity: null } },
            timestamp: Date.now(),
          });
        }
      },
      subscribe: async () => () => {},
      close: async () => {},
    };

    const parserOptions: StreamJsonParserOptions = {
      role: options?.outputRole ?? "assistant",
      flushIntervalMs: options?.flushIntervalMs ?? 2000,
      onText: options?.onOutput,
      onToolActivity: options?.onToolActivity,
      workerName: this.workerName,
    };

    return new StreamJsonParser(sessionId, db, pubsubAdapter as unknown as import("@praxis2/shared").PgPubSub, parserOptions);
  }

  /**
   * Attaches stdout, stderr, exit, and error handlers to a child process.
   * Shared between start(), resume(), and sendInput() to avoid duplication.
   */
  private attachProcessHandlers(
    sessionId: string,
    proc: ChildProcess,
    parser: StreamJsonParser,
  ): void {
    // Collect recent stderr so the exit handler can surface the actual error
    const stderrChunks: string[] = [];
    const MAX_STDERR_CHARS = 2000;

    proc.stdin?.on("close", () => {
      const m = this.sessions.get(sessionId);
      if (m) m.stdinOpen = false;
    });

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      this.logger.debug({ sessionId, stdoutLen: text.length }, "Session stdout data");
      parser.push(text);
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      this.logger.debug({ sessionId, stderrChunk: text.slice(0, 200) }, "Session stderr");
      stderrChunks.push(text);
      // Keep only the tail to avoid unbounded memory growth
      while (stderrChunks.join("").length > MAX_STDERR_CHARS && stderrChunks.length > 1) {
        stderrChunks.shift();
      }
    });

    proc.on("exit", async (code: number | null, signal: string | null) => {
      try {
        this.logger.info(
          { sessionId, code, signal },
          "Session process exited",
        );

        await parser.flush();
        parser.stop();

        const managed = this.sessions.get(sessionId);
        const wasStoppedExternally = managed?.stoppedExternally ?? false;

        // Preserve context for potential follow-up via sendInput/resume
        if (managed) {
          this.logger.info(
            { sessionId, code, workDir: managed.workDir },
            "Preserving session context for future resume",
          );
          this.lastSessionContext.set(sessionId, {
            workDir: managed.workDir,
            env: managed.env,
            options: managed.options,
          });
        }

        this.sessions.delete(sessionId);

        // In stream-json mode, a normal exit (code 0) just means the response is done.
        // Don't mark as "completed" — the session stays active for follow-ups.
        // Signal the UI that the turn is complete and we're waiting for user input.
        if (!wasStoppedExternally && (code === 0 || code === null)) {
          await this.connection.updateSessionStatus(sessionId, "active", {
            metadata: { needsInput: true, currentActivity: null },
          });

          await this.connection.publishSync(syncChannel("session"), {
            action: "updated",
            data: { id: sessionId, status: "active", metadata: { needsInput: true, currentActivity: null } },
            timestamp: Date.now(),
          });
        }

        // Only mark error on non-zero exit, or if stopped externally the caller owns status.
        if (!wasStoppedExternally && code !== 0 && code !== null) {
          const stderr = stderrChunks.join("").trim();
          const exitMessage = stderr
            ? `Session exited (code: ${code}): ${stderr.slice(-500)}`
            : `Session exited (code: ${code}, signal: ${signal ?? "none"})`;

          await this.connection.updateSessionStatus(sessionId, "error", { clearClaim: true });

          await this.connection.publishSync(syncChannel("session"), {
            action: "updated",
            data: { id: sessionId, status: "error" },
            timestamp: Date.now(),
          });

          await this.connection.writeMessage(sessionId, "system", exitMessage, this.workerName);

          await this.connection.publishSync(`sync:session:${sessionId}:messages`, {
            action: "created",
            data: { sessionId, role: "system", content: exitMessage },
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        this.logger.error({ sessionId, err }, "Error in exit handler");
      }
    });

    proc.on("error", async (err: Error) => {
      try {
        this.logger.error({ sessionId, err }, "Session spawn error");

        parser.stop();

        const managed = this.sessions.get(sessionId);
        const wasStoppedExternally = managed?.stoppedExternally ?? false;

        this.sessions.delete(sessionId);

        if (!wasStoppedExternally) {
          await this.connection.updateSessionStatus(sessionId, "error", { clearClaim: true });

          await this.connection.publishSync(syncChannel("session"), {
            action: "updated",
            data: { id: sessionId, status: "error" },
            timestamp: Date.now(),
          });
        }

        await this.connection.writeMessage(sessionId, "system", `Session failed to start: ${err.message}`, this.workerName);

        await this.connection.publishSync(`sync:session:${sessionId}:messages`, {
          action: "created",
          data: {
            sessionId,
            role: "system",
            content: `Spawn error: ${err.message}`,
          },
          timestamp: Date.now(),
        });
      } catch (handlerErr) {
        this.logger.error({ sessionId, err: handlerErr }, "Error in error handler");
      }
    });
  }
}
