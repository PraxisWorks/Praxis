import type PgBoss from "pg-boss";
import { eq } from "drizzle-orm";
import { getLogger } from "../../lib/logger.js";
import { getDb } from "../../db/index.js";
import { sessions } from "../../db/schema.js";
import { handleSpecSessionMessage } from "../../services/ai/specSession.js";
import { handleArchitectureSessionMessage } from "../../services/ai/architectureSession.js";

export const SESSION_MESSAGE_JOB = "session.message";

type Payload = {
  sessionId: string;
  messageId: string;
  content: string;
};

export async function registerSessionMessageHandler(
  boss: PgBoss,
): Promise<void> {
  await boss.work(SESSION_MESSAGE_JOB, async (jobs) => {
    const logger = getLogger();

    for (const job of jobs) {
      const payload = job.data as Payload;

      logger.info(
        { jobId: job.id, sessionId: payload.sessionId },
        "Processing session.message job",
      );

      // Look up the session to determine its type
      const db = getDb();
      const [session] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, payload.sessionId))
        .limit(1);

      if (!session) {
        logger.error(
          { jobId: job.id, sessionId: payload.sessionId },
          "Session not found for message job",
        );
        continue;
      }

      switch (session.type) {
        case "spec":
          await handleSpecSessionMessage(payload.sessionId, payload.content);
          break;

        case "architecture":
          await handleArchitectureSessionMessage(
            payload.sessionId,
            payload.content,
          );
          break;

        // Other session types handled in later phases:
        // case "working": ...
        // case "debug": ...
        default:
          logger.info(
            { jobId: job.id, type: session.type },
            "Session type message handler not yet implemented",
          );
      }
    }
  });

  getLogger().info(`Registered handler for ${SESSION_MESSAGE_JOB}`);
}
