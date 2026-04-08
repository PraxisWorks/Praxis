import { eq, and } from "drizzle-orm";
import { sessions } from "../db/schema.js";
import { syncChannel } from "@praxis2/shared";
import type { PgPubSub } from "../pubsub.js";
import { getDb } from "../db/index.js";
import { getLogger } from "./logger.js";

/**
 * When a worker goes offline (ungraceful disconnect detected via stale heartbeat),
 * mark any active sessions on that worker as 'paused' so the UI can surface them.
 */
export async function recoverOrphanedSessions(
  workerId: string,
  pubsub: PgPubSub,
): Promise<void> {
  const db = getDb();
  const logger = getLogger();

  const orphaned = await db
    .update(sessions)
    .set({
      status: "paused",
      metadata: { reason: "worker_disconnected" },
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sessions.workerId, workerId),
        eq(sessions.status, "active"),
      ),
    )
    .returning();

  for (const session of orphaned) {
    logger.info(
      { sessionId: session.id, workerId },
      "Marked orphaned session as paused (worker disconnected)",
    );
    await pubsub.publish(syncChannel("session"), {
      action: "updated",
      data: { id: session.id, status: "paused", workerId },
      timestamp: Date.now(),
    });
  }

  if (orphaned.length > 0) {
    logger.info(
      { workerId, count: orphaned.length },
      "Recovered orphaned sessions from disconnected worker",
    );
  }
}
