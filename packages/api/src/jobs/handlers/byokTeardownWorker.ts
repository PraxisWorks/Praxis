import type PgBoss from "pg-boss";
import { eq } from "drizzle-orm";
import { getLogger } from "../../lib/logger.js";
import { getDb, getConnectionString } from "../../db/index.js";
import { PgPubSub } from "../../pubsub.js";
import { syncChannel, type SyncEvent } from "@praxis2/shared";
import { apiKeys, workers } from "../../db/schema.js";
import { getPodProvisionerAdapter } from "../../services/pod-provisioner/index.js";

export const BYOK_TEARDOWN_WORKER = "byok-teardown-worker";

type Payload = {
  apiKeyId: string;
};

export async function registerByokTeardownWorkerHandler(
  boss: PgBoss,
): Promise<void> {
  await boss.work(BYOK_TEARDOWN_WORKER, async ([job]) => {
    const { apiKeyId } = job.data as Payload;
    const logger = getLogger();
    const db = getDb();

    logger.info({ jobId: job.id, apiKeyId }, "Starting BYOK worker teardown");

    // 1) Find worker row linked to this API key
    const [worker] = await db
      .select()
      .from(workers)
      .where(eq(workers.apiKeyId, apiKeyId))
      .limit(1);

    const provisioner = getPodProvisionerAdapter();

    // 2) Delete pod (idempotent — if already gone, log and continue)
    if (worker) {
      const podName = `byok-${worker.id}`;
      try {
        await provisioner.deletePod({ name: podName, namespace: "praxis-byok" });
        logger.info({ podName }, "BYOK pod deleted");
      } catch (err) {
        logger.warn({ podName, err }, "Pod deletion failed (may already be deleted)");
      }

      // 3) Mark worker offline
      await db
        .update(workers)
        .set({ status: "offline", updatedAt: new Date() })
        .where(eq(workers.id, worker.id));

      // 4) Publish sync event for worker status change
      const pubsub = new PgPubSub(getConnectionString());
      try {
        await pubsub.publish(syncChannel("worker"), {
          action: "updated",
          data: { ...worker, status: "offline" },
          timestamp: Date.now(),
        } satisfies SyncEvent<any>);
      } finally {
        await pubsub.close();
      }
    }

    // 5) Mark apiKey as revoked
    await db
      .update(apiKeys)
      .set({ status: "revoked", updatedAt: new Date() })
      .where(eq(apiKeys.id, apiKeyId));

    logger.info({ jobId: job.id, apiKeyId }, "BYOK worker teardown complete");
  });

  getLogger().info(`Registered handler for ${BYOK_TEARDOWN_WORKER}`);
}
