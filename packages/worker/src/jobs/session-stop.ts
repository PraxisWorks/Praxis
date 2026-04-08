import { syncChannel } from "@praxis2/shared";
import { getLogger } from "../logger.js";
import type { SessionManager } from "../sessions/session-manager.js";
import type { WorkerConnection } from "../connection/index.js";

type SessionStopPayload = {
  sessionId: string;
  action?: "pause" | "stop";
};

export async function registerSessionStopHandler(
  connection: WorkerConnection,
  sessionManager: SessionManager,
  queueName: string,
): Promise<void> {
  const logger = getLogger();

  await connection.onJob<SessionStopPayload>(queueName, async (job) => {
    const { sessionId, action } = job.data;
    logger.info({ sessionId, action, jobId: job.id }, "Processing session.stop job");

    // Load session to determine type
    const session = await connection.getSession(sessionId);

    // If session not found in DB (e.g., cascade deleted), still try to kill
    // the process in case SessionManager is tracking it, then return.
    if (!session) {
      if (sessionManager.isAlive(sessionId)) {
        await sessionManager.stop(sessionId);
        logger.info({ sessionId }, "Killed orphaned process for deleted session");
      }
      return;
    }

    const { type } = session;

    // Pause action: kill the child process, clear claim so it can be resumed.
    // (the API already set status to "paused")
    if (action === "pause") {
      await sessionManager.stop(sessionId);
      await connection.updateSessionStatus(sessionId, session.status, { clearClaim: true });
      logger.info({ sessionId, type }, "Session paused (process killed, claim cleared)");
      return;
    }

    // Stop: kill the CLI process for all session types
    const exitCode = await sessionManager.stop(sessionId);
    const finalStatus: "completed" | "error" =
      exitCode !== null && exitCode !== 0 ? "error" : "completed";

    // The job handler owns the final status write for managed sessions.
    // Clear claimedBy so the session can be restarted (e.g. via remake).
    await connection.updateSessionStatus(sessionId, finalStatus, { clearClaim: true });

    await connection.publishSync(syncChannel("session"), {
      action: "updated",
      data: { id: sessionId, status: finalStatus },
      timestamp: Date.now(),
    });

    logger.info({ sessionId, type }, "Session stopped successfully");
  });
}
