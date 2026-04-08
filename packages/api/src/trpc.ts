import { initTRPC, TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import type { Context } from "./context.js";
import { users } from "./db/schema.js";

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const jwtProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  // Self-hosted deploys can opt out of email verification enforcement
  // by setting DISABLE_EMAIL_VERIFICATION=true.
  if (process.env.DISABLE_EMAIL_VERIFICATION !== "true") {
    const emailVerified =
      ctx.user["https://praxis.app/email_verified"];
    if (emailVerified === false) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Email verification required",
      });
    }
  }

  let dbUser: typeof users.$inferSelect | null = null;
  const sub = ctx.user.sub as string | undefined;
  if (sub) {
    const rows = await ctx.db
      .select()
      .from(users)
      .where(eq(users.sub, sub))
      .limit(1);
    dbUser = rows[0] ?? null;
  }

  return next({ ctx: { ...ctx, user: ctx.user, dbUser } });
});
