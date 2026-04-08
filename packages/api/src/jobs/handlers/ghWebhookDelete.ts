import type PgBoss from "pg-boss";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import { ghWebhookConfigs } from "../../db/schema.js";
import { getGitHubAdapter } from "../../services/github/index.js";
import { getLogger } from "../../lib/logger.js";
import { GH_WEBHOOK_DELETE } from "@praxis2/shared";

type Payload = {
  repoId: string;
  repoOwner: string;
  repoName: string;
  githubWebhookId: number;
};

export async function registerGhWebhookDeleteHandler(boss: PgBoss): Promise<void> {
  await boss.work(GH_WEBHOOK_DELETE, async ([job]) => {
    const { repoId, repoOwner, repoName, githubWebhookId } = job.data as Payload;
    const logger = getLogger();
    const github = getGitHubAdapter();

    if (github) {
      const result = await github.deleteWebhook({
        owner: repoOwner,
        repo: repoName,
        hookId: githubWebhookId,
      });

      if (!result.success) {
        // 404 means already deleted — that's OK, just clean up local config
        logger.warn({ repoId, error: result.error }, "GitHub webhook delete failed (may already be deleted)");
      }
    } else {
      logger.warn({ repoId }, "GITHUB_TOKEN not set — skipping remote webhook deletion");
    }

    // Always clean up local config
    const db = getDb();
    await db
      .delete(ghWebhookConfigs)
      .where(eq(ghWebhookConfigs.repoId, repoId));

    logger.info({ repoId, repoOwner, repoName }, "GitHub webhook config cleaned up");
  });
}
