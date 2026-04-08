import { eq } from "drizzle-orm";
import { orgMembers } from "../db/schema.js";

/**
 * Loads the set of organization IDs that a user belongs to.
 * Used by sync subscriptions to filter events to only those
 * organizations the user is a member of.
 */
export async function getUserOrgIds(
  db: any,
  userId: string,
): Promise<Set<string>> {
  const memberships = await db
    .select({ orgId: orgMembers.orgId })
    .from(orgMembers)
    .where(eq(orgMembers.userId, userId));

  return new Set(memberships.map((m: { orgId: string }) => m.orgId));
}

/**
 * Checks whether a sync event's data has an orgId that belongs
 * to the user's organization set. Returns true if the event
 * should be forwarded to the user.
 *
 * If the event data doesn't have an orgId field, returns true
 * (backwards-compatible with events that predate org scoping).
 */
export function shouldForwardOrgEvent(
  data: Record<string, unknown>,
  userOrgIds: Set<string>,
): boolean {
  const orgId = data.orgId as string | undefined;
  if (!orgId) return true;
  return userOrgIds.has(orgId);
}
