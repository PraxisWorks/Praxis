import { SESSION_START, workerQueue } from "@praxis2/shared";
import { getLogger } from "../logger.js";
import { getConfig } from "../config.js";
import type { SessionManager } from "./session-manager.js";
import type { WorkerConnection } from "../connection/index.js";

/**
 * Runs ONCE at Worker startup. Finds any sessions the DB thinks are "active"
 * that have no corresponding child process (because the Worker restarted).
 * Clears claimedBy and enqueues a SESSION_START job to auto-resume them.
 *
 * Serves as a belt-and-suspenders backup for anything the startup
 * reconciliation missed.
 *
 * Only checks sessions belonging to this worker (by workerId). The central
 * worker (no WORKER_ID) checks sessions with workerId = null.
 */
export async function checkStaleSessions(
  connection: WorkerConnection,
  sessionManager: SessionManager,
  workerId?: string,
): Promise<void> {
  const logger = getLogger();

  // Find orphaned sessions for this worker
  const activeSessions = await connection.getOrphanedSessions(workerId ?? null);

  // Exclude scheduled sessions — they're waiting for their startAfter timer
  const sessionsToCheck = activeSessions.filter(s => s.status !== "scheduled");

  if (sessionsToCheck.length === 0) {
    logger.info("No stale sessions found on startup");
    return;
  }

  logger.info(
    { count: sessionsToCheck.length },
    "Checking for stale sessions",
  );

  for (const session of sessionsToCheck) {
    // Check if sessionManager still tracks this session
    if (sessionManager.isAlive(session.id)) {
      logger.info(
        { sessionId: session.id },
        "Session still alive, skipping",
      );
      continue;
    }

    // Clear claimedBy so the session can be picked up again
    await connection.updateSessionStatus(session.id, session.status, {
      clearClaim: true,
    });

    // Write system message explaining the auto-resume
    const messageContent = "Session detected without running process — auto-resuming";
    await connection.writeMessage(
      session.id,
      "system",
      messageContent,
      getConfig().WORKER_NAME,
    );

    // Publish sync event for the message
    await connection.publishSync(`sync:session:${session.id}:messages`, {
      action: "created",
      data: {
        sessionId: session.id,
        role: "system",
        content: messageContent,
      },
      timestamp: Date.now(),
    });

    // Enqueue auto-resume job
    const queueName = workerId ? workerQueue(SESSION_START, workerId) : SESSION_START;
    await connection.createQueue(queueName);
    await connection.sendJob(queueName, {
      sessionId: session.id,
      repoId: session.repoId,
      type: session.type,
      entityType: session.entityType,
      entityId: session.entityId,
      isResume: true,
      isAutoResume: true,
    });

    logger.info({ sessionId: session.id }, "Stale session queued for auto-resume");
  }
}
