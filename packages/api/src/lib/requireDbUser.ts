import { TRPCError } from "@trpc/server";

/**
 * Extracts the DB user ID from the tRPC context.
 * Throws NOT_FOUND if the user has no matching database record.
 *
 * Use this in protectedProcedure handlers where a DB user row is required.
 */
export function requireDbUser(ctx: { dbUser: { id: string } | null | undefined }): string {
  if (!ctx.dbUser) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  }
  return ctx.dbUser.id;
}
