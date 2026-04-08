import { z } from "zod";
import { eq, and, lt, desc, sql } from "drizzle-orm";
import { tracked, TRPCError } from "@trpc/server";
import {
  NotificationListInputSchema,
  RegisterPushTokenSchema,
  UpdatePushOptOutSchema,
  syncChannel,
  type SyncEvent,
  type Notification,
} from "@praxis2/shared";
import { router, protectedProcedure } from "../trpc.js";
import { notifications, pushTokens, users } from "../db/schema.js";
import { iterateEvents } from "../lib/iterateEvents.js";
import { sendNotification } from "../services/notifications/index.js";

let eventId = 0;

function requireDbUser(ctx: { dbUser: { id: string } | null | undefined }) {
  if (!ctx.dbUser) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  }
  return ctx.dbUser.id;
}

export const notificationRouter = router({
  list: protectedProcedure
    .input(NotificationListInputSchema)
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const repoFilter = input.repoId != null
        ? eq(notifications.repoId, input.repoId)
        : undefined;

      let query = ctx.db
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, userId), repoFilter))
        .orderBy(desc(notifications.createdAt))
        .limit(input.limit + 1);

      if (input.cursor) {
        const [cursorRow] = await ctx.db
          .select({ createdAt: notifications.createdAt })
          .from(notifications)
          .where(eq(notifications.id, input.cursor))
          .limit(1);

        if (cursorRow) {
          query = ctx.db
            .select()
            .from(notifications)
            .where(
              and(
                eq(notifications.userId, userId),
                repoFilter,
                lt(notifications.createdAt, cursorRow.createdAt),
              ),
            )
            .orderBy(desc(notifications.createdAt))
            .limit(input.limit + 1);
        }
      }

      const rows = await query;
      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      const nextCursor = hasMore ? items[items.length - 1].id : null;

      return { notifications: items, nextCursor };
    }),

  unreadCount: protectedProcedure
    .input(z.object({ repoId: z.string().uuid().nullable().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const repoFilter = input?.repoId != null
        ? eq(notifications.repoId, input.repoId)
        : undefined;

      const [{ count }] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(
          and(eq(notifications.userId, userId), eq(notifications.read, false), repoFilter),
        );

      return { count };
    }),

  markRead: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const [notification] = await ctx.db
        .select()
        .from(notifications)
        .where(eq(notifications.id, input.id))
        .limit(1);

      if (!notification) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Notification not found" });
      }
      if (notification.userId !== userId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your notification" });
      }

      const [updated] = await ctx.db
        .update(notifications)
        .set({ read: true })
        .where(eq(notifications.id, input.id))
        .returning();

      await ctx.pubsub.publish(syncChannel("notification"), {
        action: "updated",
        data: updated,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof updated>);

      return updated;
    }),

  markUnread: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const [notification] = await ctx.db
        .select()
        .from(notifications)
        .where(eq(notifications.id, input.id))
        .limit(1);

      if (!notification) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Notification not found" });
      }
      if (notification.userId !== userId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your notification" });
      }

      const [updated] = await ctx.db
        .update(notifications)
        .set({ read: false })
        .where(eq(notifications.id, input.id))
        .returning();

      await ctx.pubsub.publish(syncChannel("notification"), {
        action: "updated",
        data: updated,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof updated>);

      return updated;
    }),

  markAllRead: protectedProcedure
    .input(z.object({ repoId: z.string().uuid().nullable().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const repoFilter = input?.repoId != null
        ? eq(notifications.repoId, input.repoId)
        : undefined;

      const updated = await ctx.db
        .update(notifications)
        .set({ read: true })
        .where(
          and(eq(notifications.userId, userId), eq(notifications.read, false), repoFilter),
        )
        .returning();

      if (updated.length > 0) {
        await ctx.pubsub.publish(syncChannel("notification"), {
          action: "updated",
          data: updated,
          timestamp: Date.now(),
        } satisfies SyncEvent<typeof updated>);
      }

      return { count: updated.length };
    }),

  onSync: protectedProcedure.subscription(async function* ({ ctx, signal }) {
    const userId = requireDbUser(ctx);
    for await (const event of iterateEvents<SyncEvent<Notification>>(
      ctx.pubsub,
      syncChannel("notification"),
      signal!,
    )) {
      const data = event.data as Record<string, unknown>;
      // Forward user-scoped notifications
      if (data.userId && data.userId !== userId) continue;
      yield tracked(String(++eventId), event);
    }
  }),

  sendTestPush: protectedProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [targetUser] = await ctx.db
        .select()
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);

      if (!targetUser) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      const result = await sendNotification(ctx.db, ctx.pubsub, { userId: input.userId }, {
        title: "Test Notification",
        body: `This is a test push notification sent to ${targetUser.name}.`,
      });

      return result;
    }),

  registerPushToken: protectedProcedure
    .input(RegisterPushTokenSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      await ctx.db
        .insert(pushTokens)
        .values({ userId, token: input.token })
        .onConflictDoUpdate({
          target: pushTokens.token,
          set: { userId },
        });

      return { success: true };
    }),

  updatePushOptOut: protectedProcedure
    .input(UpdatePushOptOutSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const [updated] = await ctx.db
        .update(users)
        .set({ pushOptOut: input.optOut })
        .where(eq(users.id, userId))
        .returning();

      await ctx.pubsub.publish(syncChannel("user"), {
        action: "updated",
        data: updated,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof updated>);

      return { pushOptOut: input.optOut };
    }),
});
