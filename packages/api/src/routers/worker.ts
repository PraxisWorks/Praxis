import { z } from "zod";
import { randomBytes } from "crypto";
import { eq, and, or, isNull, desc, sql } from "drizzle-orm";
import { tracked, TRPCError } from "@trpc/server";
import { hash } from "bcrypt";
import {
  CreateWorkerTokenSchema,
  UpdateWorkerSchema,
  RepoInitSettingsSchema,
  syncChannel,
  type SyncEvent,
  type Worker,
} from "@praxis2/shared";
import { router, protectedProcedure } from "../trpc.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { workers, workerTokens, users } from "../db/schema.js";
import { iterateEvents } from "../lib/iterateEvents.js";
import { requireDbUser } from "../lib/requireDbUser.js";
import { checkLimitFromRole } from "../lib/checkLimitFromRole.js";

let eventId = 0;

// Helper: fetch a worker by ID, verify the calling user owns it.
async function requireOwnedWorker(
  db: any,
  workerId: string,
  userId: string,
) {
  const [worker] = await db
    .select()
    .from(workers)
    .where(and(eq(workers.id, workerId), eq(workers.userId, userId)))
    .limit(1);

  if (!worker) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Worker not found or not owned by you" });
  }
  return worker;
}

export const workerRouter = router({
  // List workers belonging to the current user AND shared workers (userId IS NULL).
  // Returns them ordered by createdAt descending (newest first).
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = requireDbUser(ctx);
    return ctx.db
      .select()
      .from(workers)
      .where(or(eq(workers.userId, userId), isNull(workers.userId)))
      .orderBy(desc(workers.createdAt));
  }),

  // Get the user's active worker details.
  // Fetches the user row, then the worker row if activeWorkerId is set.
  getActive: protectedProcedure.query(async ({ ctx }) => {
    const userId = requireDbUser(ctx);

    const [user] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user || !user.activeWorkerId) {
      return null;
    }

    const [worker] = await ctx.db
      .select()
      .from(workers)
      .where(and(eq(workers.id, user.activeWorkerId), or(eq(workers.userId, userId), isNull(workers.userId))))
      .limit(1);

    return worker ?? null;
  }),

  // Generate a one-time registration token with 15-min TTL.
  // Hashes with bcrypt, stores in workerTokens table, returns plaintext.
  generateToken: requirePermission("worker:create:local")
    .input(CreateWorkerTokenSchema)
    .mutation(async ({ ctx }) => {
      const userId = requireDbUser(ctx);

      await checkLimitFromRole(
        ctx.db,
        userId,
        ctx.dbUser!.roleId,
        ctx.dbUser!.role,
        'maxWorkers',
        async () => {
          const [{ count }] = await ctx.db
            .select({ count: sql<number>`count(*)::int` })
            .from(workers)
            .where(eq(workers.userId, userId));
          return count;
        },
      );

      const token = randomBytes(32).toString("hex");
      const tokenHash = await hash(token, 10);
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      await ctx.db
        .insert(workerTokens)
        .values({ userId, tokenHash, expiresAt });

      return { token, expiresAt };
    }),

  // Remove a worker. Also nullifies user's activeWorkerId if it pointed here.
  removeWorker: requirePermission("worker:delete")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const worker = await requireOwnedWorker(ctx.db, input.id, userId);

      // Nullify activeWorkerId if it points to this worker
      await ctx.db
        .update(users)
        .set({ activeWorkerId: null })
        .where(and(eq(users.id, userId), eq(users.activeWorkerId, input.id)));

      await ctx.db
        .delete(workers)
        .where(and(eq(workers.id, input.id), eq(workers.userId, userId)));

      await ctx.pubsub.publish(syncChannel("worker"), {
        action: "deleted",
        data: worker,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof worker>);

      return { success: true };
    }),

  // Rename a worker.
  renameWorker: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: UpdateWorkerSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const [updated] = await ctx.db
        .update(workers)
        .set({
          ...input.data,
          updatedAt: new Date(),
        })
        .where(and(eq(workers.id, input.id), eq(workers.userId, userId)))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Worker not found or not owned by you" });
      }

      await ctx.pubsub.publish(syncChannel("worker"), {
        action: "updated",
        data: updated,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof updated>);

      return updated;
    }),

  // Set the user's active worker.
  // If workerId is non-null, verifies the worker belongs to the user or is shared.
  setActive: protectedProcedure
    .input(z.object({ workerId: z.string().uuid().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      if (input.workerId !== null) {
        // Allow owned workers OR shared workers (userId IS NULL)
        const [worker] = await ctx.db
          .select()
          .from(workers)
          .where(and(eq(workers.id, input.workerId), or(eq(workers.userId, userId), isNull(workers.userId))))
          .limit(1);
        if (!worker) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Worker not found" });
        }
      }

      const [updated] = await ctx.db
        .update(users)
        .set({ activeWorkerId: input.workerId })
        .where(eq(users.id, userId))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      await ctx.pubsub.publish(syncChannel("worker"), {
        action: "updated",
        data: { userId, activeWorkerId: input.workerId },
        timestamp: Date.now(),
      } satisfies SyncEvent<{ userId: string; activeWorkerId: string | null }>);

      return { activeWorkerId: input.workerId };
    }),

  // Get rig init settings for a worker.
  getSettings: protectedProcedure
    .input(z.object({ workerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      const worker = await requireOwnedWorker(ctx.db, input.workerId, userId);
      return (worker.repoInitSettings as { mode: string; scripts?: string[] }) ?? null;
    }),

  // Update rig init settings for a worker.
  setSettings: protectedProcedure
    .input(z.object({
      workerId: z.string().uuid(),
      settings: RepoInitSettingsSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      await requireOwnedWorker(ctx.db, input.workerId, userId);

      const [updated] = await ctx.db
        .update(workers)
        .set({
          repoInitSettings: input.settings,
          updatedAt: new Date(),
        })
        .where(and(eq(workers.id, input.workerId), eq(workers.userId, userId)))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Worker not found" });
      }

      return (updated.repoInitSettings as { mode: string; scripts?: string[] }) ?? null;
    }),

  // Real-time subscription for worker sync events.
  // Filters events to only yield those belonging to the current user.
  onSync: protectedProcedure.subscription(async function* ({ ctx, signal }) {
    const userId = requireDbUser(ctx);
    for await (const event of iterateEvents<SyncEvent<Worker>>(
      ctx.pubsub,
      syncChannel("worker"),
      signal!,
    )) {
      if (event.data.userId === userId || event.data.userId === null) {
        yield tracked(String(++eventId), event);
      }
    }
  }),
});
