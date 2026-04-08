import { eq, desc, inArray, isNotNull } from "drizzle-orm";
import { tracked } from "@trpc/server";
import { z } from "zod";
import {
  GhDeploymentListInputSchema,
  syncChannel,
  type SyncEvent,
  type GhDeployment,
} from "@praxis2/shared";
import { router, protectedProcedure } from "../trpc.js";
import { ghDeployments, ghWebhookConfigs, repos } from "../db/schema.js";
import { iterateEvents } from "../lib/iterateEvents.js";
import { requireDbUser } from "../lib/requireDbUser.js";
import { getUserOrgIds, shouldForwardOrgEvent } from "../lib/orgSyncFilter.js";
import { getGitHubAdapter } from "../services/github/index.js";

let eventId = 0;

export const ghDeploymentRouter = router({
  // List GitHub deployments, optionally filtered by repoId.
  // When repoId is provided, shows deployments for that repo.
  // When repoId is null/omitted, shows deployments across all user's orgs.
  list: protectedProcedure
    .input(GhDeploymentListInputSchema)
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      if (input.repoId) {
        // Single repo — verify access via org membership
        const [repo] = await ctx.db
          .select({ orgId: repos.orgId })
          .from(repos)
          .where(eq(repos.id, input.repoId))
          .limit(1);

        if (repo) {
          const userOrgIds = await getUserOrgIds(ctx.db, userId);
          if (!userOrgIds.has(repo.orgId)) {
            return []; // No access
          }
        }

        return ctx.db
          .select({
            id: ghDeployments.id,
            repoId: ghDeployments.repoId,
            githubDeploymentId: ghDeployments.githubDeploymentId,
            environment: ghDeployments.environment,
            status: ghDeployments.status,
            ref: ghDeployments.ref,
            description: ghDeployments.description,
            url: ghDeployments.url,
            creatorLogin: ghDeployments.creatorLogin,
            createdAt: ghDeployments.createdAt,
            updatedAt: ghDeployments.updatedAt,
            repoName: repos.name,
            repoColor: repos.color,
          })
          .from(ghDeployments)
          .innerJoin(repos, eq(ghDeployments.repoId, repos.id))
          .where(eq(ghDeployments.repoId, input.repoId))
          .orderBy(desc(ghDeployments.updatedAt));
      }

      // All repos — filter by user's orgs
      const userOrgIds = await getUserOrgIds(ctx.db, userId);
      if (userOrgIds.size === 0) return [];

      return ctx.db
        .select({
          id: ghDeployments.id,
          repoId: ghDeployments.repoId,
          githubDeploymentId: ghDeployments.githubDeploymentId,
          environment: ghDeployments.environment,
          status: ghDeployments.status,
          ref: ghDeployments.ref,
          description: ghDeployments.description,
          url: ghDeployments.url,
          creatorLogin: ghDeployments.creatorLogin,
          createdAt: ghDeployments.createdAt,
          updatedAt: ghDeployments.updatedAt,
          repoName: repos.name,
          repoColor: repos.color,
        })
        .from(ghDeployments)
        .innerJoin(repos, eq(ghDeployments.repoId, repos.id))
        .where(inArray(repos.orgId, [...userOrgIds]))
        .orderBy(desc(ghDeployments.updatedAt));
    }),

  // Diagnostic status for the Deployments page empty state.
  // Returns per-repo info so the frontend can explain *why* there are no deployments.
  status: protectedProcedure
    .input(z.object({ repoId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      const userOrgIds = await getUserOrgIds(ctx.db, userId);
      if (userOrgIds.size === 0) return { githubConfigured: false, repos: [] };

      const githubConfigured = getGitHubAdapter() !== null;

      // Get repos the user can see, optionally filtered
      const repoQuery = input?.repoId
        ? ctx.db
            .select({
              id: repos.id,
              name: repos.name,
              repo: repos.repo,
              webhookConfigId: ghWebhookConfigs.id,
            })
            .from(repos)
            .leftJoin(ghWebhookConfigs, eq(repos.id, ghWebhookConfigs.repoId))
            .where(eq(repos.id, input.repoId))
        : ctx.db
            .select({
              id: repos.id,
              name: repos.name,
              repo: repos.repo,
              webhookConfigId: ghWebhookConfigs.id,
            })
            .from(repos)
            .leftJoin(ghWebhookConfigs, eq(repos.id, ghWebhookConfigs.repoId))
            .where(inArray(repos.orgId, [...userOrgIds]));

      const repoRows = await repoQuery;

      const repoStatuses = repoRows.map((r) => ({
        id: r.id,
        name: r.name,
        hasRepo: r.repo !== null && r.repo !== "",
        hasWebhookConfig: r.webhookConfigId !== null,
      }));

      return { githubConfigured, repos: repoStatuses };
    }),

  // Real-time sync subscription — filter by org
  onSync: protectedProcedure.subscription(async function* ({ ctx, signal }) {
    const userId = requireDbUser(ctx);
    const userOrgIds = await getUserOrgIds(ctx.db, userId);

    for await (const event of iterateEvents<SyncEvent<GhDeployment & { orgId?: string }>>(
      ctx.pubsub,
      syncChannel("ghDeployment"),
      signal!,
    )) {
      const data = event.data as Record<string, unknown>;
      if (shouldForwardOrgEvent(data, userOrgIds)) {
        yield tracked(String(++eventId), event);
      }
    }
  }),
});
