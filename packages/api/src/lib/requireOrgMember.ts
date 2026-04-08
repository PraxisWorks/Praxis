import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { orgMembers } from "../db/schema.js";
import type { OrgRole } from "@praxis2/shared";

/**
 * Verifies the user is a member of the given organization.
 * Optionally enforces minimum role (owner > admin > member).
 * Returns the membership row on success; throws FORBIDDEN on failure.
 */
export async function requireOrgMember(
  db: any,
  orgId: string,
  userId: string,
  minimumRole?: OrgRole,
): Promise<typeof orgMembers.$inferSelect> {
  const [membership] = await db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1);

  if (!membership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this organization",
    });
  }

  if (minimumRole) {
    const hierarchy: Record<OrgRole, number> = { owner: 3, admin: 2, member: 1 };
    if (hierarchy[membership.role as OrgRole] < hierarchy[minimumRole]) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Requires at least ${minimumRole} role in this organization`,
      });
    }
  }

  return membership;
}
