import { SESSION_START, workerQueue } from "@praxis2/shared";
import { getLogger } from "../logger.js";
import { getConfig } from "../config.js";
import type { WorkerConnection } from "../connection/index.js";

function formatDowntime(ms: number | null): string {
  if (ms === null || ms < 0) return "unknown duration";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

/**
 * Runs ONCE at Worker startup (not on a polling interval). Finds any sessions
 * the DB thinks are "active" or "error" that have no corresponding child
 * process (because the Worker restarted). Clears their claimedBy and enqueues
 * a SESSION_START job with isResume + isAutoResume so they are automatically
 * picked back up.
 *
 * Only reconciles sessions belonging to this worker (by workerId). The central
 * worker (no WORKER_ID) reconciles sessions with workerId = null.
 *
 * "error" sessions are included because a race condition during graceful
 * shutdown can mark sessions as "error" (child process receives propagated
 * SIGTERM and exits before shutdownAll sets stoppedExternally).
 */
export async function autoResumeOrphanedSessions(
  connection: WorkerConnection,
  workerId?: string,
): Promise<void> {
  const logger = getLogger();

  const CENTRAL_UUID = "00000000-0000-0000-0000-000000000000";
  const effectiveWorkerId = workerId ?? CENTRAL_UUID;

  // Get the worker's last heartbeat before this startup
  const lastSeenAt = await connection.getWorkerLastSeen(effectiveWorkerId);
  const downtimeMs = lastSeenAt ? Date.now() - lastSeenAt.getTime() : null;

  // Find orphaned sessions (active/error with a claim) for this worker
  const activeSessions = await connection.getOrphanedSessions(workerId ?? null);

  // Exclude scheduled sessions — they're waiting for their pg-boss startAfter timer
  const sessionsToResume = activeSessions.filter(s => s.status !== "scheduled");

  if (sessionsToResume.length === 0) {
    logger.info("No orphaned sessions found on startup");
    return;
  }

  logger.info(
    { count: sessionsToResume.length },
    "Found orphaned sessions, auto-resuming",
  );

  const downtimeStr = formatDowntime(downtimeMs);

  for (const session of sessionsToResume) {
    // Clear claimedBy so the session can be picked up again — status stays active
    await connection.updateSessionStatus(session.id, session.status, {
      clearClaim: true,
    });

    const messageContent = `Worker back online after ${downtimeStr} — auto-resuming session`;

    await connection.writeMessage(
      session.id,
      "system",
      messageContent,
      getConfig().WORKER_NAME,
    );

    await connection.publishSync(`sync:session:${session.id}:messages`, {
      action: "created",
      data: {
        sessionId: session.id,
        role: "system",
        content: messageContent,
      },
      timestamp: Date.now(),
    });

    // Enqueue a SESSION_START job so the session handler picks it back up
    const queueName = workerId
      ? workerQueue(SESSION_START, workerId)
      : SESSION_START;
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

    logger.info({ sessionId: session.id }, "Orphaned session queued for auto-resume");
  }
}
