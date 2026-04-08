import { lt, eq, and, isNotNull, desc } from "drizzle-orm";
import { workers, sessions } from "../db/schema.js";
import { syncChannel, type SyncEvent } from "@praxis2/shared";
import type { PgPubSub } from "../pubsub.js";
import { getDb } from "../db/index.js";
import { getLogger } from "./logger.js";
import { recoverOrphanedSessions } from "./orphanSessionRecovery.js";
import { enqueueJob } from "../jobs/index.js";

const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes
export const BYOK_IDLE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

export async function checkStaleWorkers(pubsub: PgPubSub): Promise<void> {
  const db = getDb();
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

  const staleWorkers = await db
    .update(workers)
    .set({ status: "offline", updatedAt: new Date() })
    .where(
      and(
        eq(workers.status, "online"),
        lt(workers.lastSeenAt, cutoff),
      )
    )
    .returning();

  for (const worker of staleWorkers) {
    getLogger().info({ workerId: worker.id, lastSeenAt: worker.lastSeenAt }, "Marked stale worker as offline");
    await pubsub.publish(syncChannel("worker"), {
      action: "updated",
      data: worker,
      timestamp: Date.now(),
    } satisfies SyncEvent<typeof worker>);

    // Recover any active sessions that were running on this now-offline worker
    await recoverOrphanedSessions(worker.id, pubsub);
  }

  // ── BYOK idle check ─────────────────────────────────────────────
  // Online BYOK workers that have no active sessions for 15+ minutes
  // get enqueued for teardown (pod deletion, etc).
  await checkByokIdleWorkers();
}

export async function checkByokIdleWorkers(): Promise<void> {
  const db = getDb();
  const logger = getLogger();
  const idleCutoff = new Date(Date.now() - BYOK_IDLE_THRESHOLD_MS);

  // Find online BYOK workers (apiKeyId IS NOT NULL)
  const onlineByokWorkers = await db
    .select()
    .from(workers)
    .where(
      and(
        eq(workers.status, "online"),
        isNotNull(workers.apiKeyId),
      ),
    );

  for (const worker of onlineByokWorkers) {
    // Check for any active sessions on this worker
    const activeSessions = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.workerId, worker.id),
          eq(sessions.status, "active"),
        ),
      )
      .limit(1);

    if (activeSessions.length > 0) {
      continue; // Worker has active sessions — not idle
    }

    // No active sessions. Check the most recent session's updatedAt to
    // determine how long this worker has been idle.
    const [latestSession] = await db
      .select({ updatedAt: sessions.updatedAt })
      .from(sessions)
      .where(eq(sessions.workerId, worker.id))
      .orderBy(desc(sessions.updatedAt))
      .limit(1);

    // If the worker has never had a session, use createdAt as the reference.
    const lastActivity = latestSession?.updatedAt ?? worker.createdAt;

    if (lastActivity > idleCutoff) {
      continue; // Not idle long enough
    }

    logger.info(
      { workerId: worker.id, apiKeyId: worker.apiKeyId },
      "BYOK worker idle for 15+ minutes, enqueueing teardown",
    );
    await enqueueJob("byok-teardown-worker", { apiKeyId: worker.apiKeyId });
  }
}
