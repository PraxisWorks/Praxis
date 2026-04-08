import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { rigs as repos } from "../db/schema.js";
import { requireOrgMember } from "./requireOrgMember.js";

/**
 * Fetch a repo by ID and verify the user has access via org membership.
 * Returns the repo row on success; throws NOT_FOUND or FORBIDDEN on failure.
 */
export async function requireAccessibleRepo(
  db: any,
  repoId: string,
  userId: string,
) {
  const [repo] = await db
    .select()
    .from(repos)
    .where(eq(repos.id, repoId))
    .limit(1);

  if (!repo) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Repo not found" });
  }

  await requireOrgMember(db, repo.orgId, userId);
  return repo;
}
