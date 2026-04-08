import { randomBytes } from "node:crypto";

import { and, eq, gt, sql } from "drizzle-orm";
import { CreateUserSchema, UpdateThemeSchema, syncChannel, type SyncEvent, type User } from "@praxis2/shared";
import { hash } from "bcrypt";
import { tracked, TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, jwtProcedure } from "../trpc.js";
import { getAuth0MgmtAdapter } from "../services/auth0-mgmt/index.js";
import { users, roles, orgInvitations, orgMembers, organizations } from "../db/schema.js";
import { readSetting } from "../db/system-settings.js";
import { sendNotification } from "../services/notifications/index.js";
import { iterateEvents } from "../lib/iterateEvents.js";
import { enqueueJob } from "../jobs/index.js";
import { WELCOME_NOTIFICATION } from "../jobs/handlers/sendWelcomeNotification.js";
import { getLogger } from "../lib/logger.js";
import { provisionDbRole } from "../lib/provisionDbRole.js";
import { getSql } from "../db/index.js";

let eventId = 0;

export const userRouter = router({
  me: protectedProcedure.query(async ({ ctx }) => {
    return ctx.dbUser;
  }),

  updateTheme: protectedProcedure
    .input(UpdateThemeSchema)
    .mutation(async ({ ctx, input }) => {
      const sub = ctx.user.sub as string;
      const [updated] = await ctx.db
        .update(users)
        .set({ theme: input.theme })
        .where(eq(users.sub, sub))
        .returning();
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }
      await ctx.pubsub.publish(syncChannel("user"), {
        action: "updated",
        data: updated,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof updated>);
      return updated;
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(users).orderBy(users.createdAt);
  }),

  onSync: protectedProcedure.subscription(async function* ({ ctx, signal }) {
    for await (const event of iterateEvents<SyncEvent<User>>(
      ctx.pubsub,
      syncChannel("user"),
      signal!,
    )) {
      yield tracked(String(++eventId), event);
    }
  }),

  create: protectedProcedure
    .input(CreateUserSchema)
    .mutation(async ({ ctx, input }) => {
      const sub = ctx.user.sub as string | undefined;

      // Look up the default role setting
      let roleId: string | undefined;
      const defaultRoleId = await readSetting("default_role_id");
      if (defaultRoleId) {
        const [role] = await ctx.db
          .select({ id: roles.id })
          .from(roles)
          .where(eq(roles.id, defaultRoleId))
          .limit(1);
        if (role) {
          roleId = role.id;
        } else {
          getLogger().warn({ defaultRoleId }, "Default role not found, skipping role assignment");
        }
      }

      const [user] = await ctx.db.insert(users).values({
        ...input,
        role: "user",
        ...(sub && { sub }),
        ...(roleId && { roleId }),
      }).returning();
      await ctx.pubsub.publish(syncChannel("user"), {
        action: "created",
        data: user,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof user>);

      try {
        await provisionDbRole(getSql(), user.id);
      } catch (err) {
        getLogger().warn({ err, userId: user.id }, "Failed to provision DB role for user");
      }

      // Auto-join orgs with pending invitations for this email
      try {
        const pendingInvitations = await ctx.db
          .select({
            invitation: orgInvitations,
            orgName: organizations.name,
          })
          .from(orgInvitations)
          .innerJoin(organizations, eq(orgInvitations.orgId, organizations.id))
          .where(
            and(
              eq(sql`lower(${orgInvitations.email})`, input.email.toLowerCase()),
              eq(orgInvitations.status, "pending"),
              gt(orgInvitations.expiresAt, new Date()),
            )
          );

        for (const { invitation, orgName } of pendingInvitations) {
          // Insert org membership
          await ctx.db.insert(orgMembers).values({
            orgId: invitation.orgId,
            userId: user.id,
            role: invitation.role,
          });

          // Mark invitation as accepted
          await ctx.db
            .update(orgInvitations)
            .set({ status: "accepted" })
            .where(eq(orgInvitations.id, invitation.id));

          // Send notification
          await sendNotification(ctx.db, ctx.pubsub, { userId: user.id }, {
            title: `Welcome to ${orgName}!`,
            body: `You've been added to ${orgName}.`,
          });
        }

        if (pendingInvitations.length > 0) {
          getLogger().info(
            { userId: user.id, count: pendingInvitations.length },
            "Auto-joined user to orgs from pending invitations",
          );
        }
      } catch (err) {
        getLogger().error({ err, userId: user.id }, "Failed to process pending invitations");
      }

      try {
        await enqueueJob(WELCOME_NOTIFICATION, { userId: user.id });
      } catch (err) {
        getLogger().error({ err, userId: user.id }, "Failed to enqueue welcome notification");
      }

      return user;
    }),

  touch: protectedProcedure
    .mutation(async ({ ctx }) => {
      const sub = ctx.user.sub as string;
      const [user] = await ctx.db
        .update(users)
        .set({ lastLoginAt: new Date() })
        .where(eq(users.sub, sub))
        .returning();
      if (user) {
        await ctx.pubsub.publish(syncChannel("user"), {
          action: "updated",
          data: user,
          timestamp: Date.now(),
        } satisfies SyncEvent<typeof user>);
      }
      return user ?? null;
    }),

  generateApiKey: protectedProcedure
    .mutation(async ({ ctx }) => {
      const sub = ctx.user.sub as string;
      const plainKey = randomBytes(32).toString("hex");
      const hashedKey = await hash(plainKey, 10);

      const [updated] = await ctx.db
        .update(users)
        .set({ apiKeyHash: hashedKey })
        .where(eq(users.sub, sub))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      return { apiKey: plainKey };
    }),

  revokeApiKey: protectedProcedure
    .mutation(async ({ ctx }) => {
      const sub = ctx.user.sub as string;
      const [updated] = await ctx.db
        .update(users)
        .set({ apiKeyHash: null })
        .where(eq(users.sub, sub))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      return { success: true };
    }),

  resendVerification: jwtProcedure
    .mutation(async ({ ctx }) => {
      const sub = ctx.user.sub as string;
      const result = await getAuth0MgmtAdapter().sendVerificationEmail(sub);
      return { success: result.success };
    }),

  delete: protectedProcedure
    .input(CreateUserSchema.pick({ email: true }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.dbUser) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Caller user record not found" });
      }
      if (ctx.dbUser.role !== "admin" && ctx.dbUser.email !== input.email) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only delete your own account" });
      }

      const [deleted] = await ctx.db
        .delete(users)
        .where(eq(users.email, input.email))
        .returning();
      if (!deleted) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }
      await ctx.pubsub.publish(syncChannel("user"), {
        action: "deleted",
        data: deleted,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof deleted>);
      return { success: true };
    }),
});
