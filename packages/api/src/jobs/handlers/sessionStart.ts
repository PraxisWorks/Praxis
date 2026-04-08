import type PgBoss from "pg-boss";
import { getLogger } from "../../lib/logger.js";
import { handleSpecSessionStart } from "../../services/ai/specSession.js";
import { handleArchitectureSessionStart } from "../../services/ai/architectureSession.js";

export const SESSION_START_JOB = "session.start";

type Payload = {
  sessionId: string;
  repoId: string;
  type: string;
  entityType?: string;
  entityId?: string;
};

export async function registerSessionStartHandler(
  boss: PgBoss,
): Promise<void> {
  await boss.work(SESSION_START_JOB, async (jobs) => {
    const logger = getLogger();

    for (const job of jobs) {
      const payload = job.data as Payload;

      logger.info(
        { jobId: job.id, sessionId: payload.sessionId, type: payload.type },
        "Processing session.start job",
      );

      switch (payload.type) {
        case "spec":
          await handleSpecSessionStart(payload.sessionId);
          break;

        case "architecture":
          await handleArchitectureSessionStart(payload.sessionId);
          break;

        case "debug":
          // Debug sessions are handled by the Worker's conversational engine
          // (dispatched via the worker's session-start job handler)
          break;

        // Other session types handled in later phases:
        // case "working": ...
        default:
          logger.info(
            { jobId: job.id, type: payload.type },
            "Session type not yet implemented, skipping",
          );
      }
    }
  });

  getLogger().info(`Registered handler for ${SESSION_START_JOB}`);
}
