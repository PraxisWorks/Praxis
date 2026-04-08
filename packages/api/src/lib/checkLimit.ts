import { eq, and, count, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { roles, sessions, orgMembers, repos, ideas } from "../db/schema.js";
import { getLogger } from "./logger.js";

// ── checkLimitFromRole ─────────────────────────────────────────────
// Reads limits directly from the roles table columns and counts usage
// internally, so callers don't need to pre-count.

export type RoleLimitType =
  | "active_sessions"
  | "org_memberships"
  | "repos_per_org"
  | "ideas_per_repo";

const ROLE_LIMIT_COLUMN: Record<RoleLimitType, keyof typeof roles.$inferSelect> = {
  active_sessions: "maxActiveSessions",
  org_memberships: "maxOrgMemberships",
  repos_per_org: "maxReposPerOrg",
  ideas_per_repo: "maxIdeasPerRepo",
};

const ROLE_LIMIT_MESSAGES: Record<RoleLimitType, (current: number, max: number) => string> = {
  active_sessions: (c, m) =>
    `Active session limit reached (${c}/${m}). Complete or close a session to create a new one.`,
  org_memberships: (c, m) =>
    `Organization membership limit reached (${c}/${m}).`,
  repos_per_org: (c, m) =>
    `Repo limit reached for this organization (${c}/${m}).`,
  ideas_per_repo: (c, m) =>
    `Idea limit reached for this repo (${c}/${m}).`,
};

/**
 * Check a usage limit by reading the cap from the roles table columns
 * and counting current usage from the relevant table.
 *
 * @param db       - Drizzle database instance
 * @param dbUser   - The authenticated user (id, role, roleId)
 * @param limitType - Which limit to check
 * @param scopeId  - Required for repos_per_org (orgId) and ideas_per_repo (repoId)
 */
export async function checkLimitFromRole(
  db: any,
  dbUser: { id: string; role: string; roleId: string | null },
  limitType: RoleLimitType,
  scopeId?: string,
): Promise<void> {
  // 1. Admin bypass
  if (dbUser.role === "admin") return;

  // 2. No role assigned = no limits
  if (!dbUser.roleId) return;

  // 3. Look up the role's limit value
  const columnName = ROLE_LIMIT_COLUMN[limitType];
  const [role] = await db
    .select({ limitValue: roles[columnName] })
    .from(roles)
    .where(eq(roles.id, dbUser.roleId))
    .limit(1);

  if (!role) return;

  // 4. Null = unlimited
  if (role.limitValue === null || role.limitValue === undefined) return;

  // 5. Count current usage
  const currentCount = await countUsage(db, dbUser.id, limitType, scopeId);

  // 6. Enforce
  if (currentCount >= role.limitValue) {
    const message = ROLE_LIMIT_MESSAGES[limitType](currentCount, role.limitValue);
    getLogger().warn(
      { userId: dbUser.id, limitType, currentCount, maxValue: role.limitValue },
      `Limit enforcement: ${message}`,
    );
    throw new TRPCError({ code: "FORBIDDEN", message });
  }
}

async function countUsage(
  db: any,
  userId: string,
  limitType: RoleLimitType,
  scopeId?: string,
): Promise<number> {
  let result: { value: number }[];

  switch (limitType) {
    case "active_sessions":
      result = await db
        .select({ value: count() })
        .from(sessions)
        .where(
          and(
            eq(sessions.userId, userId),
            inArray(sessions.status, ["active", "scheduled"]),
          ),
        );
      break;

    case "org_memberships":
      result = await db
        .select({ value: count() })
        .from(orgMembers)
        .where(eq(orgMembers.userId, userId));
      break;

    case "repos_per_org":
      if (!scopeId) throw new Error("scopeId (orgId) is required for repos_per_org");
      result = await db
        .select({ value: count() })
        .from(repos)
        .where(eq(repos.orgId, scopeId));
      break;

    case "ideas_per_repo":
      if (!scopeId) throw new Error("scopeId (repoId) is required for ideas_per_repo");
      result = await db
        .select({ value: count() })
        .from(ideas)
        .where(eq(ideas.repoId, scopeId));
      break;
  }

  return result[0]?.value ?? 0;
}
