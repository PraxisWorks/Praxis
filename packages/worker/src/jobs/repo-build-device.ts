import { existsSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { syncChannel } from "@praxis2/shared";
import { rigs } from "@praxis2/api/schema";
import { getLogger } from "../logger.js";
import { getDb } from "../db.js";
import { executeCommand } from "./repo-create.js";
import { getConfig } from "../config.js";
import type { WorkerConnection } from "../connection/index.js";

export async function registerRepoBuildDeviceHandler(
  connection: WorkerConnection,
  queueName: string,
): Promise<void> {
  const logger = getLogger();

  await connection.onJob<{ repoId: string }>(queueName, async (job) => {
    const { repoId } = job.data;
    const db = getDb();
    logger.info({ repoId, jobId: job.id }, "Processing repo.build-device job");

    const [repo] = await db
      .select()
      .from(rigs)
      .where(eq(rigs.id, repoId))
      .limit(1);

    if (!repo) {
      throw new Error(`Repo ${repoId} not found`);
    }

    const repoDir = join(getConfig().WORKSPACE_ROOT, repo.name);
    const buildDeviceSh = join(repoDir, "scripts", "build-device.sh");

    if (!existsSync(buildDeviceSh)) {
      logger.info({ repoId }, "No build-device.sh found, skipping");
      return;
    }

    try {
      logger.info({ repoId, repoDir }, "Running build-device.sh");
      await executeCommand("./scripts/build-device.sh", [], {
        cwd: repoDir,
        timeout: 300_000,
        label: "build-device",
      });
      logger.info({ repoId }, "build-device.sh completed successfully");
    } catch (err) {
      logger.warn({ repoId, err }, "build-device.sh failed");
    }

    // Publish sync event so the UI knows the job finished
    await connection.publishSync(syncChannel("repo"), {
      action: "updated",
      data: repo,
      timestamp: Date.now(),
    });
  });
}
