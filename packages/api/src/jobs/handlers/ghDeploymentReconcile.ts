import type PgBoss from "pg-boss";
import { eq } from "drizzle-orm";
import { syncChannel, type SyncEvent, GH_DEPLOYMENT_RECONCILE } from "@praxis2/shared";
import { getDb } from "../../db/index.js";
import { ghWebhookConfigs, ghDeployments, repos } from "../../db/schema.js";
import { getGitHubAdapter } from "../../services/github/index.js";
import { getLogger } from "../../lib/logger.js";
import type { PgPubSub } from "../../pubsub.js";

export async function registerGhDeploymentReconcileHandler(
  boss: PgBoss,
  pubsub: PgPubSub,
): Promise<void> {
  // Schedule as cron — every 10 minutes
  await boss.schedule(GH_DEPLOYMENT_RECONCILE, "*/10 * * * *");

  await boss.work(GH_DEPLOYMENT_RECONCILE, async () => {
    const logger = getLogger();
    const db = getDb();
    const github = getGitHubAdapter();

    if (!github) {
      logger.debug("GITHUB_TOKEN not set — skipping deployment reconciliation");
      return;
    }

    // Get all repos with webhook configs
    const configs = await db.select().from(ghWebhookConfigs);

    if (configs.length === 0) {
      logger.debug("No webhook configs found — skipping reconciliation");
      return;
    }

    logger.info({ repoCount: configs.length }, "Starting deployment reconciliation");

    for (const config of configs) {
      try {
        // Call GitHub API to list deployments
        const result = await github.listDeploymentStatuses({
          owner: config.repoOwner,
          repo: config.repoName,
          perPage: 20,
        });

        if (!result.success || !result.statuses) {
          logger.warn(
            { repoId: config.repoId, error: result.error },
            "Failed to fetch deployments for reconciliation",
          );
          continue;
        }

        // Process each deployment status
        for (const status of result.statuses) {
          const deploymentData = {
            repoId: config.repoId,
            githubDeploymentId: String(status.deploymentId),
            environment: status.environment,
            status: status.state,
            ref: "",  // Not available from listDeploymentStatuses
            description: status.description ?? null,
            url: null as string | null,
            creatorLogin: null as string | null,
            createdAt: new Date(status.createdAt),
            updatedAt: new Date(status.createdAt),
          };

          const [upserted] = await db
            .insert(ghDeployments)
            .values(deploymentData)
            .onConflictDoUpdate({
              target: [ghDeployments.repoId, ghDeployments.githubDeploymentId],
              set: {
                status: deploymentData.status,
                description: deploymentData.description,
                updatedAt: deploymentData.updatedAt,
              },
            })
            .returning();

          // Publish sync event
          const [repo] = await db
            .select({ orgId: repos.orgId })
            .from(repos)
            .where(eq(repos.id, config.repoId))
            .limit(1);

          if (upserted) {
            await pubsub.publish(syncChannel("ghDeployment"), {
              action: "updated",
              data: { ...upserted, orgId: repo?.orgId },
              timestamp: Date.now(),
            } satisfies SyncEvent<typeof upserted & { orgId?: string }>);
          }
        }

        logger.info(
          { repoId: config.repoId, count: result.statuses.length },
          "Reconciled deployments",
        );

        // Rate limit: 100ms delay between repos
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (err) {
        logger.error(
          { err, repoId: config.repoId },
          "Error reconciling deployments for repo — continuing",
        );
      }
    }
  });
}
