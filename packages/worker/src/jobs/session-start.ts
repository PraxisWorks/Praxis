import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { StorageAdapter } from "../storage.js";
import { syncChannel } from "@praxis2/shared";
import { getLogger } from "../logger.js";
import { getConfig } from "../config.js";
import { getDb } from "../db.js";
import { handleDebugSession } from "../sessions/debug-session.js";
import {
  generateWorkingPrompt,
  generateWorkingInitialMessage,
  generateConversationalPrompt,
  generateInitialMessage,
  generateRepoSessionPrompt,
  generateRepoSessionInitialMessage,
  generateResumeMessage,
  type SessionContext,
} from "../sessions/prompts.js";
import { getPermissionArgs } from "../sessions/permissions.js";
import { ensureRepoInitialized } from "../sessions/repo-init.js";
import { getSystemPromptArgs } from "../sessions/skills.js";
import type { SessionManager } from "../sessions/session-manager.js";
import { getSessionWorkspace, ensureSharedClone } from "../sessions/workspace-manager.js";
import type { WorkerConnection } from "../connection/index.js";

interface SessionStartPayload {
  sessionId: string;
  repoId: string;
  type: "spec" | "architecture" | "working" | "debug" | "repo";
  entityType?: string;
  entityId?: string;
  isResume?: boolean;
  isAutoResume?: boolean;
  resumeMessage?: string;
  autoAccept?: boolean;
  phaseConfig?: Array<{ phase: string; mode: "skip" | "full-ai" | "ai-assisted" }>;
  attachments?: Array<{
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    storageKey: string;
  }>;
}

export async function registerSessionStartHandler(
  connection: WorkerConnection,
  sessionManager: SessionManager,
  storage: StorageAdapter,
  queueName: string,
): Promise<void> {
  const logger = getLogger();

  await connection.onJob<SessionStartPayload>(queueName, async (job) => {
    const { sessionId, repoId, type, entityType, entityId, isResume, isAutoResume, phaseConfig, attachments, autoAccept } = job.data;
    logger.info(
      { sessionId, repoId, type, isResume, jobId: job.id },
      "Processing session.start job",
    );

    try {
      // Idempotent claim: atomically set claimedBy if not yet claimed.
      // If another job handler (e.g. pg-boss retry) already claimed this
      // session, we skip processing entirely.
      const CENTRAL_UUID = "00000000-0000-0000-0000-000000000000";
      const workerId = getConfig().WORKER_ID ?? CENTRAL_UUID;
      const claimed = await connection.claimSession(sessionId, workerId);

      if (!claimed) {
        logger.warn(
          { sessionId, workerId },
          "Session already claimed by another worker/retry, skipping",
        );
        return;
      }

      logger.info(
        { sessionId, workerId },
        "Session claimed successfully",
      );

      // Check if this is a scheduled session that needs activation
      const sessionRow = await connection.getSession(sessionId);
      if (sessionRow?.status === "scheduled") {
        // Activate the scheduled session
        await connection.updateSessionStatus(sessionId, "active");
        await connection.publishSync(syncChannel("session"), {
          action: "updated",
          data: { id: sessionId, status: "active" },
          timestamp: Date.now(),
        });
        logger.info({ sessionId }, "Scheduled session activated");
      } else if (sessionRow?.status === "completed") {
        // Session was cancelled while waiting — skip
        logger.info({ sessionId }, "Scheduled session was cancelled, skipping");
        return;
      }

      // Load repo (needed for workspace path and context)
      const repo = await connection.getRepo(repoId);

      if (!repo) {
        throw new Error(`Repo ${repoId} not found`);
      }

      // Handle resume — works for any session type with an active CLI process
      if (isResume) {
        const session = await connection.getSession(sessionId);

        if (!session || session.status !== "active") {
          logger.warn(
            { sessionId, status: session?.status },
            "Session no longer eligible for resume",
          );
          return;
        }

        const { workDir } = getSessionWorkspace(repoId, sessionId, type, repo.repo ?? null);

        // Rebuild session options so the parser has output/tool callbacks.
        // After a worker restart the in-memory lastSessionContext is gone,
        // so we must always supply fresh options here.
        const permissionArgs = getPermissionArgs(type);
        const systemPromptArgs = await getSystemPromptArgs(type);

        const onOutput = type !== "working" && type !== "repo"
          ? createOutputDetector(connection, { sessionId, repoId, sessionType: type })
          : undefined;

        let lastResumeActivityLabel: string | null = null;
        const onToolActivity = (toolName: string, label: string) => {
          void connection.publishSync(`sync:session:${sessionId}:messages`, {
            action: "tool_activity" as "updated",
            data: { sessionId, toolName, label, _ephemeral: true },
            timestamp: Date.now(),
          });

          if (label !== lastResumeActivityLabel) {
            lastResumeActivityLabel = label;
            void connection.updateSessionStatus(sessionId, "active", {
              metadata: { currentActivity: label },
            });
            void connection.publishSync(syncChannel("session"), {
              action: "updated",
              data: { id: sessionId, metadata: { currentActivity: label } },
              timestamp: Date.now(),
            });
          }
        };

        // Pass px CLI env vars for architecture, working, debug, and repo sessions on resume
        const resumeEnv = type === "architecture" || type === "working" || type === "repo" || type === "debug"
          ? buildPxEnv({ entityId: session.entityId ?? undefined, repoId, sessionId, autoAccept })
          : undefined;

        await sessionManager.resume(sessionId, workDir, resumeEnv, {
          outputRole: type === "working" || type === "repo" ? "system" : "assistant",
          flushIntervalMs: 2000,
          onOutput,
          onToolActivity,
          permissionArgs,
          systemPromptArgs,
          sessionType: type,
        });

        // Send resume message to CLI process
        let resumeMsg: string;
        if (job.data.resumeMessage) {
          resumeMsg = job.data.resumeMessage;
        } else if (isAutoResume) {
          resumeMsg = "Continue where you left off. The worker was restarted.";
        } else {
          resumeMsg = generateResumeMessage(type, {
            epicId: session.entityType === "epic" ? (session.entityId ?? undefined) : undefined,
            taskId: session.entityType === "task" ? (session.entityId ?? undefined) : undefined,
          });
        }
        sessionManager.sendInput(sessionId, resumeMsg);
        logger.info({ sessionId, type, hasCustomMessage: !!job.data.resumeMessage, isAutoResume }, "Sent resume message to CLI");

        logger.info({ sessionId, type }, "Session resumed successfully");
        return;
      }

      // Mark session as active
      await connection.updateSessionStatus(sessionId, "active");

      await connection.publishSync(syncChannel("session"), {
        action: "updated",
        data: { id: sessionId, status: "active" },
        timestamp: Date.now(),
      });

      // For working sessions, ensure repo has CLAUDE.md / settings / .mcp.json set up.
      // Do this before worktree creation so symlinks for settings/.mcp work.
      if ((type === "working" || type === "repo") && repo.repo) {
        const { repoDir: sharedRepoDir } = ensureSharedClone(repoId, repo.repo);
        await ensureRepoInitialized(sharedRepoDir, repo.name);
      }

      // Get workspace path based on session type and repo config
      const { workDir } = getSessionWorkspace(repoId, sessionId, type, repo.repo ?? null);

      // Build the prompt and start options based on session type
      await startSession(connection, sessionManager, storage, {
        sessionId, repoId,
        repo: { name: repo.name, workspacePath: repo.workspacePath ?? null, repo: repo.repo ?? null, bdPrefix: repo.bdPrefix },
        type, entityType, entityId, workDir, phaseConfig, attachments, autoAccept,
      });

      logger.info({ sessionId, type }, "Session started successfully");
    } catch (error) {
      logger.error({ sessionId, err: error }, "Session start failed");

      const errorMessage = error instanceof Error ? error.message : String(error);
      const jobIsAutoResume = job.data.isAutoResume;

      if (jobIsAutoResume) {
        // Auto-resume failure: set status to 'paused' (recoverable) instead of 'error'
        await connection.updateSessionStatus(sessionId, "paused", { clearClaim: true });

        await connection.writeMessage(
          sessionId,
          "system",
          `Auto-resume failed: ${errorMessage}. Resume via the resume button.`,
          getConfig().WORKER_NAME,
        );

        await connection.publishSync(syncChannel("session"), {
          action: "updated",
          data: { id: sessionId, status: "paused" },
          timestamp: Date.now(),
        });

        await connection.publishSync(`sync:session:${sessionId}:messages`, {
          action: "created",
          data: {
            sessionId,
            role: "system",
            content: `Auto-resume failed: ${errorMessage}. Resume via the resume button.`,
          },
          timestamp: Date.now(),
        });
      } else {
        // User-initiated resume/start failure: existing behavior (status 'error')
        await connection.updateSessionStatus(sessionId, "error", {
          clearClaim: true,
          metadata: { error: errorMessage },
        });

        await connection.writeMessage(
          sessionId,
          "system",
          `Session failed to start: ${errorMessage}`,
          getConfig().WORKER_NAME,
        );

        await connection.publishSync(syncChannel("session"), {
          action: "updated",
          data: { id: sessionId, status: "error" },
          timestamp: Date.now(),
        });

        await connection.publishSync(`sync:session:${sessionId}:messages`, {
          action: "created",
          data: {
            sessionId,
            role: "system",
            content: `Session failed to start: ${errorMessage}`,
          },
          timestamp: Date.now(),
        });
      }

      throw error;
    }
  });
}

// ─── Unified Session Startup ─────────────────────────────────────

async function startSession(
  connection: WorkerConnection,
  sessionManager: SessionManager,
  storage: StorageAdapter,
  params: {
    sessionId: string;
    repoId: string;
    repo: { name: string; workspacePath: string | null; repo: string | null; bdPrefix: string };
    type: "spec" | "architecture" | "working" | "debug" | "repo";
    entityType?: string;
    entityId?: string;
    workDir: string;
    phaseConfig?: Array<{ phase: string; mode: "skip" | "full-ai" | "ai-assisted" }>;
    autoAccept?: boolean;
    attachments?: Array<{
      id: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      storageKey: string;
    }>;
  },
): Promise<void> {
  const { sessionId, repoId, repo, type, entityType, entityId, workDir, phaseConfig, attachments, autoAccept } = params;

  const session = await connection.getSession(sessionId);

  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  // Get permission and system prompt args early — needed to decide prompt strategy
  const permissionArgs = getPermissionArgs(type);
  const systemPromptArgs = await getSystemPromptArgs(type);

  // Build the prompt based on session type
  let prompt: string;

  if (type === "working") {
    // Load entity (task or epic) — use task.taskId (the short bd ID), not the UUID
    let entity: {
      taskId?: string | null;
      epicId?: string | null;
      title?: string | null;
      description?: string | null;
      taskContext?: string | null;
    } = {};

    if (entityId) {
      const task = await connection.getTask(entityId);

      if (task) {
        // Build inline task context so the agent has immediate reference
        const taskContext = await buildTaskContext(connection, task, entityId);

        entity = {
          taskId: task.isEpic ? null : (task.taskId ?? null),
          epicId: task.isEpic ? (task.taskId ?? null) : null,
          title: task.title,
          description: task.description,
          taskContext,
        };
      }
    }

    // Use skill-based prompt if available, otherwise generate full prompt
    const hasSkill = systemPromptArgs.length > 0;
    if (hasSkill && !session.prompt?.trim()) {
      prompt = generateWorkingInitialMessage(entity, { repoName: repo.name, projectPath: workDir });
    } else {
      prompt = generateWorkingPrompt(
        { prompt: session.prompt },
        entity,
        { repoName: repo.name, projectPath: workDir },
      );
    }
  } else if (type === "repo") {
    const hasSkill = systemPromptArgs.length > 0;
    if (hasSkill) {
      prompt = generateRepoSessionInitialMessage({ repoName: repo.name, projectPath: workDir });
    } else {
      prompt = generateRepoSessionPrompt({ repoName: repo.name, projectPath: workDir });
    }
  } else {
    // Build session context for conversational types
    const ctx = await loadSessionContext(connection, {
      repoId,
      repoName: repo.name,
      entityType,
      entityId,
    });

    // For debug sessions with an entity, build the rich debug context first
    if (type === "debug" && entityType && entityId) {
      const db = getDb();
      await handleDebugSession(db, { publish: (ch: string, ev: unknown) => connection.publishSync(ch, ev as import("@praxis2/shared").SyncEvent) }, {
        sessionId,
        repoId,
        entityType: entityType as "task" | "epic",
        entityId,
      });

      const sessionRow = await connection.getSession(sessionId);
      const metadata = sessionRow?.metadata as Record<string, unknown> | null;
      if (metadata?.systemPrompt && typeof metadata.systemPrompt === "string") {
        ctx.systemPrompt = metadata.systemPrompt;
      }
    }

    // Pass phase config for architecture sessions
    if (type === "architecture" && phaseConfig) {
      ctx.phaseConfig = phaseConfig;
    }

    // Use context-only message when skill handles behavioral instructions,
    // full prompt as fallback when no skill is available
    const hasSkill = systemPromptArgs.length > 0;
    if (hasSkill) {
      prompt = generateInitialMessage(type, ctx);
    } else {
      prompt = generateConversationalPrompt(type, ctx);
    }
  }

  // Wire up output detection for spec/proposal patterns (all types)
  const onOutput = type !== "working" && type !== "repo"
    ? createOutputDetector(connection, { sessionId, repoId, sessionType: type })
    : undefined;

  // Wire up tool activity for ephemeral pubsub events + session metadata
  let lastActivityLabel: string | null = null;
  const onToolActivity = (toolName: string, label: string) => {
    void connection.publishSync(`sync:session:${sessionId}:messages`, {
      action: "tool_activity" as "updated",
      data: { sessionId, toolName, label, _ephemeral: true },
      timestamp: Date.now(),
    });

    // Persist to session metadata so the session list can show activity.
    // Only write if the label changed to avoid redundant DB updates.
    if (label !== lastActivityLabel) {
      lastActivityLabel = label;
      void connection.updateSessionStatus(sessionId, "active", {
        metadata: { currentActivity: label },
      });
      void connection.publishSync(syncChannel("session"), {
        action: "updated",
        data: { id: sessionId, metadata: { currentActivity: label } },
        timestamp: Date.now(),
      });
    }
  };

  // Save the initial prompt as a user message so it appears in the UI.
  // For conversational types, show a clean summary instead of raw instructions.
  const displayMessage = buildDisplayMessage(type, params);
  await connection.writeMessage(sessionId, "user", displayMessage);
  await connection.publishSync(`sync:session:${sessionId}:messages`, {
    action: "created",
    data: { sessionId, role: "user", content: displayMessage },
    timestamp: Date.now(),
  });

  // Pass px CLI env vars for architecture, working, debug, and repo sessions
  const pxEnv = type === "architecture" || type === "working" || type === "repo" || type === "debug"
    ? buildPxEnv({ entityId, repoId, sessionId, autoAccept })
    : undefined;

  // Deliver file attachments to the workspace before starting the session
  if (attachments?.length) {
    const logger = getLogger();
    const uploadsDir = join(workDir, "uploads");
    await mkdir(uploadsDir, { recursive: true });

    for (const attachment of attachments) {
      const { data } = await storage.download(attachment.storageKey);
      await writeFile(join(uploadsDir, attachment.filename), data);
    }

    // Augment the prompt with file references so the AI knows about them
    const fileRefs = attachments
      .map((a) => `- uploads/${a.filename} (${a.mimeType}, ${a.sizeBytes} bytes)`)
      .join("\n");
    prompt = `${prompt}\n\n[Attached files delivered to workspace:\n${fileRefs}\n]`;

    logger.info(
      { sessionId, attachmentCount: attachments.length },
      "Delivered file attachments to workspace",
    );
  }

  await sessionManager.start(sessionId, prompt, workDir, pxEnv, {
    outputRole: type === "working" || type === "repo" ? "system" : "assistant",
    flushIntervalMs: 2000,
    onOutput,
    onToolActivity,
    permissionArgs,
    systemPromptArgs,
    sessionType: type,
  });
}

/**
 * Builds a clean user-facing display message for the initial prompt.
 * This appears in the chat UI so the user can see what context was sent.
 */
function buildDisplayMessage(
  type: "spec" | "architecture" | "working" | "debug" | "repo",
  params: {
    repo: { name: string };
    entityType?: string;
    entityId?: string;
    phaseConfig?: Array<{ phase: string; mode: "skip" | "full-ai" | "ai-assisted" }>;
  },
): string {
  switch (type) {
    case "spec":
      return "Start spec workshop session.";
    case "architecture": {
      const lines = ["Start architecture session."];
      if (params.phaseConfig && params.phaseConfig.some((p) => p.mode !== "ai-assisted")) {
        const summary = params.phaseConfig
          .filter((p) => p.mode !== "ai-assisted")
          .map((p) => `${p.phase}: ${p.mode === "full-ai" ? "AI Automate" : "Skip"}`)
          .join(", ");
        lines.push(`Phase config: ${summary}`);
      }
      return lines.join("\n");
    }
    case "debug":
      return "Start debug session.";
    case "working":
      return "Start working session.";
    case "repo":
      return "Start repo chat session.";
  }
}

// ─── Session Context Loading ────────────────────────────────────────

async function loadSessionContext(
  connection: WorkerConnection,
  params: { repoId: string; repoName: string; entityType?: string; entityId?: string },
): Promise<SessionContext> {
  const ctx: SessionContext = { repoName: params.repoName };

  // Load spec for this repo
  const spec = await connection.getSpec(params.repoId);
  if (spec) {
    ctx.spec = spec.content;
    ctx.existingSpec = spec.content;
  }

  // Load entity context based on type
  if (params.entityType === "idea" && params.entityId) {
    const idea = await connection.getIdea(params.entityId);
    if (idea) {
      ctx.ideaTitle = idea.title;
      ctx.ideaDescription = idea.description;
    }
  }

  if (
    (params.entityType === "epic" || params.entityType === "task") &&
    params.entityId
  ) {
    const task = await connection.getTask(params.entityId);
    if (task) {
      ctx.entityTitle = task.title;
      ctx.entityType = params.entityType;
      ctx.entityDescription = task.description;
    }
  }

  return ctx;
}

// ─── Output Detection ───────────────────────────────────────────────

/**
 * Creates a callback that scans accumulated CLI output for spec/proposal patterns.
 * Uses a Set to track already-processed matches so we don't double-process.
 */
function createOutputDetector(
  connection: WorkerConnection,
  params: { sessionId: string; repoId: string; sessionType: string },
): (accumulatedContent: string) => void {
  const logger = getLogger();
  const processed = new Set<string>();

  return (accumulatedContent: string) => {
    // Run detection async — don't block the flush pipeline
    void detectOutputs(accumulatedContent).catch((err) => {
      logger.warn({ err, sessionId: params.sessionId }, "Output detection error");
    });
  };

  async function detectOutputs(content: string): Promise<void> {
    // Check for spec output
    const specMatch = content.match(/```spec\n([\s\S]*?)```/);
    if (specMatch && params.sessionType === "spec") {
      const specContent = specMatch[1];
      const specKey = `spec:${specContent.slice(0, 50)}`;
      if (!processed.has(specKey)) {
        processed.add(specKey);
        await handleSpecOutput(connection, params.repoId, specContent);
      }
    }
  }
}

async function handleSpecOutput(
  connection: WorkerConnection,
  repoId: string,
  specContent: string,
): Promise<void> {
  await connection.upsertSpec(repoId, "Project Spec", specContent);

  // We don't know if it was created vs updated from the upsert call,
  // but "updated" is safe for the sync event in both cases.
  await connection.publishSync(syncChannel("spec"), {
    action: "updated",
    data: { repoId },
    timestamp: Date.now(),
  });
}

// ─── PX CLI Environment ──────────────────────────────────────────

/**
 * Builds env vars that expose the `praxis` CLI to architecture sessions.
 * Detects dev (.ts) vs prod (.js) to pick the right runner.
 */
export function buildPxEnv(params: {
  entityId?: string;
  repoId: string;
  sessionId: string;
  autoAccept?: boolean;
}): Record<string, string> {
  const thisFile = fileURLToPath(import.meta.url);
  const isDev = thisFile.endsWith(".ts");

  let cliPath: string;
  let cliRunner: string;

  if (isDev) {
    // Dev: use file path + tsx (praxis isn't globally installed in dev)
    cliPath = thisFile.replace(/\/jobs\/session-start\.ts$/, "/cli/praxis.ts");
    cliRunner = "tsx";
    if (!existsSync(cliPath)) {
      console.warn(`[buildPxEnv] PX_CLI path does not exist: ${cliPath}`);
    }
  } else {
    // Prod: use the globally installed `praxis` binary
    cliPath = "praxis";
    cliRunner = "";
  }

  const env: Record<string, string> = {
    PX_CLI: cliPath,
    PX_CLI_RUNNER: cliRunner,
    PX_REPO_ID: params.repoId,
    PX_SESSION_ID: params.sessionId,
  };
  if (params.entityId) {
    env.PX_IDEA_ID = params.entityId;
  }
  if (params.autoAccept) {
    env.PX_AUTO_ACCEPT = "true";
  }
  return env;
}

// ─── Task Context Building ──────────────────────────────────────

/**
 * Builds a text summary of task context for embedding in prompts.
 * For epics: lists all child tasks with status, priority, and deps.
 * For single tasks: shows the task's details and dependency info.
 */
async function buildTaskContext(
  connection: WorkerConnection,
  task: { id: string; taskId: string | null; isEpic: boolean; title: string; description: string | null; status: string; priority: string; parentId: string | null },
  entityId: string,
): Promise<string | null> {
  if (task.isEpic) {
    // Collect all children + their deps
    const descendants = await connection.getTaskDescendants(entityId);
    if (descendants.length === 0) return null;

    // Build UUID → taskId lookup
    const idLookup = new Map<string, string>();
    if (task.taskId) idLookup.set(task.id, task.taskId);
    for (const d of descendants) {
      if (d.taskId) idLookup.set(d.id, d.taskId);
    }

    // Load deps for all descendants
    const depMap = new Map<string, string[]>();
    for (const d of descendants) {
      const deps = await connection.getTaskDependencies(d.id);
      for (const dep of deps) {
        const blockerId = idLookup.get(dep.dependsOnId);
        if (blockerId) {
          const list = depMap.get(d.id) ?? [];
          list.push(blockerId);
          depMap.set(d.id, list);
        }
      }
    }

    const lines: string[] = [
      `${"ID".padEnd(16)} ${"Status".padEnd(14)} ${"Priority".padEnd(10)} ${"Deps".padEnd(20)} Title`,
      `${"─".repeat(16)} ${"─".repeat(14)} ${"─".repeat(10)} ${"─".repeat(20)} ${"─".repeat(30)}`,
    ];

    for (const d of descendants) {
      const dId = d.taskId ?? "?";
      const dStatus = d.status as string;
      const dPriority = d.priority as string;
      const dTitle = d.title;
      const dDeps = depMap.get(d.id)?.join(", ") ?? "";
      lines.push(
        `${dId.padEnd(16)} ${dStatus.padEnd(14)} ${dPriority.padEnd(10)} ${dDeps.padEnd(20)} ${dTitle}`,
      );
    }

    return lines.join("\n");
  } else {
    // Single task — show details + deps
    const deps = await connection.getTaskDependencies(entityId);

    const depTaskIds: string[] = [];
    for (const dep of deps) {
      const depTask = await connection.getTask(dep.dependsOnId);
      if (depTask?.taskId) depTaskIds.push(depTask.taskId);
    }

    // Find parent taskId
    let parentTaskId: string | null = null;
    if (task.parentId) {
      const parent = await connection.getTask(task.parentId);
      parentTaskId = parent?.taskId ?? null;
    }

    const lines: string[] = [
      `ID: ${task.taskId}`,
      `Status: ${task.status}`,
      `Priority: ${task.priority}`,
    ];
    if (parentTaskId) lines.push(`Parent: ${parentTaskId}`);
    if (depTaskIds.length > 0) lines.push(`Dependencies: ${depTaskIds.join(", ")}`);

    return lines.join("\n");
  }
}
