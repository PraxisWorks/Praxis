import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { UpdateUserRoleSchema, GetUserStatsInputSchema } from "@praxis2/shared";
import { router, protectedProcedure } from "../trpc.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { users, sessions } from "../db/schema.js";
import { readAllSettings, writeSetting, type SystemSettingKey } from "../db/system-settings.js";

export const adminRouter = router({
  claimAdmin: protectedProcedure.mutation(async ({ ctx }) => {
    if (!ctx.dbUser) {
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found. Create your account first." });
    }

    const admins = await ctx.db
      .select()
      .from(users)
      .where(eq(users.role, "admin"))
      .limit(1);

    if (admins.length > 0) {
      throw new TRPCError({ code: "FORBIDDEN", message: "An admin already exists" });
    }

    const [updated] = await ctx.db
      .update(users)
      .set({ role: "admin" })
      .where(eq(users.id, ctx.dbUser.id))
      .returning();

    return updated;
  }),

  listUsers: requirePermission("admin:users:manage").query(async ({ ctx }) => {
    return ctx.db.select().from(users).orderBy(users.createdAt);
  }),

  updateRole: requirePermission("admin:users:manage")
    .input(UpdateUserRoleSchema)
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(users)
        .set({ role: input.role })
        .where(eq(users.email, input.email))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      return updated;
    }),

  getUserStats: requirePermission("admin:users:manage")
    .input(GetUserStatsInputSchema)
    .query(async ({ ctx, input }) => {
      // 1. Verify user exists
      const [user] = await ctx.db
        .select()
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);

      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      // 2. Count sessions by type
      const sessionCounts = await ctx.db
        .select({
          type: sessions.type,
          count: sql<number>`count(*)::int`,
        })
        .from(sessions)
        .where(eq(sessions.userId, input.userId))
        .groupBy(sessions.type);

      // 3. Get last session date
      const [lastSession] = await ctx.db
        .select({
          lastSessionAt: sql<Date | null>`max(${sessions.createdAt})`,
        })
        .from(sessions)
        .where(eq(sessions.userId, input.userId));

      // 4. Build response
      const sessionsByType: Record<string, number> = {};
      let totalSessions = 0;
      for (const row of sessionCounts) {
        sessionsByType[row.type] = row.count;
        totalSessions += row.count;
      }

      return {
        totalSessions,
        sessionsByType,
        lastSessionAt: lastSession?.lastSessionAt ?? null,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
      };
    }),

  getSystemSettings: requirePermission("admin:users:manage")
    .query(async () => {
      return readAllSettings();
    }),

  updateSystemSetting: requirePermission("admin:users:manage")
    .input(z.object({
      key: z.enum(["default_role_id"]),
      value: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      await writeSetting(input.key as SystemSettingKey, input.value);
      return { ok: true };
    }),
});
