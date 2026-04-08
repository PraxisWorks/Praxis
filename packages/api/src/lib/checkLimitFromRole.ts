import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { roles } from "../db/schema.js";

/**
 * Generic role-based limit check.
 *
 * Reads a numeric cap from the `roles` table and compares it against a
 * caller-supplied count query.  Designed to be reusable across different
 * limit types (workers today, future limits tomorrow).
 *
 * @param db          Drizzle database instance
 * @param userId      The authenticated user's id (for logging / future use)
 * @param roleId      The user's roleId — null means "no role, no limits"
 * @param userRole    The legacy role string (e.g. "admin", "member")
 * @param limitKey    Column name on the roles table to read the cap from
 * @param countQuery  Async function returning the current usage count
 */
export async function checkLimitFromRole(
  db: any,
  userId: string,
  roleId: string | null,
  userRole: string,
  limitKey: "maxWorkers",
  countQuery: () => Promise<number>,
): Promise<void> {
  // 1. Admin bypass
  if (userRole === "admin") return;

  // 2. No role assigned = no limits
  if (roleId === null) return;

  // 3. Look up the role row
  const [role] = await db
    .select({ limitValue: roles[limitKey] })
    .from(roles)
    .where(eq(roles.id, roleId))
    .limit(1);

  if (!role) return;

  // 4. Null = unlimited
  if (role.limitValue === null || role.limitValue === undefined) return;

  // 5. Count current usage
  const currentCount = await countQuery();

  // 6. Enforce
  if (currentCount >= role.limitValue) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Worker limit reached (${currentCount}/${role.limitValue})`,
    });
  }
}
