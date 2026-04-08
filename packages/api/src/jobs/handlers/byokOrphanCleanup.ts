import type PgBoss from "pg-boss";
import { eq } from "drizzle-orm";
import { getLogger } from "../../lib/logger.js";
import { getDb } from "../../db/index.js";
import { apiKeys, workers } from "../../db/schema.js";
import { getPodProvisionerAdapter } from "../../services/pod-provisioner/index.js";

export const BYOK_ORPHAN_CLEANUP = "byok-orphan-cleanup";

export async function registerByokOrphanCleanupHandler(
  boss: PgBoss,
): Promise<void> {
  // Schedule to run every 5 minutes
  await boss.schedule(BYOK_ORPHAN_CLEANUP, "*/5 * * * *", {});

  await boss.work(BYOK_ORPHAN_CLEANUP, async ([job]) => {
    const logger = getLogger();
    const db = getDb();
    const provisioner = getPodProvisionerAdapter();

    logger.info({ jobId: job.id }, "Starting BYOK orphan cleanup");

    // 1) Find BYOK workers whose API key has been revoked
    const orphanedByRevoked = await db
      .select({
        workerId: workers.id,
        workerName: workers.name,
        apiKeyId: workers.apiKeyId,
      })
      .from(workers)
      .innerJoin(apiKeys, eq(workers.apiKeyId, apiKeys.id))
      .where(eq(apiKeys.status, "revoked"));

    for (const orphan of orphanedByRevoked) {
      const podName = `byok-${orphan.workerId}`;
      logger.info(
        { podName, workerId: orphan.workerId, apiKeyId: orphan.apiKeyId },
        "Cleaning up orphaned BYOK pod (revoked key)",
      );

      try {
        await provisioner.deletePod({ name: podName, namespace: "praxis-byok" });
      } catch (err) {
        logger.warn({ podName, err }, "Failed to delete orphaned pod (may already be gone)");
      }

      // Mark worker offline
      await db
        .update(workers)
        .set({ status: "offline", updatedAt: new Date() })
        .where(eq(workers.id, orphan.workerId));
    }

    // 2) Find BYOK workers whose API key is in error status
    const orphanedByError = await db
      .select({
        workerId: workers.id,
        apiKeyId: workers.apiKeyId,
      })
      .from(workers)
      .innerJoin(apiKeys, eq(workers.apiKeyId, apiKeys.id))
      .where(eq(apiKeys.status, "error"));

    for (const orphan of orphanedByError) {
      const podName = `byok-${orphan.workerId}`;
      logger.info(
        { podName, apiKeyId: orphan.apiKeyId },
        "Cleaning up orphaned BYOK pod (error key)",
      );

      try {
        await provisioner.deletePod({ name: podName, namespace: "praxis-byok" });
      } catch (err) {
        logger.warn({ podName, err }, "Failed to delete orphaned pod");
      }

      await db
        .update(workers)
        .set({ status: "offline", updatedAt: new Date() })
        .where(eq(workers.id, orphan.workerId));
    }

    const totalCleaned = orphanedByRevoked.length + orphanedByError.length;
    logger.info({ jobId: job.id, totalCleaned }, "BYOK orphan cleanup complete");
  });

  getLogger().info(
    `Registered scheduled handler for ${BYOK_ORPHAN_CLEANUP} (every 5 minutes)`,
  );
}
