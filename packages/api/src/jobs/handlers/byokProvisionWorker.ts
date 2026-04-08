import type PgBoss from "pg-boss";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { hash } from "bcrypt";
import { getLogger } from "../../lib/logger.js";
import { getDb } from "../../db/index.js";
import { apiKeys, workers, workerTokens } from "../../db/schema.js";
import { getCryptoAdapter } from "../../services/crypto/index.js";
import { getPodProvisionerAdapter } from "../../services/pod-provisioner/index.js";

export const BYOK_PROVISION_WORKER = "byok-provision-worker";

type Payload = {
  apiKeyId: string;
  userId: string;
};

export async function registerByokProvisionWorkerHandler(boss: PgBoss): Promise<void> {
  await boss.work(BYOK_PROVISION_WORKER, async ([job]) => {
    const { apiKeyId, userId } = job.data as Payload;
    const logger = getLogger();
    const db = getDb();

    logger.info({ jobId: job.id, apiKeyId, userId }, "Starting BYOK worker provisioning");

    // 1) Fetch apiKey row, verify status is 'provisioning'
    const [apiKey] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, apiKeyId))
      .limit(1);

    if (!apiKey) {
      logger.error({ apiKeyId }, "API key not found");
      return;
    }

    if (apiKey.status !== "provisioning") {
      logger.warn({ apiKeyId, status: apiKey.status }, "API key not in provisioning status, skipping");
      return;
    }

    const provisioner = getPodProvisionerAdapter();
    const crypto = getCryptoAdapter();
    const podName = `byok-${apiKeyId.slice(0, 8)}-${Date.now()}`;

    try {
      // 2) Decrypt API key
      const decryptedKey = await crypto.decrypt(apiKey.encryptedKey);

      // 3) Generate one-time worker token (same as existing generateToken flow)
      const token = randomBytes(32).toString("hex");
      const tokenHash = await hash(token, 10);
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min TTL

      await db
        .insert(workerTokens)
        .values({ userId, tokenHash, expiresAt });

      // 4) Create BYOK pod via pod-provisioner adapter
      const result = await provisioner.createPod({
        name: podName,
        namespace: "praxis-byok",
        template: "byok-worker",
        secrets: {
          ANTHROPIC_API_KEY: decryptedKey,
          WORKER_TOKEN: token,
        },
      });

      logger.info({ podName: result.podName, status: result.status }, "BYOK pod created");

      // 5) Create worker row linked to this API key
      const [worker] = await db
        .insert(workers)
        .values({
          userId,
          name: `BYOK Worker (${apiKey.label})`,
          status: "online",
          lastSeenAt: new Date(),
          apiKeyId,
        })
        .returning();

      // 6) Update apiKey status to 'active'
      await db
        .update(apiKeys)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(apiKeys.id, apiKeyId));

      logger.info({ jobId: job.id, apiKeyId, workerId: worker.id }, "BYOK worker provisioning complete");
    } catch (err) {
      logger.error({ jobId: job.id, apiKeyId, err }, "BYOK worker provisioning failed");

      // Mark apiKey status as 'error'
      await db
        .update(apiKeys)
        .set({ status: "error", updatedAt: new Date() })
        .where(eq(apiKeys.id, apiKeyId));

      // Attempt to clean up orphaned pod
      try {
        await provisioner.deletePod({ name: podName, namespace: "praxis-byok" });
        logger.info({ podName }, "Cleaned up orphaned BYOK pod");
      } catch (cleanupErr) {
        logger.warn({ podName, cleanupErr }, "Failed to clean up orphaned pod");
      }

      throw err; // Re-throw so pg-boss marks job as failed and retries
    }
  });

  getLogger().info(`Registered handler for ${BYOK_PROVISION_WORKER}`);
}
