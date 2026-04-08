import { z } from "zod";
import { eq, and, ne, inArray } from "drizzle-orm";
import { tracked, TRPCError } from "@trpc/server";
import {
  CreatePlanSchema,
  UpdatePlanProposalSchema,
  ProposalSchema,
  syncChannel,
  SESSION_STOP,
  type SyncEvent,
  type Plan,
} from "@praxis2/shared";
import { router, protectedProcedure } from "../trpc.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { plans, tasks, taskDependencies, ideas, rigs, sessions } from "../db/schema.js";
import { enqueueJob } from "../jobs/index.js";
import { getLogger } from "../lib/logger.js";
import { iterateEvents } from "../lib/iterateEvents.js";
import { requireDbUser } from "../lib/requireDbUser.js";
import { requireAccessibleRepo } from "../lib/requireAccessibleRepo.js";
import { requireOrgMember } from "../lib/requireOrgMember.js";
import { getUserOrgIds } from "../lib/orgSyncFilter.js";

let eventId = 0;

/**
 * Generate a short task ID.
 * Format: {prefix}-prx-{5-char random hex}
 * The prefix comes from the repo's bdPrefix field (e.g. "BD", "PX", etc.).
 */
function generateTaskId(prefix: string): string {
  const hex = Math.random().toString(16).slice(2, 7);
  return `${prefix}-prx-${hex}`;
}

export const planRouter = router({
  // Fetch plan for an idea
  getByIdea: requirePermission("plan:read")
    .input(z.object({ ideaId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Fetch the idea and verify access via its repo's org membership
      const [idea] = await ctx.db
        .select()
        .from(ideas)
        .where(eq(ideas.id, input.ideaId))
        .limit(1);

      if (!idea) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Idea not found" });
      }

      await requireAccessibleRepo(ctx.db, idea.repoId, userId);

      const [plan] = await ctx.db
        .select()
        .from(plans)
        .where(eq(plans.ideaId, input.ideaId))
        .limit(1);

      return plan ?? null;
    }),

  // Create a draft plan (called by worker after architecture session)
  create: protectedProcedure
    .input(CreatePlanSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Validate idea exists and verify access via its repo's org
      const [idea] = await ctx.db
        .select()
        .from(ideas)
        .where(eq(ideas.id, input.ideaId))
        .limit(1);

      if (!idea) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Idea not found" });
      }

      await requireAccessibleRepo(ctx.db, idea.repoId, userId);

      // Verify user has access to the target repo
      await requireAccessibleRepo(ctx.db, input.repoId, userId);

      // Check no existing non-rejected plan for this idea
      const [existing] = await ctx.db
        .select()
        .from(plans)
        .where(
          and(
            eq(plans.ideaId, input.ideaId),
            ne(plans.status, "rejected"),
          ),
        )
        .limit(1);

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A plan already exists for this idea",
        });
      }

      const [plan] = await ctx.db
        .insert(plans)
        .values({
          ideaId: input.ideaId,
          repoId: input.repoId,
          sessionId: input.sessionId,
          proposal: input.proposal,
          status: "draft",
        })
        .returning();

      await ctx.pubsub.publish(syncChannel("plan"), {
        action: "created",
        data: plan,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof plan>);

      return plan;
    }),

  // Update the proposal on a draft plan (inline editing from UI)
  updateProposal: protectedProcedure
    .input(UpdatePlanProposalSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const [existing] = await ctx.db
        .select()
        .from(plans)
        .where(eq(plans.id, input.id))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
      }

      // Verify user has access to the repo associated with this plan
      await requireAccessibleRepo(ctx.db, existing.repoId, userId);

      if (existing.status !== "draft") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Can only edit draft plans",
        });
      }

      const [updated] = await ctx.db
        .update(plans)
        .set({ proposal: input.proposal, updatedAt: new Date() })
        .where(eq(plans.id, input.id))
        .returning();

      await ctx.pubsub.publish(syncChannel("plan"), {
        action: "updated",
        data: updated,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof updated>);

      return updated;
    }),

  // Accept a plan -- atomically create epics + tasks + dependencies
  accept: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const [plan] = await ctx.db
        .select()
        .from(plans)
        .where(eq(plans.id, input.id))
        .limit(1);

      if (!plan) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
      }

      if (plan.status !== "draft") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Can only accept draft plans",
        });
      }

      // Load the repo to get bdPrefix for generateTaskId
      const [repo] = await ctx.db
        .select()
        .from(rigs)
        .where(eq(rigs.id, plan.repoId))
        .limit(1);

      if (!repo) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Repo not found" });
      }

      // Verify user is a member of the repo's org
      await requireOrgMember(ctx.db, repo.orgId, userId);

      // Parse and validate the proposal
      const proposal = ProposalSchema.parse(plan.proposal);

      // Load the idea to use its title/description for the parent epic
      const [idea] = await ctx.db
        .select()
        .from(ideas)
        .where(eq(ideas.id, plan.ideaId))
        .limit(1);

      if (!idea) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Idea not found" });
      }

      // Execute everything in a transaction
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await ctx.db.transaction(async (tx: any) => {
        // Map from proposal key -> created task UUID
        const keyToId = new Map<string, string>();

        // 0. Create a parent epic to wrap all plan epics under one umbrella
        const [parentEpic] = await tx
          .insert(tasks)
          .values({
            repoId: plan.repoId,
            ideaId: plan.ideaId,
            title: idea.title,
            description: idea.description,
            isEpic: true,
            status: "draft",
            priority: "medium",
            taskId: generateTaskId(repo.bdPrefix),
          })
          .returning();

        // 1. Create epic rows under the parent epic
        for (const epic of proposal.epics) {
          const [epicRow] = await tx
            .insert(tasks)
            .values({
              repoId: plan.repoId,
              parentId: parentEpic.id,
              ideaId: plan.ideaId,
              title: epic.title,
              description: epic.description,
              isEpic: true,
              status: "draft",
              priority: "medium",
              taskId: generateTaskId(repo.bdPrefix),
            })
            .returning();

          keyToId.set(epic.key, epicRow.id);

          // 2. Create task rows under this epic
          for (const task of epic.tasks) {
            const [taskRow] = await tx
              .insert(tasks)
              .values({
                repoId: plan.repoId,
                parentId: epicRow.id,
                ideaId: plan.ideaId,
                title: task.title,
                description: task.description,
                isEpic: false,
                status: "draft",
                priority: task.priority,
                taskId: generateTaskId(repo.bdPrefix),
              })
              .returning();

            keyToId.set(task.key, taskRow.id);
          }
        }

        // 3. Create task_dependencies entries
        for (const epic of proposal.epics) {
          for (const task of epic.tasks) {
            for (const depKey of task.dependsOn) {
              const taskId = keyToId.get(task.key);
              const dependsOnId = keyToId.get(depKey);
              if (taskId && dependsOnId) {
                await tx.insert(taskDependencies).values({
                  taskId,
                  dependsOnId,
                });
              }
            }
          }
        }

        // 4. Update plan status to accepted
        const [updatedPlan] = await tx
          .update(plans)
          .set({ status: "accepted", updatedAt: new Date() })
          .where(eq(plans.id, input.id))
          .returning();

        // 5. Update idea status to "planned"
        await tx
          .update(ideas)
          .set({ status: "planned", updatedAt: new Date() })
          .where(eq(ideas.id, plan.ideaId));

        return { plan: updatedPlan, keyToId };
      });

      // Publish sync events outside the transaction
      await ctx.pubsub.publish(syncChannel("plan"), {
        action: "updated",
        data: result.plan,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof result.plan>);

      await ctx.pubsub.publish(syncChannel("idea"), {
        action: "updated",
        data: { id: plan.ideaId, status: "planned" },
        timestamp: Date.now(),
      } satisfies SyncEvent<{ id: string; status: string }>);

      await ctx.pubsub.publish(syncChannel("task"), {
        action: "created",
        data: { planId: plan.id, count: result.keyToId.size },
        timestamp: Date.now(),
      } satisfies SyncEvent<{ planId: string; count: number }>);

      // Auto-complete the architecture session
      if (plan.sessionId) {
        try {
          await ctx.db
            .update(sessions)
            .set({ status: "completed", updatedAt: new Date() })
            .where(eq(sessions.id, plan.sessionId));

          await ctx.pubsub.publish(syncChannel("session"), {
            action: "updated",
            data: { id: plan.sessionId, status: "completed" },
            timestamp: Date.now(),
          } satisfies SyncEvent<{ id: string; status: string }>);

          await enqueueJob(SESSION_STOP, { sessionId: plan.sessionId });
        } catch (err) {
          getLogger().error(
            { err, sessionId: plan.sessionId },
            "Failed to auto-complete architecture session after plan acceptance",
          );
        }
      }

      return result.plan;
    }),

  // Reject a plan
  reject: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const [plan] = await ctx.db
        .select()
        .from(plans)
        .where(eq(plans.id, input.id))
        .limit(1);

      if (!plan) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
      }

      // Verify user has access to the repo associated with this plan
      await requireAccessibleRepo(ctx.db, plan.repoId, userId);

      if (plan.status !== "draft") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Can only reject draft plans",
        });
      }

      const [updated] = await ctx.db
        .update(plans)
        .set({ status: "rejected", updatedAt: new Date() })
        .where(eq(plans.id, input.id))
        .returning();

      // Reset the idea status back to "new" so the user can start a new session
      await ctx.db
        .update(ideas)
        .set({ status: "new", updatedAt: new Date() })
        .where(eq(ideas.id, plan.ideaId));

      await ctx.pubsub.publish(syncChannel("plan"), {
        action: "updated",
        data: updated,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof updated>);

      await ctx.pubsub.publish(syncChannel("idea"), {
        action: "updated",
        data: { id: plan.ideaId, status: "new" },
        timestamp: Date.now(),
      } satisfies SyncEvent<{ id: string; status: string }>);

      return updated;
    }),

  // Real-time sync subscription (org-scoped, requires auth)
  onSync: protectedProcedure.subscription(async function* ({ ctx, signal }) {
    const userId = requireDbUser(ctx);

    // Pre-load org repo IDs for filtering
    const userOrgIds = await getUserOrgIds(ctx.db, userId);
    const orgRigs = userOrgIds.size > 0
      ? await ctx.db
          .select({ id: rigs.id })
          .from(rigs)
          .where(inArray(rigs.orgId, [...userOrgIds]))
      : [];
    const userRigIds = new Set(orgRigs.map((r: { id: string }) => r.id));

    for await (const event of iterateEvents<SyncEvent<Plan>>(
      ctx.pubsub,
      syncChannel("plan"),
      signal!,
    )) {
      // Only yield events for plans belonging to the user's org repos
      const data = event.data as Record<string, unknown>;
      if (data.repoId && !userRigIds.has(data.repoId as string)) continue;
      yield tracked(String(++eventId), event);
    }
  }),
});
