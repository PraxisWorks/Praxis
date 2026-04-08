import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { StorageAdapter } from "../storage.js";
import { getLogger } from "../logger.js";
import type { SessionManager } from "../sessions/session-manager.js";
import { getSessionWorkspace } from "../sessions/workspace-manager.js";
import { buildPxEnv } from "./session-start.js";
import { getPermissionArgs } from "../sessions/permissions.js";
import { getSystemPromptArgs } from "../sessions/skills.js";
import { buildChildPath } from "../child-env.js";
import type { WorkerConnection } from "../connection/index.js";

type SessionMessagePayload = {
  sessionId: string;
  content: string;
  attachments?: Array<{
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    storageKey: string;
  }>;
};

export async function registerSessionMessageHandler(
  connection: WorkerConnection,
  sessionManager: SessionManager,
  storage: StorageAdapter,
  queueName: string,
): Promise<void> {
  const logger = getLogger();

  await connection.onJob<SessionMessagePayload>(queueName, async (job) => {
    const { sessionId, content, attachments } = job.data;
    logger.info({ sessionId, jobId: job.id }, "Processing session.message job");

    // Load session to verify it's active
    const session = await connection.getSession(sessionId);

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status !== "active") {
      throw new Error(
        `Session ${sessionId} is not active (status: ${session.status})`,
      );
    }

    // Deliver file attachments to the workspace and augment the message
    let augmentedContent = content;
    if (attachments?.length) {
      // Resolve workspace path so we can write files into it
      const repo = await connection.getRepo(session.repoId);

      const { workDir: attachDir } = getSessionWorkspace(
        session.repoId,
        sessionId,
        session.type,
        repo?.repo ?? null,
      );

      const uploadsDir = join(attachDir, "uploads");
      await mkdir(uploadsDir, { recursive: true });

      for (const attachment of attachments) {
        try {
          const { data } = await storage.download(attachment.storageKey);
          await writeFile(join(uploadsDir, attachment.filename), data);
        } catch (err) {
          logger.error(
            { err, sessionId, storageKey: attachment.storageKey },
            "Failed to deliver attachment to workspace",
          );
        }
      }

      const fileRefs = attachments
        .map((a) => `- uploads/${a.filename} (${a.mimeType}, ${a.sizeBytes} bytes)`)
        .join("\n");
      augmentedContent = `${content}\n\n[Attached files delivered to workspace:\n${fileRefs}\n]`;
      logger.info(
        { sessionId, attachmentCount: attachments.length },
        "Delivered file attachments to workspace",
      );
    }

    // Emit a "thinking" indicator so the UI shows immediate feedback
    // before the stream-json parser emits any tool/text events.
    await connection.publishSync(`sync:session:${sessionId}:messages`, {
      action: "updated",
      data: { sessionId, toolName: "thinking", label: "AI is thinking...", _ephemeral: true },
      timestamp: Date.now(),
    });

    // Build fallback context from DB in case the worker restarted and lost
    // in-memory session context (lastSessionContext Map is ephemeral).
    const repo = await connection.getRepo(session.repoId);

    const { workDir } = getSessionWorkspace(
      session.repoId,
      sessionId,
      session.type,
      repo?.repo ?? null,
    );

    const pxEnv = buildPxEnv({
      entityId: session.entityId ?? undefined,
      repoId: session.repoId,
      sessionId,
    });

    const mergedEnv: Record<string, string | undefined> = {
      ...process.env,
      ...pxEnv,
      PATH: buildChildPath(),
      BD_ACTOR: "claude-agent",
      CLAUDECODE: undefined,
      ANTHROPIC_API_KEY: undefined,
    };

    const sessionType = session.type as "spec" | "architecture" | "debug" | "working" | "repo";
    const permissionArgs = getPermissionArgs(sessionType);
    const systemPromptArgs = await getSystemPromptArgs(sessionType);

    // All session types now use the CLI — spawn a follow-up via --resume.
    // The user message is already persisted by the API's addMessage mutation.
    await sessionManager.sendInput(sessionId, augmentedContent, {
      workDir,
      env: mergedEnv,
      options: { permissionArgs, systemPromptArgs },
    });

    logger.info({ sessionId, type: session.type }, "Session message forwarded to CLI");
  });
}
