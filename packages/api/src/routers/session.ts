import { z } from "zod";
import { eq, and, desc, asc, sql, inArray } from "drizzle-orm";
import { tracked, TRPCError } from "@trpc/server";
import {
  CreateSessionSchema,
  UpdateSessionStatusSchema,
  RenameSessionSchema,
  RemakeSessionSchema,
  StartDebugSessionSchema,
  StartWorkSessionSchema,
  StartRepoSessionSchema,
  SessionListInputSchema,
  PauseResumeSessionSchema,
  ListOpenQuestionsInputSchema,
  syncChannel,
  type SyncEvent,
  type Session,
  type SessionMessage,
} from "@praxis2/shared";
import { router, protectedProcedure } from "../trpc.js";
import { requirePermission, resolveUserPermissions } from "../middleware/requirePermission.js";
import { sessions, sessionMessages, sessionAttachments, rigs, tasks, users, workers, organizations } from "../db/schema.js";
import { getDb } from "../db/index.js";
import { iterateEvents } from "../lib/iterateEvents.js";
import { enqueueJob, cancelJob } from "../jobs/index.js";
import { SESSION_START, SESSION_MESSAGE, SESSION_STOP, workerQueue } from "@praxis2/shared";
import { getLogger } from "../lib/logger.js";
import { requireDbUser } from "../lib/requireDbUser.js";
import { requireAccessibleRepo } from "../lib/requireAccessibleRepo.js";
import { getUserOrgIds } from "../lib/orgSyncFilter.js";
import { resolveWorkerForSession } from "../lib/resolveWorkerForSession.js";
import { checkLimitFromRole } from "../lib/checkLimit.js";

let eventId = 0;
let messageEventId = 0;

/** Strip large fields before publishing via pg_notify (8KB limit). */
function slimSession<T extends Record<string, unknown>>(row: T): Omit<T, "prompt" | "metadata"> {
  const { prompt: _p, metadata: _m, ...rest } = row;
  return rest as Omit<T, "prompt" | "metadata">;
}

export const sessionRouter = router({
  // Get the most recent session for a given entity (e.g. "idea" + ideaId)
  getByEntity: requirePermission("session:read")
    .input(
      z.object({
        entityType: z.string(),
        entityId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Fetch candidate session, then verify org access via its repo
      const [session] = await ctx.db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.entityType, input.entityType as "repo" | "idea" | "epic" | "task"),
            eq(sessions.entityId, input.entityId),
          ),
        )
        .orderBy(desc(sessions.createdAt))
        .limit(1);

      if (!session) return null;

      // Verify user has org access to the session's repo
      await requireAccessibleRepo(ctx.db, session.repoId, userId);

      return session;
    }),

  // List sessions for the current user, filterable by type and status.
  // Joins rigs for color/name and subqueries sessionMessages for lastMessageAt.
  list: requirePermission("session:read")
    .input(SessionListInputSchema)
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Get all repos accessible via the user's org memberships.
      // When orgIds filter is provided, intersect with user's memberships
      // so filtering happens at the repo-ID level (main table) rather than
      // relying on a LEFT-JOINed column in the WHERE clause.
      const userOrgIds = await getUserOrgIds(ctx.db, userId);
      if (userOrgIds.size === 0) return [];

      const effectiveOrgIds =
        input.orgIds && input.orgIds.length > 0
          ? input.orgIds.filter((id) => userOrgIds.has(id))
          : [...userOrgIds];
      if (effectiveOrgIds.length === 0) return [];

      const orgRigs = await ctx.db
        .select({ id: rigs.id })
        .from(rigs)
        .where(inArray(rigs.orgId, effectiveOrgIds));
      const orgRigIds = orgRigs.map((r: { id: string }) => r.id);
      if (orgRigIds.length === 0) return [];

      // Subquery: latest message timestamp per session
      const latestMsg = ctx.db
        .select({
          sessionId: sessionMessages.sessionId,
          lastMessageAt:
            sql<Date>`max(${sessionMessages.createdAt})`.as("last_message_at"),
        })
        .from(sessionMessages)
        .groupBy(sessionMessages.sessionId)
        .as("latest_msg");

      const conditions = [inArray(sessions.repoId, orgRigIds)];
      if (input.typeFilter && input.typeFilter.length > 0)
        conditions.push(inArray(sessions.type, input.typeFilter));
      if (input.statusFilter && input.statusFilter.length > 0)
        conditions.push(inArray(sessions.status, input.statusFilter));

      const rows = await ctx.db
        .select({
          id: sessions.id,
          repoId: sessions.repoId,
          userId: sessions.userId,
          type: sessions.type,
          entityType: sessions.entityType,
          entityId: sessions.entityId,
          title: sessions.title,
          prompt: sessions.prompt,
          status: sessions.status,
          metadata: sessions.metadata,
          createdAt: sessions.createdAt,
          updatedAt: sessions.updatedAt,
          repoColor: rigs.color,
          repoName: rigs.name,
          repoIcon: rigs.icon,
          orgId: rigs.orgId,
          orgName: organizations.name,
          lastMessageAt: latestMsg.lastMessageAt,
          lastMessageContent: sql<string | null>`(
            SELECT left(sm."content", 200)
            FROM "session_messages" sm
            WHERE sm."session_id" = ${sessions.id}
              AND sm."role" IN ('assistant', 'system')
            ORDER BY sm."created_at" DESC
            LIMIT 1
          )`.as("last_message_content"),
          lastMessageRole: sql<string | null>`(
            SELECT sm."role"
            FROM "session_messages" sm
            WHERE sm."session_id" = ${sessions.id}
              AND sm."role" IN ('assistant', 'system')
            ORDER BY sm."created_at" DESC
            LIMIT 1
          )`.as("last_message_role"),
          taskTotal: sql<number | null>`(
            CASE WHEN ${sessions.type} = 'working' THEN (
              SELECT COUNT(*)::int FROM "tasks" t
              WHERE t."is_epic" = false
                AND (
                  t."parent_id" = ${sessions.entityId}
                  OR t."parent_id" IN (
                    SELECT t2."id" FROM "tasks" t2
                    WHERE t2."parent_id" = ${sessions.entityId}
                  )
                )
            ) END
          )`.as("task_total"),
          taskCompleted: sql<number | null>`(
            CASE WHEN ${sessions.type} = 'working' THEN (
              SELECT COUNT(*)::int FROM "tasks" t
              WHERE t."is_epic" = false
                AND t."status" IN ('complete', 'archived')
                AND (
                  t."parent_id" = ${sessions.entityId}
                  OR t."parent_id" IN (
                    SELECT t2."id" FROM "tasks" t2
                    WHERE t2."parent_id" = ${sessions.entityId}
                  )
                )
            ) END
          )`.as("task_completed"),
          taskInProgress: sql<number | null>`(
            CASE WHEN ${sessions.type} = 'working' THEN (
              SELECT COUNT(*)::int FROM "tasks" t
              WHERE t."is_epic" = false
                AND t."status" = 'in_progress'
                AND (
                  t."parent_id" = ${sessions.entityId}
                  OR t."parent_id" IN (
                    SELECT t2."id" FROM "tasks" t2
                    WHERE t2."parent_id" = ${sessions.entityId}
                  )
                )
            ) END
          )`.as("task_in_progress"),
          phaseCompleted: sql<number | null>`(
            CASE WHEN ${sessions.type} = 'architecture' THEN (
              SELECT COALESCE(MAX(ip.phase_number), 0)::int FROM idea_phases ip WHERE ip.idea_id = ${sessions.entityId}
            ) END
          )`.as("phase_completed"),
          latestPhaseName: sql<string | null>`(
            CASE WHEN ${sessions.type} = 'architecture' THEN (
              SELECT ip.phase_name FROM idea_phases ip WHERE ip.idea_id = ${sessions.entityId} ORDER BY ip.phase_number DESC LIMIT 1
            ) END
          )`.as("latest_phase_name"),
          workerName: workers.name,
          workerStatus: workers.status,
          scheduledFor: sessions.scheduledFor,
          jobId: sessions.jobId,
        })
        .from(sessions)
        .leftJoin(rigs, eq(sessions.repoId, rigs.id))
        .leftJoin(organizations, eq(rigs.orgId, organizations.id))
        .leftJoin(latestMsg, eq(sessions.id, latestMsg.sessionId))
        .leftJoin(workers, eq(sessions.workerId, workers.id))
        .where(and(...conditions))
        .orderBy(
          desc(sql`coalesce(${latestMsg.lastMessageAt}, ${sessions.createdAt})`),
        )
        .limit(input.limit);

      return rows.map((row) => ({
        ...row,
        lastMessageAt: row.lastMessageAt ?? row.createdAt,
        lastMessageContent: row.lastMessageContent ?? null,
        lastMessageRole: row.lastMessageRole ?? null,
        taskTotal: row.taskTotal ?? null,
        taskCompleted: row.taskCompleted ?? null,
        taskInProgress: row.taskInProgress ?? null,
        phaseCompleted: row.phaseCompleted ?? null,
        latestPhaseName: row.latestPhaseName ?? null,
      }));
    }),

  // Get a session by ID with its messages
  // Ownership check: session -> repo -> userId must match caller
  getById: requirePermission("session:read")
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const [session] = await ctx.db
        .select()
        .from(sessions)
        .where(eq(sessions.id, input.id))
        .limit(1);

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      // Org membership check: verify user has access to the session's repo
      await requireAccessibleRepo(ctx.db, session.repoId, userId);

      const messages = await ctx.db
        .select()
        .from(sessionMessages)
        .where(eq(sessionMessages.sessionId, input.id))
        .orderBy(asc(sessionMessages.createdAt));

      // Fetch attachments for this session
      const attachments = await ctx.db
        .select()
        .from(sessionAttachments)
        .where(eq(sessionAttachments.sessionId, input.id));

      // Group attachments by messageId
      const attachmentsByMessage = new Map<string, typeof attachments>();
      for (const att of attachments) {
        if (!att.messageId) continue;
        const existing = attachmentsByMessage.get(att.messageId) ?? [];
        existing.push(att);
        attachmentsByMessage.set(att.messageId, existing);
      }

      // Enrich messages with their attachments
      const messagesWithAttachments = messages.map((msg) => ({
        ...msg,
        attachments: attachmentsByMessage.get(msg.id) ?? [],
      }));

      // Fetch worker info if session has a workerId
      let workerName: string | null = null;
      let workerStatus: string | null = null;
      if (session.workerId) {
        const [worker] = await ctx.db
          .select({ name: workers.name, status: workers.status })
          .from(workers)
          .where(eq(workers.id, session.workerId))
          .limit(1);
        if (worker) {
          workerName = worker.name;
          workerStatus = worker.status;
        }
      }

      return { ...session, messages: messagesWithAttachments, workerName, workerStatus };
    }),

  // Create a new session and enqueue the start job
  create: protectedProcedure
    .input(CreateSessionSchema.extend({ attachmentIds: z.array(z.string().uuid()).optional() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Dynamic permission check based on session type
      const permissionKey = `session:create:${input.type}` as import("@praxis2/shared").PermissionKey;
      const dbUser = ctx.dbUser!;
      if (dbUser.role !== "admin") {
        const permissions = await resolveUserPermissions(ctx.db, dbUser.id, dbUser.roleId);
        if (!permissions.has(permissionKey)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Missing permission: ${permissionKey}`,
          });
        }
      }

      // Enforce session limit
      await checkLimitFromRole(ctx.db, dbUser, "active_sessions");

      // Verify user has org access to this repo
      await requireAccessibleRepo(ctx.db, input.repoId, userId);

      // Resolve target worker (active worker or online central fallback)
      const workerId = await resolveWorkerForSession(ctx.db, userId, input.repoId);

      const { attachmentIds, ...sessionInput } = input;

      const [session] = await ctx.db
        .insert(sessions)
        .values({ ...sessionInput, userId, workerId: workerId ?? null })
        .returning();

      await ctx.pubsub.publish(syncChannel("session"), {
        action: "created",
        data: slimSession(session),
        timestamp: Date.now(),
      } satisfies SyncEvent<Omit<typeof session, "prompt" | "metadata">>);

      // Look up attachments if provided so they can be delivered to the workspace
      let attachments: { id: string; filename: string; mimeType: string; sizeBytes: number; storageKey: string }[] = [];
      if (attachmentIds?.length) {
        const found = await ctx.db
          .select()
          .from(sessionAttachments)
          .where(
            and(
              inArray(sessionAttachments.id, attachmentIds),
              eq(sessionAttachments.sessionId, session.id),
            ),
          );

        if (found.length !== attachmentIds.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "One or more attachments not found or not in this session",
          });
        }

        attachments = found.map((a) => ({
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          storageKey: a.storageKey,
        }));
      }

      // Enqueue session.start job for the Worker to pick up
      try {
        await enqueueJob(SESSION_START, {
          sessionId: session.id,
          repoId: input.repoId,
          type: input.type,
          entityType: input.entityType,
          entityId: input.entityId,
          ...(attachments.length > 0 ? { attachments } : {}),
        }, workerId ? { workerId } : undefined);
      } catch (err) {
        getLogger().error(
          { err, sessionId: session.id },
          "Failed to enqueue session.start job",
        );
      }

      return session;
    }),

  // Start a debug session for a task or epic
  startDebug: requirePermission("session:create:debug")
    .input(StartDebugSessionSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Enforce session limit
      await checkLimitFromRole(ctx.db, ctx.dbUser!, "active_sessions");

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

      // Verify user has org access to this repo
      await requireAccessibleRepo(ctx.db, input.repoId, userId);

      // Verify entity (task/epic) exists
      const [entity] = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.entityId))
        .limit(1);

      if (!entity) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `${input.entityType} not found`,
        });
      }

      // Resolve target worker (active worker or online central fallback)
      const workerId = await resolveWorkerForSession(ctx.db, userId, input.repoId);

      const title = `Debug: ${entity.title}`;

      const [session] = await ctx.db
        .insert(sessions)
        .values({
          repoId: input.repoId,
          userId,
          type: "debug",
          entityType: input.entityType,
          entityId: input.entityId,
          title,
          status: input.scheduledFor ? "scheduled" : "active",
          scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
          workerId: workerId ?? null,
        })
        .returning();

      await ctx.pubsub.publish(syncChannel("session"), {
        action: "created",
        data: slimSession(session),
        timestamp: Date.now(),
      } satisfies SyncEvent<Omit<typeof session, "prompt" | "metadata">>);

      // Enqueue session.start job for the Worker
      try {
        const enqueueOptions: any = {};
        if (workerId) enqueueOptions.workerId = workerId;
        if (input.scheduledFor) enqueueOptions.startAfter = new Date(input.scheduledFor);

        const jobId = await enqueueJob(SESSION_START, {
          sessionId: session.id,
          repoId: input.repoId,
          type: "debug",
          entityType: input.entityType,
          entityId: input.entityId,
        }, Object.keys(enqueueOptions).length > 0 ? enqueueOptions : undefined);

        if (jobId && input.scheduledFor) {
          await ctx.db.update(sessions).set({ jobId }).where(eq(sessions.id, session.id));
        }
      } catch (err) {
        getLogger().error(
          { err, sessionId: session.id },
          "Failed to enqueue session.start job for debug session",
        );
      }

      return session;
    }),

  // Start a working session for a task or epic
  startWork: requirePermission("session:create:working")
    .input(StartWorkSessionSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Enforce session limit
      await checkLimitFromRole(ctx.db, ctx.dbUser!, "active_sessions");

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

      // Verify user has org access to this repo
      await requireAccessibleRepo(ctx.db, input.repoId, userId);

      // Verify entity (task/epic) exists
      const [entity] = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.entityId))
        .limit(1);

      if (!entity) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `${input.entityType} not found`,
        });
      }

      // Resolve target worker (active worker or online central fallback)
      const workerId = await resolveWorkerForSession(ctx.db, userId, input.repoId);

      const title = `Working: ${entity.title}`;

      const [session] = await ctx.db
        .insert(sessions)
        .values({
          repoId: input.repoId,
          userId,
          type: "working",
          entityType: input.entityType,
          entityId: input.entityId,
          title,
          status: input.scheduledFor ? "scheduled" : "active",
          scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
          workerId: workerId ?? null,
        })
        .returning();

      await ctx.pubsub.publish(syncChannel("session"), {
        action: "created",
        data: slimSession(session),
        timestamp: Date.now(),
      } satisfies SyncEvent<Omit<typeof session, "prompt" | "metadata">>);

      // Enqueue session.start job for the Worker
      try {
        const enqueueOptions: any = {};
        if (workerId) enqueueOptions.workerId = workerId;
        if (input.scheduledFor) enqueueOptions.startAfter = new Date(input.scheduledFor);

        const jobId = await enqueueJob(SESSION_START, {
          sessionId: session.id,
          repoId: input.repoId,
          type: "working",
          entityType: input.entityType,
          entityId: input.entityId,
        }, Object.keys(enqueueOptions).length > 0 ? enqueueOptions : undefined);

        if (jobId && input.scheduledFor) {
          await ctx.db.update(sessions).set({ jobId }).where(eq(sessions.id, session.id));
        }
      } catch (err) {
        getLogger().error(
          { err, sessionId: session.id },
          "Failed to enqueue session.start job for working session",
        );
      }

      return session;
    }),

  // Start a repo chat session
  startRepoSession: requirePermission("session:create:repo")
    .input(StartRepoSessionSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Enforce session limit
      await checkLimitFromRole(ctx.db, ctx.dbUser!, "active_sessions");

      // Verify user has org access to this repo
      const repo = await requireAccessibleRepo(ctx.db, input.repoId, userId);

      // Resolve target worker (active worker or online central fallback)
      const workerId = await resolveWorkerForSession(ctx.db, userId, input.repoId);

      const title = `Chat: ${repo.name}`;

      const [session] = await ctx.db
        .insert(sessions)
        .values({
          repoId: input.repoId,
          userId,
          type: "repo",
          entityType: "repo",
          entityId: input.repoId,
          title,
          workerId: workerId ?? null,
        })
        .returning();

      await ctx.pubsub.publish(syncChannel("session"), {
        action: "created",
        data: slimSession(session),
        timestamp: Date.now(),
      } satisfies SyncEvent<Omit<typeof session, "prompt" | "metadata">>);

      // Enqueue session.start job for the Worker
      try {
        await enqueueJob(SESSION_START, {
          sessionId: session.id,
          repoId: input.repoId,
          type: "repo",
          entityType: "repo",
          entityId: input.repoId,
        }, workerId ? { workerId } : undefined);
      } catch (err) {
        getLogger().error(
          { err, sessionId: session.id },
          "Failed to enqueue session.start job for repo session",
        );
      }

      return session;
    }),

  // Update session status (pause/resume/complete/error)
  // Ownership check: session -> repo -> userId must match caller
  updateStatus: protectedProcedure
    .input(UpdateSessionStatusSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const [existing] = await ctx.db
        .select()
        .from(sessions)
        .where(eq(sessions.id, input.id))
        .limit(1);

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      // Org membership check: verify user has access to the session's repo
      await requireAccessibleRepo(ctx.db, existing.repoId, userId);

      const [updated] = await ctx.db
        .update(sessions)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(sessions.id, input.id))
        .returning();

      await ctx.pubsub.publish(syncChannel("session"), {
        action: "updated",
        data: slimSession(updated),
        timestamp: Date.now(),
      } satisfies SyncEvent<Omit<typeof updated, "prompt" | "metadata">>);

      return updated;
    }),

  // Rename a session
  // Ownership check: session -> repo -> userId must match caller
  rename: protectedProcedure
    .input(RenameSessionSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const [existing] = await ctx.db
        .select()
        .from(sessions)
        .where(eq(sessions.id, input.id))
        .limit(1);

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      // Org membership check: verify user has access to the session's repo
      await requireAccessibleRepo(ctx.db, existing.repoId, userId);

      const [updated] = await ctx.db
        .update(sessions)
        .set({ title: input.title, updatedAt: new Date() })
        .where(eq(sessions.id, input.id))
        .returning();

      await ctx.pubsub.publish(syncChannel("session"), {
        action: "updated",
        data: slimSession(updated),
        timestamp: Date.now(),
      } satisfies SyncEvent<Omit<typeof updated, "prompt" | "metadata">>);

      return updated;
    }),

  // Remake a session: stop the old one, delete it, create a fresh replacement
  // Ownership check: session -> repo -> userId must match caller
  remake: protectedProcedure
    .input(RemakeSessionSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const [existing] = await ctx.db
        .select()
        .from(sessions)
        .where(eq(sessions.id, input.id))
        .limit(1);

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      // Org membership check: verify user has access to the session's repo
      await requireAccessibleRepo(ctx.db, existing.repoId, userId);

      // 1. Stop the running process (if any)
      if (existing.status === "active" && (existing.type === "working" || existing.type === "debug" || existing.type === "repo")) {
        const oldWorkerId = existing.workerId ?? undefined;
        try {
          await enqueueJob(SESSION_STOP, { sessionId: input.id }, oldWorkerId ? { workerId: oldWorkerId } : undefined);
        } catch (err) {
          getLogger().error({ err, sessionId: input.id }, "Failed to enqueue stop job during remake");
        }
      }

      // 2. Delete old session (cascades to messages + attachments)
      await ctx.db
        .delete(sessions)
        .where(eq(sessions.id, input.id));

      await ctx.pubsub.publish(syncChannel("session"), {
        action: "deleted",
        data: { id: input.id },
        timestamp: Date.now(),
      });

      // Resolve target worker for the replacement session
      const workerId = await resolveWorkerForSession(ctx.db, userId, existing.repoId);

      // 3. Create fresh replacement session with same type/entity
      const [newSession] = await ctx.db
        .insert(sessions)
        .values({
          repoId: existing.repoId,
          userId,
          type: existing.type,
          entityType: existing.entityType,
          entityId: existing.entityId,
          title: existing.title,
          prompt: existing.prompt,
          workerId: workerId ?? null,
        })
        .returning();

      await ctx.pubsub.publish(syncChannel("session"), {
        action: "created",
        data: slimSession(newSession),
        timestamp: Date.now(),
      } satisfies SyncEvent<Omit<typeof newSession, "prompt" | "metadata">>);

      // 4. Start the new session
      try {
        await enqueueJob(SESSION_START, {
          sessionId: newSession.id,
          repoId: existing.repoId,
          type: existing.type,
          entityType: existing.entityType,
          entityId: existing.entityId,
        }, workerId ? { workerId } : undefined);
      } catch (err) {
        getLogger().error(
          { err, sessionId: newSession.id },
          "Failed to enqueue session.start job for remade session",
        );
      }

      return newSession;
    }),

  // Add a message to a session and enqueue processing job
  // Ownership check: session -> repo -> userId must match caller
  addMessage: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        content: z.string().min(1),
        attachmentIds: z.array(z.string().uuid()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Verify session exists
      const [session] = await ctx.db
        .select()
        .from(sessions)
        .where(eq(sessions.id, input.sessionId))
        .limit(1);

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      // Org membership check: verify user has access to the session's repo
      await requireAccessibleRepo(ctx.db, session.repoId, userId);

      if (session.status === "paused") {
        // Auto-resume: reactivate the session before delivering the message
        const workerId = await resolveWorkerForSession(ctx.db, userId, session.repoId);

        const [resumed] = await ctx.db
          .update(sessions)
          .set({ status: "active", workerId: workerId ?? null, claimedBy: null, updatedAt: new Date() })
          .where(eq(sessions.id, input.sessionId))
          .returning();

        await ctx.pubsub.publish(syncChannel("session"), {
          action: "updated",
          data: slimSession(resumed),
          timestamp: Date.now(),
        } satisfies SyncEvent<Omit<typeof resumed, "prompt" | "metadata">>);

        // System message indicating resume
        const [sysMsg] = await ctx.db
          .insert(sessionMessages)
          .values({
            sessionId: input.sessionId,
            role: "system",
            content: "Session resumed.",
          })
          .returning();

        const sysMsgChannel = `sync:session:${input.sessionId}:messages`;
        await ctx.pubsub.publish(sysMsgChannel, {
          action: "created",
          data: sysMsg,
          timestamp: Date.now(),
        } satisfies SyncEvent<typeof sysMsg>);

        // Enqueue resume job
        try {
          await enqueueJob(SESSION_START, {
            sessionId: input.sessionId,
            type: session.type,
            repoId: session.repoId,
            entityType: session.entityType,
            entityId: session.entityId,
            isResume: true,
            resumeMessage: input.content,
          }, workerId ? { workerId } : undefined);
        } catch (err) {
          getLogger().error(
            { err, sessionId: input.sessionId },
            "Failed to enqueue session.start job for auto-resume",
          );
        }
      } else if (session.status !== "active") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Session is not active",
        });
      }

      // Write user message to DB
      const [message] = await ctx.db
        .insert(sessionMessages)
        .values({
          sessionId: input.sessionId,
          role: "user",
          content: input.content,
        })
        .returning();

      // Link attachments to this message if provided
      let attachments: { id: string; filename: string; mimeType: string; sizeBytes: number; storageKey: string }[] = [];
      if (input.attachmentIds?.length) {
        // Verify attachments exist and belong to this session
        const found = await ctx.db
          .select()
          .from(sessionAttachments)
          .where(
            and(
              inArray(sessionAttachments.id, input.attachmentIds),
              eq(sessionAttachments.sessionId, input.sessionId),
            ),
          );

        if (found.length !== input.attachmentIds.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "One or more attachments not found or not in this session",
          });
        }

        // Link attachments to the message
        await ctx.db
          .update(sessionAttachments)
          .set({ messageId: message.id })
          .where(inArray(sessionAttachments.id, input.attachmentIds));

        attachments = found.map((a) => ({
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          storageKey: a.storageKey,
        }));
      }

      // Publish to the session-scoped messages channel
      const messagesChannel = `sync:session:${input.sessionId}:messages`;
      await ctx.pubsub.publish(messagesChannel, {
        action: "created",
        data: message,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof message>);

      // Update session's updatedAt
      await ctx.db
        .update(sessions)
        .set({ updatedAt: new Date() })
        .where(eq(sessions.id, input.sessionId));

      // Enqueue session.message job for the Worker
      // Use the session's workerId (not user's current activeWorkerId) to keep
      // the session pinned to the worker it was created on.
      const sessionWorkerId = session.workerId ?? undefined;
      try {
        await enqueueJob(SESSION_MESSAGE, {
          sessionId: input.sessionId,
          messageId: message.id,
          content: input.content,
          attachments,
        }, sessionWorkerId ? { workerId: sessionWorkerId } : undefined);
      } catch (err) {
        getLogger().error(
          { err, sessionId: input.sessionId },
          "Failed to enqueue session.message job",
        );
      }

      return message;
    }),

  // Answer a structured question
  answerQuestion: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        messageId: z.string().uuid(),
        selectedOptions: z.array(z.string()),
        formattedResponse: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Verify session exists
      const [session] = await ctx.db
        .select()
        .from(sessions)
        .where(eq(sessions.id, input.sessionId))
        .limit(1);

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      // Org membership check
      await requireAccessibleRepo(ctx.db, session.repoId, userId);

      // Update the question message's metadata to mark as answered
      await ctx.db
        .update(sessionMessages)
        .set({
          metadata: sql`coalesce(metadata, '{}'::jsonb) || ${JSON.stringify({
            answered: true,
            answeredAt: new Date().toISOString(),
            selectedOptions: input.selectedOptions,
          })}::jsonb`,
        })
        .where(eq(sessionMessages.id, input.messageId));

      // Clear needsInput on the session
      await ctx.db
        .update(sessions)
        .set({
          metadata: sql`coalesce(metadata, '{}'::jsonb) || '{"needsInput": false}'::jsonb`,
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, input.sessionId));

      // Publish sync event for the message update
      const messagesChannel = `sync:session:${input.sessionId}:messages`;
      await ctx.pubsub.publish(messagesChannel, {
        action: "updated",
        data: { sessionId: input.sessionId, messageId: input.messageId },
        timestamp: Date.now(),
      });

      // Publish session-level sync so Questions tab and session list update
      await ctx.pubsub.publish(syncChannel("session"), {
        action: "updated",
        data: { id: input.sessionId },
        timestamp: Date.now(),
      });

      return { success: true };
    }),

  // Stop a session by enqueuing a session.stop job
  stop: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const [session] = await ctx.db
        .select()
        .from(sessions)
        .where(eq(sessions.id, input.id))
        .limit(1);

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      // Org membership check: verify user has access to the session's repo
      await requireAccessibleRepo(ctx.db, session.repoId, userId);

      const sessionWorkerId = session.workerId ?? undefined;
      try {
        await enqueueJob(SESSION_STOP, {
          sessionId: input.id,
        }, sessionWorkerId ? { workerId: sessionWorkerId } : undefined);
      } catch (err) {
        getLogger().error(
          { err, sessionId: input.id },
          "Failed to enqueue session.stop job",
        );
      }

      return { success: true };
    }),

  // Pause an active session
  pause: protectedProcedure
    .input(PauseResumeSessionSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const [session] = await ctx.db
        .select()
        .from(sessions)
        .where(eq(sessions.id, input.sessionId))
        .limit(1);

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      // Org membership check: verify user has access to the session's repo
      await requireAccessibleRepo(ctx.db, session.repoId, userId);

      if (session.status !== "active") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only active sessions can be paused",
        });
      }

      const [updated] = await ctx.db
        .update(sessions)
        .set({ status: "paused", updatedAt: new Date() })
        .where(eq(sessions.id, input.sessionId))
        .returning();

      await ctx.pubsub.publish(syncChannel("session"), {
        action: "updated",
        data: slimSession(updated),
        timestamp: Date.now(),
      } satisfies SyncEvent<Omit<typeof updated, "prompt" | "metadata">>);

      // Enqueue a stop job to kill the CLI child process.
      // All session types (including spec/architecture) now run via SessionManager.
      const sessionWorkerId = session.workerId ?? undefined;
      try {
        await enqueueJob(SESSION_STOP, {
          sessionId: input.sessionId,
          action: "pause",
        }, sessionWorkerId ? { workerId: sessionWorkerId } : undefined);
      } catch (err) {
        getLogger().error(
          { sessionId: input.sessionId, err },
          "Failed to enqueue pause job, reverting status",
        );
        await ctx.db
          .update(sessions)
          .set({ status: "active", updatedAt: new Date() })
          .where(eq(sessions.id, input.sessionId));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to pause session",
        });
      }

      // Write system message
      const [message] = await ctx.db
        .insert(sessionMessages)
        .values({
          sessionId: input.sessionId,
          role: "system",
          content: "Session paused by user.",
        })
        .returning();

      const messagesChannel = `sync:session:${input.sessionId}:messages`;
      await ctx.pubsub.publish(messagesChannel, {
        action: "created",
        data: message,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof message>);

      return updated;
    }),

  // Resume a paused session
  resume: protectedProcedure
    .input(PauseResumeSessionSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const [session] = await ctx.db
        .select()
        .from(sessions)
        .where(eq(sessions.id, input.sessionId))
        .limit(1);

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      // Org membership check: verify user has access to the session's repo
      await requireAccessibleRepo(ctx.db, session.repoId, userId);

      if (session.status !== "paused" && session.status !== "error") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only paused or error sessions can be resumed",
        });
      }

      // Re-resolve worker on every resume so the session picks up the
      // current org worker-policy (backfills legacy NULL worker_id too).
      const workerId = await resolveWorkerForSession(ctx.db, userId, session.repoId);

      const [updated] = await ctx.db
        .update(sessions)
        .set({ status: "active", workerId: workerId ?? null, claimedBy: null, updatedAt: new Date() })
        .where(eq(sessions.id, input.sessionId))
        .returning();

      await ctx.pubsub.publish(syncChannel("session"), {
        action: "updated",
        data: slimSession(updated),
        timestamp: Date.now(),
      } satisfies SyncEvent<Omit<typeof updated, "prompt" | "metadata">>);

      // If a resume message was provided, persist it as a user message
      if (input.message) {
        const [userMsg] = await ctx.db
          .insert(sessionMessages)
          .values({
            sessionId: input.sessionId,
            role: "user",
            content: input.message,
          })
          .returning();

        const messagesChannel = `sync:session:${input.sessionId}:messages`;
        await ctx.pubsub.publish(messagesChannel, {
          action: "created",
          data: userMsg,
          timestamp: Date.now(),
        } satisfies SyncEvent<typeof userMsg>);
      }

      // Enqueue a start job to respawn the CLI child process.
      // All session types (including spec/architecture) now run via SessionManager.
      try {
        await enqueueJob(SESSION_START, {
          sessionId: input.sessionId,
          type: session.type,
          repoId: session.repoId,
          entityType: session.entityType,
          entityId: session.entityId,
          isResume: true,
          resumeMessage: input.message,
        }, workerId ? { workerId } : undefined);
      } catch (err) {
        getLogger().error(
          { err, sessionId: input.sessionId },
          "Failed to enqueue session.start job for resume",
        );
      }

      // Write system message
      const [message] = await ctx.db
        .insert(sessionMessages)
        .values({
          sessionId: input.sessionId,
          role: "system",
          content: "Session resumed by user.",
        })
        .returning();

      const messagesChannel = `sync:session:${input.sessionId}:messages`;
      await ctx.pubsub.publish(messagesChannel, {
        action: "created",
        data: message,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof message>);

      return updated;
    }),

  // Complete a session (active or paused → completed)
  complete: protectedProcedure
    .input(PauseResumeSessionSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const [session] = await ctx.db
        .select()
        .from(sessions)
        .where(eq(sessions.id, input.sessionId))
        .limit(1);

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      // Org membership check: verify user has access to the session's repo
      await requireAccessibleRepo(ctx.db, session.repoId, userId);

      if (session.status !== "active" && session.status !== "paused" && session.status !== "error") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only active, paused, or error sessions can be completed",
        });
      }

      const [updated] = await ctx.db
        .update(sessions)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(sessions.id, input.sessionId))
        .returning();

      await ctx.pubsub.publish(syncChannel("session"), {
        action: "updated",
        data: slimSession(updated),
        timestamp: Date.now(),
      } satisfies SyncEvent<Omit<typeof updated, "prompt" | "metadata">>);

      // Kill child process for active sessions.
      // All session types now run via SessionManager.
      if (session.status === "active") {
        const sessionWorkerId = session.workerId ?? undefined;
        try {
          await enqueueJob(SESSION_STOP, {
            sessionId: input.sessionId,
            action: "pause",
          }, sessionWorkerId ? { workerId: sessionWorkerId } : undefined);
        } catch (err) {
          getLogger().error(
            { sessionId: input.sessionId, err },
            "Failed to enqueue stop job for completed session, reverting status",
          );
          await ctx.db
            .update(sessions)
            .set({ status: session.status, updatedAt: new Date() })
            .where(eq(sessions.id, input.sessionId));
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to complete session",
          });
        }
      }

      // Write system message
      const [message] = await ctx.db
        .insert(sessionMessages)
        .values({
          sessionId: input.sessionId,
          role: "system",
          content: "Session completed by user.",
        })
        .returning();

      const messagesChannel = `sync:session:${input.sessionId}:messages`;
      await ctx.pubsub.publish(messagesChannel, {
        action: "created",
        data: message,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof message>);

      return updated;
    }),

  // Session-level sync (protected; filter events by org membership)
  onSync: protectedProcedure.subscription(async function* ({ ctx, signal }) {
    const userId = requireDbUser(ctx);
    const userOrgIds = await getUserOrgIds(ctx.db, userId);
    const orgRigs = await ctx.db.select({ id: rigs.id }).from(rigs).where(inArray(rigs.orgId, [...userOrgIds]));
    const orgRigIds = new Set(orgRigs.map((r: { id: string }) => r.id));

    for await (const event of iterateEvents<SyncEvent<Session>>(
      ctx.pubsub,
      syncChannel("session"),
      signal!,
    )) {
      // Filter: only yield events for sessions whose repo is in the user's orgs
      const data = event.data as Record<string, unknown>;
      const repoId = data.repoId as string | undefined;
      if (repoId && !orgRigIds.has(repoId)) continue;
      // Fallback: if no repoId in event data, check userId
      if (!repoId && data.userId && data.userId !== userId) continue;
      yield tracked(String(++eventId), event);
    }
  }),

  // Per-session message streaming
  // Ownership check: verify session belongs to the calling user via repo ownership
  onMessages: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .subscription(async function* ({ ctx, input, signal }) {
      const userId = requireDbUser(ctx);

      // Verify session exists
      const [session] = await ctx.db
        .select()
        .from(sessions)
        .where(eq(sessions.id, input.sessionId))
        .limit(1);

      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      }

      // Verify user has org access to the session's repo
      await requireAccessibleRepo(ctx.db, session.repoId, userId);

      const messagesChannel = `sync:session:${input.sessionId}:messages`;
      for await (const event of iterateEvents<SyncEvent<SessionMessage>>(
        ctx.pubsub,
        messagesChannel,
        signal!,
      )) {
        yield tracked(String(++messageEventId), event);
      }
    }),

  listOpenQuestions: requirePermission("session:read")
    .input(ListOpenQuestionsInputSchema)
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Get accessible org repo IDs (same pattern as session.list)
      const userOrgIds = await getUserOrgIds(ctx.db, userId);
      if (userOrgIds.size === 0) return [];

      const orgRigs = await ctx.db
        .select({ id: rigs.id })
        .from(rigs)
        .where(inArray(rigs.orgId, [...userOrgIds]));
      const orgRigIds = orgRigs.map((r: { id: string }) => r.id);
      if (orgRigIds.length === 0) return [];

      // Build conditions: unanswered structured questions on accessible rigs
      const conditions = [
        inArray(sessions.repoId, orgRigIds),
        sql`${sessionMessages.metadata}->>'type' = 'structured_question'`,
        sql`(${sessionMessages.metadata}->>'answered')::boolean IS NOT TRUE`,
      ];

      if (input.repoId) conditions.push(eq(sessions.repoId, input.repoId));
      if (input.sessionId) conditions.push(eq(sessions.id, input.sessionId));
      if (input.olderThanMinutes) {
        conditions.push(
          sql`${sessionMessages.createdAt} < now() - interval '${sql.raw(String(input.olderThanMinutes))} minutes'`,
        );
      }

      const rows = await ctx.db
        .select({
          messageId: sessionMessages.id,
          sessionId: sessions.id,
          sessionTitle: sessions.title,
          repoId: sessions.repoId,
          repoName: rigs.name,
          repoColor: rigs.color,
          metadata: sessionMessages.metadata,
          createdAt: sessionMessages.createdAt,
        })
        .from(sessionMessages)
        .innerJoin(sessions, eq(sessionMessages.sessionId, sessions.id))
        .innerJoin(rigs, eq(sessions.repoId, rigs.id))
        .where(and(...conditions))
        .orderBy(asc(sessionMessages.createdAt))
        .limit(200);

      return rows;
    }),

  cancelScheduled: requirePermission("session:create:working")
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const [session] = await ctx.db
        .select()
        .from(sessions)
        .where(eq(sessions.id, input.sessionId))
        .limit(1);

      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      }

      // Verify caller owns the session (via org access to the repo)
      await requireAccessibleRepo(ctx.db, session.repoId, userId);

      if (session.status !== "scheduled") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only scheduled sessions can be cancelled",
        });
      }

      // Cancel the pg-boss job if we have a jobId
      if (session.jobId) {
        try {
          const queueName = session.workerId
            ? workerQueue(SESSION_START, session.workerId)
            : SESSION_START;
          await cancelJob(queueName, session.jobId);
        } catch (err) {
          getLogger().error({ err, jobId: session.jobId }, "Failed to cancel pg-boss job");
        }
      }

      // Update session status to completed
      const [updated] = await ctx.db
        .update(sessions)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(sessions.id, input.sessionId))
        .returning();

      // Publish sync event
      await ctx.pubsub.publish(syncChannel("session"), {
        action: "updated",
        data: slimSession(updated),
        timestamp: Date.now(),
      } satisfies SyncEvent<Omit<typeof updated, "prompt" | "metadata">>);

      return updated;
    }),

  openQuestionCount: requirePermission("session:read")
    .input(ListOpenQuestionsInputSchema)
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const userOrgIds = await getUserOrgIds(ctx.db, userId);
      if (userOrgIds.size === 0) return { count: 0 };

      const orgRigs = await ctx.db
        .select({ id: rigs.id })
        .from(rigs)
        .where(inArray(rigs.orgId, [...userOrgIds]));
      const orgRigIds = orgRigs.map((r: { id: string }) => r.id);
      if (orgRigIds.length === 0) return { count: 0 };

      const conditions = [
        inArray(sessions.repoId, orgRigIds),
        sql`${sessionMessages.metadata}->>'type' = 'structured_question'`,
        sql`(${sessionMessages.metadata}->>'answered')::boolean IS NOT TRUE`,
      ];

      if (input.repoId) conditions.push(eq(sessions.repoId, input.repoId));
      if (input.sessionId) conditions.push(eq(sessions.id, input.sessionId));
      if (input.olderThanMinutes) {
        conditions.push(
          sql`${sessionMessages.createdAt} < now() - interval '${sql.raw(String(input.olderThanMinutes))} minutes'`,
        );
      }

      const [result] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(sessionMessages)
        .innerJoin(sessions, eq(sessionMessages.sessionId, sessions.id))
        .where(and(...conditions));

      return { count: result?.count ?? 0 };
    }),
});
