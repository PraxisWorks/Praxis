import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { GH_WEBHOOK_REGISTER } from "@praxis2/shared";
import { getDb } from "../../db/index.js";
import { repos, ghWebhookConfigs } from "../../db/schema.js";
import { enqueueJob } from "../index.js";
import { getGitHubAdapter } from "../../services/github/index.js";
import { getLogger } from "../../lib/logger.js";

/**
 * Enqueue GH_WEBHOOK_REGISTER for any repo that has a repo URL but no webhook config.
 * Runs once on startup — idempotent because ghWebhookRegister does onConflictDoUpdate.
 */
export async function backfillGhWebhooks(): Promise<void> {
  const logger = getLogger();

  if (!getGitHubAdapter()) {
    logger.debug("GITHUB_TOKEN not set — skipping webhook backfill");
    return;
  }

  const db = getDb();

  const reposWithoutWebhooks = await db
    .select({ id: repos.id, repo: repos.repo })
    .from(repos)
    .leftJoin(ghWebhookConfigs, eq(repos.id, ghWebhookConfigs.repoId))
    .where(and(isNotNull(repos.repo), isNull(ghWebhookConfigs.id)));

  if (reposWithoutWebhooks.length === 0) {
    logger.debug("No repos need webhook backfill");
    return;
  }

  logger.info(
    { count: reposWithoutWebhooks.length },
    "Backfilling GitHub webhooks for existing repos",
  );

  for (const repo of reposWithoutWebhooks) {
    if (repo.repo) {
      await enqueueJob(GH_WEBHOOK_REGISTER, { repoId: repo.id, repo: repo.repo });
    }
  }
}
