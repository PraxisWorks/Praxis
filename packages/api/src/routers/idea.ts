import { z } from "zod";
import { eq, and, asc, sql, inArray } from "drizzle-orm";
import { tracked, TRPCError } from "@trpc/server";
import {
  CreateIdeaSchema,
  UpdateIdeaSchema,
  ListIdeasInputSchema,
  ReorderIdeasSchema,
  syncChannel,
  type SyncEvent,
  type Idea,
  type IdeaAttachment,
  type Session,
} from "@praxis2/shared";
import { router, protectedProcedure } from "../trpc.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { ideas, rigs, sessions, tasks, plans, ideaAttachments } from "../db/schema.js";
import { getStorageAdapter } from "../services/storage/index.js";
import { iterateEvents } from "../lib/iterateEvents.js";
import { requireDbUser } from "../lib/requireDbUser.js";
import { requireAccessibleRepo } from "../lib/requireAccessibleRepo.js";
import { checkLimitFromRole } from "../lib/checkLimit.js";
import { getUserOrgIds } from "../lib/orgSyncFilter.js";
import { enqueueJob } from "../jobs/index.js";
import { SESSION_START } from "@praxis2/shared";
import { getLogger } from "../lib/logger.js";
import { resolveWorkerForSession } from "../lib/resolveWorkerForSession.js";
import type { getDb } from "../db/index.js";
import type { PgPubSub } from "../pubsub.js";

let eventId = 0;

/**
 * Creates an architecture session and enqueues the session.start job.
 * Does NOT validate idea existence or ownership — the caller must do that.
 */
export async function triggerArchitectureSession(params: {
  db: ReturnType<typeof getDb>;
  pubsub: PgPubSub;
  ideaId: string;
  repoId: string;
  userId: string;
  ideaTitle: string;
  phaseConfig?: Array<{ phase: string; mode: "skip" | "full-ai" | "ai-assisted" }>;
  autoAccept?: boolean;
  scheduledFor?: string;
  dbUser?: { id: string; role: string; roleId: string | null };
}): Promise<{ session: typeof sessions.$inferSelect }> {
  const { db, pubsub, ideaId, repoId, userId, ideaTitle, phaseConfig, autoAccept, scheduledFor } = params;

  // Enforce session limit if dbUser is available
  if (params.dbUser) {
    await checkLimitFromRole(db, params.dbUser, "active_sessions");
  }

  // 1. Update idea status to "planning"
  await db
    .update(ideas)
    .set({ status: "planning", updatedAt: new Date() })
    .where(eq(ideas.id, ideaId));

  await pubsub.publish(syncChannel("idea"), {
    action: "updated",
    data: { id: ideaId, status: "planning" },
    timestamp: Date.now(),
  } satisfies SyncEvent<unknown>);

  // Resolve target worker using org worker-policy (central_worker, require_local, user_default)
  const workerId = await resolveWorkerForSession(db, userId, repoId);

  // 2. Create session row
  const [session] = await db
    .insert(sessions)
    .values({
      repoId,
      userId,
      type: "architecture",
      entityType: "idea",
      entityId: ideaId,
      title: `Architecture: ${ideaTitle}`,
      status: scheduledFor ? "scheduled" : "active",
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
      workerId: workerId ?? null,
    })
    .returning();

  await pubsub.publish(syncChannel("session"), {
    action: "created",
    data: session,
    timestamp: Date.now(),
  } satisfies SyncEvent<typeof session>);

  // 3. Query idea attachments to forward to the session
  const ideaFiles = await db
    .select()
    .from(ideaAttachments)
    .where(eq(ideaAttachments.ideaId, ideaId))
    .orderBy(ideaAttachments.createdAt);

  const attachments = ideaFiles.map((a: any) => ({
    id: a.id,
    filename: a.filename,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    storageKey: a.storageKey,
  }));

  // 4. Enqueue session.start job (route to active worker or base queue)
  try {
    const enqueueOptions: any = {};
    if (workerId) enqueueOptions.workerId = workerId;
    if (scheduledFor) enqueueOptions.startAfter = new Date(scheduledFor);

    const jobId = await enqueueJob(SESSION_START, {
      sessionId: session.id,
      repoId,
      type: "architecture",
      entityType: "idea",
      entityId: ideaId,
      ...(phaseConfig ? { phaseConfig } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(autoAccept ? { autoAccept } : {}),
    }, Object.keys(enqueueOptions).length > 0 ? enqueueOptions : undefined);

    if (jobId && scheduledFor) {
      await db.update(sessions).set({ jobId }).where(eq(sessions.id, session.id));
    }
  } catch (err) {
    getLogger().error(
      { err, sessionId: session.id },
      "Failed to enqueue session.start job for architecture session",
    );
  }

  return { session };
}

export const ideaRouter = router({
  // Get a single idea by ID
  getById: requirePermission("idea:read")
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const [idea] = await ctx.db
        .select()
        .from(ideas)
        .where(eq(ideas.id, input.id))
        .limit(1);

      if (!idea) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Idea not found" });
      }

      // Verify org membership via the idea's repo
      await requireAccessibleRepo(ctx.db, idea.repoId, userId);

      return idea;
    }),

  // List ideas for a repo (or all repos when repoId is null), optionally filtered by status
  list: requirePermission("idea:read")
    .input(ListIdeasInputSchema)
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const conditions: ReturnType<typeof eq>[] = [];

      if (input.repoId !== null) {
        // Verify user has access to this repo via org membership
        await requireAccessibleRepo(ctx.db, input.repoId, userId);
        conditions.push(eq(ideas.repoId, input.repoId));
      } else {
        // List ideas across all repos in the user's organizations
        const userOrgIds = await getUserOrgIds(ctx.db, userId);
        if (userOrgIds.size === 0) return [];

        const orgRigs = await ctx.db
          .select({ id: rigs.id })
          .from(rigs)
          .where(inArray(rigs.orgId, [...userOrgIds]));
        const orgRigIds = orgRigs.map((r: { id: string }) => r.id);
        if (orgRigIds.length === 0) return [];

        conditions.push(inArray(ideas.repoId, orgRigIds));
      }

      if (input.status) {
        conditions.push(eq(ideas.status, input.status));
      }

      const rows = await ctx.db
        .select({
          id: ideas.id,
          repoId: ideas.repoId,
          userId: ideas.userId,
          title: ideas.title,
          description: ideas.description,
          status: ideas.status,
          source: ideas.source,
          size: ideas.size,
          tags: ideas.tags,
          order: ideas.order,
          createdAt: ideas.createdAt,
          updatedAt: ideas.updatedAt,
          repoColor: rigs.color,
          repoName: rigs.name,
          repoIcon: rigs.icon,
          planId: sql<string | null>`(SELECT p.id FROM plans p WHERE p.idea_id = ${ideas.id} AND p.status != 'rejected' LIMIT 1)`,
          planStatus: sql<string | null>`(SELECT p.status FROM plans p WHERE p.idea_id = ${ideas.id} AND p.status != 'rejected' LIMIT 1)`,
          topEpicId: sql<string | null>`(SELECT b.id FROM tasks b WHERE b.idea_id = ${ideas.id} AND b.is_epic = true AND b.parent_id IS NULL LIMIT 1)`,
          completedTaskCount: sql<number>`(SELECT COUNT(*)::int FROM tasks b WHERE b.idea_id = ${ideas.id} AND b.is_epic = false AND b.status IN ('complete', 'archived'))`,
          totalTaskCount: sql<number>`(SELECT COUNT(*)::int FROM tasks b WHERE b.idea_id = ${ideas.id} AND b.is_epic = false)`,
          latestPhaseNumber: sql<number>`(SELECT COALESCE(MAX(ip.phase_number), 0)::int FROM idea_phases ip WHERE ip.idea_id = ${ideas.id})`,
          latestPhaseName: sql<string | null>`(SELECT ip.phase_name FROM idea_phases ip WHERE ip.idea_id = ${ideas.id} ORDER BY ip.phase_number DESC LIMIT 1)`,
        })
        .from(ideas)
        .leftJoin(rigs, eq(ideas.repoId, rigs.id))
        .where(and(...conditions))
        .orderBy(asc(ideas.order), asc(ideas.createdAt));

      return rows;
    }),

  // Create a new idea
  create: protectedProcedure
    .input(CreateIdeaSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Verify user has access to this repo via org membership
      await requireAccessibleRepo(ctx.db, input.repoId, userId);

      // Enforce idea-per-rig limit
      await checkLimitFromRole(ctx.db, ctx.dbUser!, "ideas_per_repo", input.repoId);

      // Get the next order value for this repo
      const [{ maxOrder }] = await ctx.db
        .select({ maxOrder: sql<number>`COALESCE(MAX(${ideas.order}), -1)` })
        .from(ideas)
        .where(eq(ideas.repoId, input.repoId))
        .limit(1);

      const nextOrder = maxOrder + 1;

      const [idea] = await ctx.db
        .insert(ideas)
        .values({
          ...input,
          userId,
          order: nextOrder,
        })
        .returning();

      await ctx.pubsub.publish(syncChannel("idea"), {
        action: "created",
        data: idea,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof idea>);

      // Auto-trigger architecture session for xs/s ideas
      if (input.size === "xs" || input.size === "s") {
        try {
          await triggerArchitectureSession({
            db: ctx.db,
            pubsub: ctx.pubsub,
            ideaId: idea.id,
            repoId: idea.repoId,
            userId,
            ideaTitle: idea.title,
            dbUser: ctx.dbUser!,
            phaseConfig: [
              { phase: "Business Value", mode: "full-ai" },
              { phase: "User Benefits", mode: "full-ai" },
              { phase: "Must-Have Requirements", mode: "full-ai" },
              { phase: "Product Review", mode: "full-ai" },
              { phase: "Architecture Review", mode: "full-ai" },
              { phase: "DevOps Review", mode: "full-ai" },
              { phase: "Security Review", mode: "full-ai" },
              { phase: "Engineering Plan", mode: "full-ai" },
            ],
            autoAccept: true,
          });
        } catch (err) {
          // Never let auto-trigger failure break idea creation
          getLogger().error(
            { err, ideaId: idea.id },
            "Auto-trigger architecture session failed for xs/s idea",
          );
        }
      }

      return idea;
    }),

  // Update an idea (partial)
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: UpdateIdeaSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const [existing] = await ctx.db
        .select()
        .from(ideas)
        .where(eq(ideas.id, input.id))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Idea not found" });
      }

      // Verify org membership via the idea's repo
      await requireAccessibleRepo(ctx.db, existing.repoId, userId);

      // Guard: title, description, and size can only change when status is 'new'
      if (existing.status !== "new") {
        if (input.data.title !== undefined || input.data.description !== undefined || input.data.size !== undefined) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Title, description, and size can only be edited when the idea is in 'new' status",
          });
        }
      }

      const [updated] = await ctx.db
        .update(ideas)
        .set({ ...input.data, updatedAt: new Date() })
        .where(eq(ideas.id, input.id))
        .returning();

      await ctx.pubsub.publish(syncChannel("idea"), {
        action: "updated",
        data: updated,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof updated>);

      return updated;
    }),

  // Delete an idea
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Fetch idea and verify org membership via its repo
      const [idea] = await ctx.db
        .select()
        .from(ideas)
        .where(eq(ideas.id, input.id))
        .limit(1);

      if (!idea) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Idea not found" });
      }

      await requireAccessibleRepo(ctx.db, idea.repoId, userId);

      const [deleted] = await ctx.db
        .delete(ideas)
        .where(eq(ideas.id, input.id))
        .returning();

      if (!deleted) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Idea not found" });
      }

      await ctx.pubsub.publish(syncChannel("idea"), {
        action: "deleted",
        data: deleted,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof deleted>);

      return { success: true };
    }),

  // Archive an idea and cascade to all attached tasks/epics
  archive: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const [idea] = await ctx.db
        .select()
        .from(ideas)
        .where(eq(ideas.id, input.id))
        .limit(1);

      if (!idea) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Idea not found" });
      }

      // Verify org membership via the idea's repo
      await requireAccessibleRepo(ctx.db, idea.repoId, userId);

      if (idea.status === "archived") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Idea is already archived",
        });
      }

      const now = new Date();

      // Archive the idea
      const [updated] = await ctx.db
        .update(ideas)
        .set({ status: "archived", updatedAt: now })
        .where(eq(ideas.id, input.id))
        .returning();

      // Cascade: archive all tasks linked to this idea
      const archivedTasks = await ctx.db
        .update(tasks)
        .set({ status: "archived", statusChangedAt: now, updatedAt: now })
        .where(eq(tasks.ideaId, input.id))
        .returning();

      // Publish sync events
      await ctx.pubsub.publish(syncChannel("idea"), {
        action: "updated",
        data: updated,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof updated>);

      if (archivedTasks.length > 0) {
        await ctx.pubsub.publish(syncChannel("task"), {
          action: "updated",
          data: { ideaId: input.id, archived: true },
          timestamp: Date.now(),
        } satisfies SyncEvent<unknown>);
      }

      return { success: true, archivedTasks: archivedTasks.length };
    }),

  // Batch reorder ideas
  reorder: protectedProcedure
    .input(ReorderIdeasSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Get all repos in the user's orgs to verify idea access
      const userOrgIds = await getUserOrgIds(ctx.db, userId);
      if (userOrgIds.size === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "One or more ideas not found",
        });
      }

      const orgRigs = await ctx.db
        .select({ id: rigs.id })
        .from(rigs)
        .where(inArray(rigs.orgId, [...userOrgIds]));
      const orgRigIds = new Set(orgRigs.map((r: { id: string }) => r.id));

      // Verify all idea IDs are in the user's org repos
      const inputIds = input.map((item) => item.id);
      const accessibleIdeas = await ctx.db
        .select({ id: ideas.id, repoId: ideas.repoId })
        .from(ideas)
        .where(inArray(ideas.id, inputIds));
      const accessibleIds = new Set(
        accessibleIdeas
          .filter((i: { id: string; repoId: string }) => orgRigIds.has(i.repoId))
          .map((i: { id: string }) => i.id),
      );
      const unauthorized = inputIds.filter((id) => !accessibleIds.has(id));
      if (unauthorized.length > 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "One or more ideas not found",
        });
      }

      const now = new Date();
      await Promise.all(
        input.map((item) =>
          ctx.db
            .update(ideas)
            .set({ order: item.order, updatedAt: now })
            .where(eq(ideas.id, item.id)),
        ),
      );

      await ctx.pubsub.publish(syncChannel("idea"), {
        action: "updated",
        data: { reordered: true },
        timestamp: Date.now(),
      } satisfies SyncEvent<unknown>);

      return { success: true };
    }),

  // Start an architecture session for an idea
  startArchitectureSession: protectedProcedure
    .input(z.object({
      ideaId: z.string().uuid(),
      phaseConfig: z.array(z.object({
        phase: z.string(),
        mode: z.enum(["skip", "full-ai", "ai-assisted"]),
      })).optional(),
      scheduledFor: z.string().datetime().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Validate scheduledFor if provided
      if (input.scheduledFor) {
        const scheduledDate = new Date(input.scheduledFor);
        const now = new Date();
        if (scheduledDate <= now) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "scheduledFor must be in the future" });
        }
        const maxDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        if (scheduledDate > maxDate) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "scheduledFor must be within 30 days" });
        }
      }

      // 1. Validate idea exists and user has access via org membership
      const [idea] = await ctx.db
        .select()
        .from(ideas)
        .where(eq(ideas.id, input.ideaId))
        .limit(1);

      if (!idea) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Idea not found" });
      }

      await requireAccessibleRepo(ctx.db, idea.repoId, userId);

      if (idea.status !== "new" && idea.status !== "planning") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Idea must be in 'new' or 'planning' status to start an architecture session",
        });
      }

      // 2. Delegate to helper
      const { session } = await triggerArchitectureSession({
        db: ctx.db,
        pubsub: ctx.pubsub,
        ideaId: input.ideaId,
        repoId: idea.repoId,
        userId,
        ideaTitle: idea.title,
        dbUser: ctx.dbUser!,
        phaseConfig: input.phaseConfig,
        scheduledFor: input.scheduledFor,
      });

      return session;
    }),

  // List attachments for an idea
  listAttachments: requirePermission("idea:read")
    .input(z.object({ ideaId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Verify idea exists and user has access via org membership
      const [idea] = await ctx.db
        .select()
        .from(ideas)
        .where(eq(ideas.id, input.ideaId))
        .limit(1);

      if (!idea) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Idea not found" });
      }

      await requireAccessibleRepo(ctx.db, idea.repoId, userId);

      return ctx.db
        .select()
        .from(ideaAttachments)
        .where(eq(ideaAttachments.ideaId, input.ideaId))
        .orderBy(ideaAttachments.createdAt);
    }),

  // Delete an attachment from an idea
  deleteAttachment: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Find the attachment
      const [attachment] = await ctx.db
        .select()
        .from(ideaAttachments)
        .where(eq(ideaAttachments.id, input.id))
        .limit(1);

      if (!attachment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Attachment not found" });
      }

      // Verify the user has access to the idea's repo via org membership
      const [idea] = await ctx.db
        .select()
        .from(ideas)
        .where(eq(ideas.id, attachment.ideaId))
        .limit(1);

      if (!idea) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Attachment not found" });
      }

      await requireAccessibleRepo(ctx.db, idea.repoId, userId);

      // Guard: only allow delete when idea is in 'new' status
      if (idea.status !== "new") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Attachments can only be deleted when the idea is in 'new' status",
        });
      }

      // Delete from storage
      const storage = getStorageAdapter();
      await storage.delete(attachment.storageKey);

      // Delete DB row
      const [deleted] = await ctx.db
        .delete(ideaAttachments)
        .where(eq(ideaAttachments.id, input.id))
        .returning();

      await ctx.pubsub.publish(syncChannel("ideaAttachment"), {
        action: "deleted",
        data: deleted,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof deleted>);

      return { success: true };
    }),

  // Real-time sync for idea attachments
  onAttachmentSync: protectedProcedure.subscription(async function* ({ ctx, signal }) {
    const userId = requireDbUser(ctx);
    const userOrgIds = await getUserOrgIds(ctx.db, userId);
    // Pre-load repo IDs in user's orgs for filtering
    const orgRigs = await ctx.db
      .select({ id: rigs.id })
      .from(rigs)
      .where(inArray(rigs.orgId, [...userOrgIds]));
    const orgRigIds = new Set(orgRigs.map((r: { id: string }) => r.id));

    for await (const event of iterateEvents<SyncEvent<IdeaAttachment>>(
      ctx.pubsub,
      syncChannel("ideaAttachment"),
      signal!,
    )) {
      const data = event.data as Record<string, unknown>;
      // Forward if repoId is in user's org repos, or if no repoId (broadcast-style events)
      if (data.repoId && !orgRigIds.has(data.repoId as string)) continue;
      yield tracked(String(++eventId), event);
    }
  }),

  // Real-time sync subscription
  onSync: protectedProcedure.subscription(async function* ({ ctx, signal }) {
    const userId = requireDbUser(ctx);
    const userOrgIds = await getUserOrgIds(ctx.db, userId);
    // Pre-load repo IDs in user's orgs for filtering
    const orgRigs = await ctx.db
      .select({ id: rigs.id })
      .from(rigs)
      .where(inArray(rigs.orgId, [...userOrgIds]));
    const orgRigIds = new Set(orgRigs.map((r: { id: string }) => r.id));

    for await (const event of iterateEvents<SyncEvent<Idea>>(
      ctx.pubsub,
      syncChannel("idea"),
      signal!,
    )) {
      const data = event.data as Record<string, unknown>;
      // Forward if repoId is in user's org repos, or if no repoId (broadcast-style events)
      if (data.repoId && !orgRigIds.has(data.repoId as string)) continue;
      yield tracked(String(++eventId), event);
    }
  }),
});
