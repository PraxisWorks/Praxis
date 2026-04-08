import { z } from "zod";
import { eq, and, desc, inArray } from "drizzle-orm";
import { tracked, TRPCError } from "@trpc/server";
import {
  CreateRepoSchema,
  UpdateRepoSchema,
  MoveRepoSchema,
  SESSION_STOP,
  REPO_CREATE,
  REPO_BUILD_DEVICE,
  GH_WEBHOOK_REGISTER,
  GH_WEBHOOK_DELETE,
  syncChannel,
  type SyncEvent,
  type Repo,
} from "@praxis2/shared";
import { router, protectedProcedure } from "../trpc.js";
import { requirePermission, checkPermission } from "../middleware/requirePermission.js";
import { repos, sessions, ghWebhookConfigs } from "../db/schema.js";
import { checkLimitFromRole } from "../lib/checkLimit.js";
import { iterateEvents } from "../lib/iterateEvents.js";
import { enqueueJob } from "../jobs/index.js";
import { getLogger } from "../lib/logger.js";
import { requireDbUser } from "../lib/requireDbUser.js";
import { requireOrgMember } from "../lib/requireOrgMember.js";
import { resolveWorkerForSession } from "../lib/resolveWorkerForSession.js";
import { getUserOrgIds, shouldForwardOrgEvent } from "../lib/orgSyncFilter.js";

let eventId = 0;

// Helper: fetch a repo by ID and verify the user is a member of its org.
async function requireAccessibleRepo(
  db: any,
  repoId: string,
  userId: string,
) {
  const [repo] = await db
    .select()
    .from(repos)
    .where(eq(repos.id, repoId))
    .limit(1);

  if (!repo) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Repo not found" });
  }

  await requireOrgMember(db, repo.orgId, userId);
  return repo;
}

export const repoRouter = router({
  // List all repos in the user's organizations.
  // Optionally filter by orgId.
  list: requirePermission("repo:read")
    .input(z.object({ orgId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      if (input?.orgId) {
        // Verify membership and list repos in that org
        await requireOrgMember(ctx.db, input.orgId, userId);
        return ctx.db
          .select()
          .from(repos)
          .where(eq(repos.orgId, input.orgId))
          .orderBy(desc(repos.createdAt));
      }

      // List repos across all user's organizations
      const userOrgIds = await getUserOrgIds(ctx.db, userId);
      if (userOrgIds.size === 0) return [];

      return ctx.db
        .select()
        .from(repos)
        .where(inArray(repos.orgId, [...userOrgIds]))
        .orderBy(desc(repos.createdAt));
    }),

  // Get a single repo by ID. Verifies org membership.
  getById: requirePermission("repo:read")
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      return requireAccessibleRepo(ctx.db, input.id, userId);
    }),

  // Create a new repo. Requires repo:create (new from template) or repo:add (existing repo).
  create: protectedProcedure
    .input(CreateRepoSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      // Check the appropriate permission based on whether this is +New or +Add
      const requiredPerm = input.repo ? "repo:add" : "repo:create";
      await checkPermission(ctx, requiredPerm);
      await requireOrgMember(ctx.db, input.orgId, userId);

      // Enforce rig-per-org limit
      await checkLimitFromRole(ctx.db, ctx.dbUser!, "repos_per_org", input.orgId);

      const [repo] = await ctx.db
        .insert(repos)
        .values({
          orgId: input.orgId,
          userId,
          name: input.name,
          repo: input.repo ?? null,
          bdPrefix: input.bdPrefix,
          color: input.color,
          icon: input.icon ?? null,
          description: input.description ?? null,
          status: "creating",
        })
        .returning();

      // Route repo.create to the user's resolved worker so that the worker
      // picking up the job can actually see the repo under RLS. Without this
      // the job goes to the unscoped queue and any local worker (potentially
      // owned by a different user) may grab it, then fail with "Repo not
      // found" because RLS hides rows it doesn't own.
      const repoCreateWorkerId = await resolveWorkerForSession(
        ctx.db,
        userId,
        repo.id,
      );
      await enqueueJob(
        REPO_CREATE,
        { repoId: repo.id },
        { retryLimit: 0, ...(repoCreateWorkerId ? { workerId: repoCreateWorkerId } : {}) },
      );

      // Register GitHub webhook if repo has a repo URL
      if (input.repo) {
        await enqueueJob(GH_WEBHOOK_REGISTER, { repoId: repo.id, repo: input.repo });
      }

      await ctx.pubsub.publish(syncChannel("repo"), {
        action: "created",
        data: repo,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof repo>);

      return repo;
    }),

  // Update an existing repo. Requires org membership.
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: UpdateRepoSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      const repo = await requireAccessibleRepo(ctx.db, input.id, userId);

      const [updated] = await ctx.db
        .update(repos)
        .set({
          ...input.data,
          updatedAt: new Date(),
        })
        .where(eq(repos.id, input.id))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Repo not found" });
      }

      // Handle repo change → re-register webhook
      if (input.data.repo !== undefined && input.data.repo !== repo.repo) {
        // Delete old webhook if exists
        const [oldConfig] = await ctx.db
          .select()
          .from(ghWebhookConfigs)
          .where(eq(ghWebhookConfigs.repoId, input.id))
          .limit(1);

        if (oldConfig) {
          await enqueueJob(GH_WEBHOOK_DELETE, {
            repoId: input.id,
            repoOwner: oldConfig.repoOwner,
            repoName: oldConfig.repoName,
            githubWebhookId: oldConfig.githubWebhookId,
          });
        }

        // Register new webhook if new repo is set
        if (input.data.repo) {
          await enqueueJob(GH_WEBHOOK_REGISTER, { repoId: input.id, repo: input.data.repo });
        }
      }

      await ctx.pubsub.publish(syncChannel("repo"), {
        action: "updated",
        data: updated,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof updated>);

      return updated;
    }),

  // Delete a repo. Requires admin+ role in the org.
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      const repo = await requireAccessibleRepo(ctx.db, input.id, userId);

      // Require admin+ to delete repos
      await requireOrgMember(ctx.db, repo.orgId, userId, "admin");

      // Stop any active working sessions before cascade delete
      const activeSessions = await ctx.db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.repoId, input.id),
            eq(sessions.status, "active"),
            eq(sessions.type, "working"),
          ),
        );

      for (const session of activeSessions) {
        try {
          const sessionWorkerId = session.workerId ?? undefined;
          await enqueueJob(SESSION_STOP, { sessionId: session.id }, sessionWorkerId ? { workerId: sessionWorkerId } : undefined);
        } catch (err) {
          getLogger().error(
            { err, sessionId: session.id },
            "Failed to enqueue session.stop before repo delete",
          );
        }
      }

      // Delete GitHub webhook if exists
      const [webhookConfig] = await ctx.db
        .select()
        .from(ghWebhookConfigs)
        .where(eq(ghWebhookConfigs.repoId, input.id))
        .limit(1);

      if (webhookConfig) {
        await enqueueJob(GH_WEBHOOK_DELETE, {
          repoId: input.id,
          repoOwner: webhookConfig.repoOwner,
          repoName: webhookConfig.repoName,
          githubWebhookId: webhookConfig.githubWebhookId,
        });
      }

      await ctx.db
        .delete(repos)
        .where(eq(repos.id, input.id));

      await ctx.pubsub.publish(syncChannel("repo"), {
        action: "deleted",
        data: repo,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof repo>);

      return { success: true };
    }),

  // Trigger a build-device.sh run for an existing repo.
  buildDevice: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      const repo = await requireAccessibleRepo(ctx.db, input.id, userId);

      if (!repo.workspacePath) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Repo has no workspace — wait for creation to finish",
        });
      }

      // Route to the user's resolved worker for the same RLS reason as
      // repo.create above.
      const buildDeviceWorkerId = await resolveWorkerForSession(
        ctx.db,
        userId,
        repo.id,
      );
      await enqueueJob(
        REPO_BUILD_DEVICE,
        { repoId: repo.id },
        { retryLimit: 0, ...(buildDeviceWorkerId ? { workerId: buildDeviceWorkerId } : {}) },
      );
      return { success: true };
    }),

  // Move a repo to a different organization. Requires admin+ in both source and target org.
  move: protectedProcedure
    .input(MoveRepoSchema)
    .mutation(async ({ ctx, input }) => {
      const logger = getLogger();
      const userId = requireDbUser(ctx);

      // 1. Fetch repo and verify source org membership
      const repo = await requireAccessibleRepo(ctx.db, input.repoId, userId);
      const sourceOrgId = repo.orgId;

      // 2. Guard: can't move to same org
      if (sourceOrgId === input.targetOrgId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Repo is already in the target organization",
        });
      }

      // 3. Require admin+ in source org
      await requireOrgMember(ctx.db, sourceOrgId, userId, "admin");

      // 4. Require admin+ in target org
      await requireOrgMember(ctx.db, input.targetOrgId, userId, "admin");

      // 5. Guard: no active sessions
      const activeSessions = await ctx.db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.repoId, input.repoId),
            eq(sessions.status, "active"),
          ),
        );

      if (activeSessions.length > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Cannot move a repo with active sessions. Stop all sessions first.",
        });
      }

      // 6. Guard: bdPrefix uniqueness in target org
      const [prefixConflict] = await ctx.db
        .select()
        .from(repos)
        .where(
          and(
            eq(repos.orgId, input.targetOrgId),
            eq(repos.bdPrefix, repo.bdPrefix),
          ),
        )
        .limit(1);

      if (prefixConflict) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A repo with prefix "${repo.bdPrefix}" already exists in the target organization`,
        });
      }

      // 7. Update repo's org
      const [updated] = await ctx.db
        .update(repos)
        .set({ orgId: input.targetOrgId, updatedAt: new Date() })
        .where(eq(repos.id, input.repoId))
        .returning();

      // 8. Publish 'deleted' sync event with old orgId
      await ctx.pubsub.publish(syncChannel("repo"), {
        action: "deleted",
        data: { ...repo, orgId: sourceOrgId },
        timestamp: Date.now(),
      } satisfies SyncEvent<Repo>);

      // 9. Publish 'created' sync event with new orgId
      await ctx.pubsub.publish(syncChannel("repo"), {
        action: "created",
        data: updated,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof updated>);

      // 10. Log the move
      logger.info(
        { repoId: input.repoId, sourceOrgId, targetOrgId: input.targetOrgId, userId },
        "Repo moved between organizations",
      );

      return updated;
    }),

  // Real-time subscription for repo sync events.
  // Filters events to only yield those in the user's organizations.
  onSync: protectedProcedure.subscription(async function* ({ ctx, signal }) {
    const userId = requireDbUser(ctx);
    const userOrgIds = await getUserOrgIds(ctx.db, userId);

    for await (const event of iterateEvents<SyncEvent<Repo>>(
      ctx.pubsub,
      syncChannel("repo"),
      signal!,
    )) {
      const data = event.data as Record<string, unknown>;
      if (shouldForwardOrgEvent(data, userOrgIds)) {
        yield tracked(String(++eventId), event);
      }
    }
  }),
});
// ci-trigger 1775244998
