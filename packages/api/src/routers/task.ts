import { z } from "zod";
import { eq, and, inArray, isNull, lt, desc } from "drizzle-orm";
import { tracked, TRPCError } from "@trpc/server";
import {
  CreateTaskSchema,
  UpdateTaskSchema,
  TaskDependencySchema,
  TaskListInputSchema,
  syncChannel,
  type SyncEvent,
  type Task,
} from "@praxis2/shared";
import { router, protectedProcedure } from "../trpc.js";
import { requirePermission } from "../middleware/requirePermission.js";
import type { Context } from "../context.js";
import { tasks, taskDependencies, rigs, ideas } from "../db/schema.js";
import { iterateEvents } from "../lib/iterateEvents.js";
import { requireDbUser } from "../lib/requireDbUser.js";
import { propagateInProgressUp, propagateCompleteUp } from "../lib/propagateTaskStatus.js";
import { requireAccessibleRepo } from "../lib/requireAccessibleRepo.js";
import { getUserOrgIds } from "../lib/orgSyncFilter.js";

let eventId = 0;

/**
 * Generate a short task ID.
 * Format: {prefix}-prx-{5-char random hex}
 */
function generateTaskId(prefix: string): string {
  const hex = Math.random().toString(16).slice(2, 7);
  return `${prefix}-prx-${hex}`;
}

export const taskRouter = router({
  // List tasks for a repo (or all repos when repoId is null), with optional filters
  list: requirePermission("task:read")
    .input(
      TaskListInputSchema.extend({
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Build dynamic conditions
      const conditions = [];

      if (input.repoId !== null) {
        // Verify user has access to this repo via org membership
        await requireAccessibleRepo(ctx.db, input.repoId, userId);

        conditions.push(eq(tasks.repoId, input.repoId));
      } else {
        // All Repos mode: restrict to rigs in the user's orgs
        const userOrgIds = await getUserOrgIds(ctx.db, userId);
        const orgRigs = await ctx.db
          .select({ id: rigs.id })
          .from(rigs)
          .where(inArray(rigs.orgId, [...userOrgIds]));

        const repoIds = orgRigs.map((r: { id: string }) => r.id);
        if (repoIds.length === 0) {
          return { items: [], nextCursor: null };
        }
        conditions.push(inArray(tasks.repoId, repoIds));
      }

      if (input.status) {
        conditions.push(eq(tasks.status, input.status));
      }

      // parentId === null means "top-level only" (isNull filter)
      // parentId === undefined means "no filter on parentId"
      if (input.parentId === null) {
        conditions.push(isNull(tasks.parentId));
      } else if (input.parentId !== undefined) {
        conditions.push(eq(tasks.parentId, input.parentId));
      }

      if (input.isEpic !== undefined) {
        conditions.push(eq(tasks.isEpic, input.isEpic));
      }

      if (input.ideaId) {
        conditions.push(eq(tasks.ideaId, input.ideaId));
      }

      if (input.cursor) {
        conditions.push(lt(tasks.createdAt, new Date(input.cursor)));
      }

      const rows = await ctx.db
        .select({
          id: tasks.id,
          repoId: tasks.repoId,
          parentId: tasks.parentId,
          ideaId: tasks.ideaId,
          title: tasks.title,
          description: tasks.description,
          notes: tasks.notes,
          status: tasks.status,
          priority: tasks.priority,
          isEpic: tasks.isEpic,
          taskId: tasks.taskId,
          statusChangedAt: tasks.statusChangedAt,
          createdAt: tasks.createdAt,
          updatedAt: tasks.updatedAt,
          repoColor: rigs.color,
          repoName: rigs.name,
          repoIcon: rigs.icon,
        })
        .from(tasks)
        .leftJoin(rigs, eq(tasks.repoId, rigs.id))
        .where(and(...conditions))
        .orderBy(desc(tasks.createdAt))
        .limit(input.limit + 1);

      let nextCursor: string | null = null;
      if (rows.length > input.limit) {
        const next = rows.pop()!;
        nextCursor = next.createdAt.toISOString();
      }

      return { items: rows, nextCursor };
    }),

  // Get a single task by ID, including its dependencies and dependents
  getById: requirePermission("task:read")
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const [task] = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.id))
        .limit(1);

      if (!task) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }

      // Verify access via org membership
      await requireAccessibleRepo(ctx.db, task.repoId, userId);

      // Fetch dependencies (tasks this task depends on)
      const deps = await ctx.db
        .select()
        .from(taskDependencies)
        .where(eq(taskDependencies.taskId, input.id));

      // Fetch dependents (tasks that depend on this task)
      const dependents = await ctx.db
        .select()
        .from(taskDependencies)
        .where(eq(taskDependencies.dependsOnId, input.id));

      return { ...task, deps, dependents };
    }),

  // Create a new task
  create: protectedProcedure
    .input(CreateTaskSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Verify user has access to the repo via org membership
      const repo = await requireAccessibleRepo(ctx.db, input.repoId, userId);

      const taskId = generateTaskId(repo.bdPrefix);

      const [created] = await ctx.db
        .insert(tasks)
        .values({
          repoId: input.repoId,
          parentId: input.parentId ?? null,
          ideaId: input.ideaId ?? null,
          title: input.title,
          description: input.description,
          notes: input.notes ?? null,
          priority: input.priority,
          isEpic: input.isEpic,
          taskId,
        })
        .returning();

      await ctx.pubsub.publish(syncChannel("task"), {
        action: "created",
        data: created,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof created>);

      return created;
    }),

  // Update a task (partial)
  update: protectedProcedure
    .input(UpdateTaskSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Fetch existing task
      const [existing] = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.id))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }

      // Verify access via org membership
      await requireAccessibleRepo(ctx.db, existing.repoId, userId);

      const { id, ...data } = input;
      const setValues: Record<string, unknown> = {
        ...data,
        updatedAt: new Date(),
      };

      // Track status change timestamp
      if (input.status && input.status !== existing.status) {
        setValues.statusChangedAt = new Date();
      }

      const [updated] = await ctx.db
        .update(tasks)
        .set(setValues)
        .where(eq(tasks.id, id))
        .returning();

      await ctx.pubsub.publish(syncChannel("task"), {
        action: "updated",
        data: updated,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof updated>);

      // Cascade approval to descendants
      if (existing.isEpic && input.status === "approved") {
        const descendantIds = await collectDescendantIds(ctx.db, id);
        if (descendantIds.length > 0) {
          await ctx.db.update(tasks)
            .set({ status: "approved", statusChangedAt: new Date(), updatedAt: new Date() })
            .where(and(inArray(tasks.id, descendantIds), eq(tasks.status, "draft")));

          await ctx.pubsub.publish(syncChannel("task"), {
            action: "updated",
            data: { parentId: id, cascade: true },
            timestamp: Date.now(),
          });
        }
      }

      // Propagate status changes up the tree
      if (input.status && input.status !== existing.status) {
        try {
          if (input.status === "in_progress") {
            if (updated.parentId) {
              await propagateInProgressUp(ctx.db, ctx.pubsub, updated.parentId, updated.ideaId ?? existing.ideaId);
            } else if (updated.ideaId ?? existing.ideaId) {
              // Top-level task: directly propagate to idea
              const effectiveIdeaId = (updated.ideaId ?? existing.ideaId)!;
              const [idea] = await ctx.db
                .select()
                .from(ideas)
                .where(eq(ideas.id, effectiveIdeaId))
                .limit(1);
              if (idea && idea.status !== "in_progress" && idea.status !== "complete" && idea.status !== "dismissed" && idea.status !== "archived") {
                await ctx.db
                  .update(ideas)
                  .set({ status: "in_progress", updatedAt: new Date() })
                  .where(eq(ideas.id, effectiveIdeaId));
                await ctx.pubsub.publish(syncChannel("idea"), {
                  action: "updated",
                  data: { id: effectiveIdeaId, status: "in_progress" },
                  timestamp: Date.now(),
                });
              }
            }
          } else if (input.status === "complete" || input.status === "archived") {
            const effectiveIdeaId = updated.ideaId ?? existing.ideaId;
            if (updated.parentId) {
              await propagateCompleteUp(ctx.db, ctx.pubsub, updated.parentId, effectiveIdeaId);
            } else if (effectiveIdeaId) {
              await propagateCompleteUp(ctx.db, ctx.pubsub, null, effectiveIdeaId);
            }
          }
        } catch (err) {
          // Log error but don't fail the task update
          console.error("Propagation failed", { taskId: id, ideaId: updated.ideaId, status: input.status, error: err instanceof Error ? err.message : String(err) });
        }
      }

      return updated;
    }),

  // Delete a task
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Fetch task to verify it exists
      const [existing] = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.id))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }

      // Verify access via org membership
      await requireAccessibleRepo(ctx.db, existing.repoId, userId);

      await ctx.db
        .delete(tasks)
        .where(eq(tasks.id, input.id));

      await ctx.pubsub.publish(syncChannel("task"), {
        action: "deleted",
        data: existing,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof existing>);

      return { success: true };
    }),

  // Add a dependency between two tasks
  addDependency: protectedProcedure
    .input(TaskDependencySchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Prevent self-dependency
      if (input.taskId === input.dependsOnId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A task cannot depend on itself",
        });
      }

      // Verify user has access to the task's repo via org membership
      const [task] = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (!task) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }

      await requireAccessibleRepo(ctx.db, task.repoId, userId);

      await ctx.db
        .insert(taskDependencies)
        .values({
          taskId: input.taskId,
          dependsOnId: input.dependsOnId,
        })
        .onConflictDoNothing();

      await ctx.pubsub.publish(syncChannel("task"), {
        action: "updated",
        data: { taskId: input.taskId, dependsOnId: input.dependsOnId },
        timestamp: Date.now(),
      } satisfies SyncEvent<{ taskId: string; dependsOnId: string }>);

      return { success: true };
    }),

  // Remove a dependency between two tasks
  removeDependency: protectedProcedure
    .input(TaskDependencySchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Verify user has access to the task's repo via org membership
      const [task] = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (!task) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }

      await requireAccessibleRepo(ctx.db, task.repoId, userId);

      await ctx.db
        .delete(taskDependencies)
        .where(
          and(
            eq(taskDependencies.taskId, input.taskId),
            eq(taskDependencies.dependsOnId, input.dependsOnId),
          ),
        );

      await ctx.pubsub.publish(syncChannel("task"), {
        action: "deleted",
        data: { taskId: input.taskId, dependsOnId: input.dependsOnId },
        timestamp: Date.now(),
      } satisfies SyncEvent<{ taskId: string; dependsOnId: string }>);

      return { success: true };
    }),

  // List all dependencies across tasks in a repo (or all user repos), optionally scoped to an idea
  listDependencies: requirePermission("task:read")
    .input(z.object({
      repoId: z.string().uuid().nullable(),
      ideaId: z.string().uuid().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      let repoIds: string[];

      if (input.repoId !== null) {
        // Verify user has access to this repo via org membership
        await requireAccessibleRepo(ctx.db, input.repoId, userId);

        repoIds = [input.repoId];
      } else {
        // All Repos mode: restrict to rigs in the user's orgs
        const userOrgIds = await getUserOrgIds(ctx.db, userId);
        const orgRigs = await ctx.db
          .select({ id: rigs.id })
          .from(rigs)
          .where(inArray(rigs.orgId, [...userOrgIds]));

        repoIds = orgRigs.map((r: { id: string }) => r.id);
        if (repoIds.length === 0) {
          return [];
        }
      }

      // Get tasks scoped to rigs (and optionally to an idea)
      const taskConditions = [inArray(tasks.repoId, repoIds)];
      if (input.ideaId) {
        taskConditions.push(eq(tasks.ideaId, input.ideaId));
      }

      const rigTasks = await ctx.db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(...taskConditions));

      const taskIds = rigTasks.map((b: { id: string }) => b.id);
      if (taskIds.length === 0) {
        return [];
      }

      const deps = await ctx.db
        .select()
        .from(taskDependencies)
        .where(inArray(taskDependencies.taskId, taskIds));

      return deps;
    }),

  // Real-time sync subscription (org-scoped, requires auth)
  onSync: protectedProcedure.subscription(async function* ({ ctx, signal }) {
    const userId = requireDbUser(ctx);

    // Pre-load org-scoped repo IDs for filtering
    const userOrgIds = await getUserOrgIds(ctx.db, userId);
    const orgRigs = await ctx.db
      .select({ id: rigs.id })
      .from(rigs)
      .where(inArray(rigs.orgId, [...userOrgIds]));
    const orgRigIds = new Set(orgRigs.map((r: { id: string }) => r.id));

    for await (const event of iterateEvents<SyncEvent<Task>>(
      ctx.pubsub,
      syncChannel("task"),
      signal!,
    )) {
      // Only yield events for tasks belonging to the user's org repos
      const data = event.data as Record<string, unknown>;
      if (data.repoId && !orgRigIds.has(data.repoId as string)) continue;
      yield tracked(String(++eventId), event);
    }
  }),
});

async function collectDescendantIds(
  db: Context["db"],
  parentId: string,
): Promise<string[]> {
  const children = await db
    .select({ id: tasks.id, isEpic: tasks.isEpic })
    .from(tasks)
    .where(eq(tasks.parentId, parentId));
  const ids: string[] = [];
  for (const child of children) {
    ids.push(child.id);
    if (child.isEpic) {
      ids.push(...await collectDescendantIds(db, child.id));
    }
  }
  return ids;
}
