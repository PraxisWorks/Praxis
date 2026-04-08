import { eq, and, inArray, sql, gte } from "drizzle-orm";
import { StatsInputSchema, TimelineInputSchema } from "@praxis2/shared";
import { router, protectedProcedure } from "../trpc.js";
import { tasks, ideas, rigs } from "../db/schema.js";
import { requireDbUser } from "../lib/requireDbUser.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { requireAccessibleRepo } from "../lib/requireAccessibleRepo.js";
import { getUserOrgIds } from "../lib/orgSyncFilter.js";

/**
 * Resolve repo-scoping conditions for the tasks table.
 * When repoId is provided, verifies access and scopes to that repo.
 * When repoId is null, scopes to all repos in the user's orgs.
 * Returns null if the user has no accessible rigs (empty result).
 */
async function resolveTaskRepoConditions(
  db: any,
  repoId: string | null,
  userId: string,
) {
  if (repoId !== null) {
    await requireAccessibleRepo(db, repoId, userId);
    return [eq(tasks.repoId, repoId)];
  }

  const userOrgIds = await getUserOrgIds(db, userId);
  const orgRigs = await db
    .select({ id: rigs.id })
    .from(rigs)
    .where(inArray(rigs.orgId, [...userOrgIds]));

  const repoIds = orgRigs.map((r: { id: string }) => r.id);
  if (repoIds.length === 0) return null;

  return [inArray(tasks.repoId, repoIds)];
}

/**
 * Resolve repo-scoping conditions for the ideas table.
 * Same logic as tasks but targets ideas.repoId.
 */
async function resolveIdeaRepoConditions(
  db: any,
  repoId: string | null,
  userId: string,
) {
  if (repoId !== null) {
    await requireAccessibleRepo(db, repoId, userId);
    return [eq(ideas.repoId, repoId)];
  }

  const userOrgIds = await getUserOrgIds(db, userId);
  const orgRigs = await db
    .select({ id: rigs.id })
    .from(rigs)
    .where(inArray(rigs.orgId, [...userOrgIds]));

  const repoIds = orgRigs.map((r: { id: string }) => r.id);
  if (repoIds.length === 0) return null;

  return [inArray(ideas.repoId, repoIds)];
}

const emptySummary = {
  ideas: [],
  epics: [],
  tasks: [],
  totals: { ideas: 0, epics: 0, tasks: 0 },
};

const emptyTimeline = { ideas: [], epics: [], tasks: [] };

export const statsRouter = router({
  summary: requirePermission("stats:read")
    .input(StatsInputSchema)
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const ideaConditions = await resolveIdeaRepoConditions(
        ctx.db,
        input.repoId,
        userId,
      );
      const taskConditions = await resolveTaskRepoConditions(
        ctx.db,
        input.repoId,
        userId,
      );

      if (!ideaConditions && !taskConditions) return emptySummary;

      // Count ideas by status
      const ideaCounts = ideaConditions
        ? await ctx.db
            .select({
              status: ideas.status,
              count: sql<number>`count(*)::int`,
            })
            .from(ideas)
            .where(and(...ideaConditions))
            .groupBy(ideas.status)
        : [];

      // Count tasks (isEpic = false) by status
      const taskCounts = taskConditions
        ? await ctx.db
            .select({
              status: tasks.status,
              count: sql<number>`count(*)::int`,
            })
            .from(tasks)
            .where(and(...taskConditions, eq(tasks.isEpic, false)))
            .groupBy(tasks.status)
        : [];

      // Count epics (isEpic = true) by status
      const epicCounts = taskConditions
        ? await ctx.db
            .select({
              status: tasks.status,
              count: sql<number>`count(*)::int`,
            })
            .from(tasks)
            .where(and(...taskConditions, eq(tasks.isEpic, true)))
            .groupBy(tasks.status)
        : [];

      const sumCounts = (rows: { count: number }[]) =>
        rows.reduce((acc, r) => acc + r.count, 0);

      return {
        ideas: ideaCounts,
        epics: epicCounts,
        tasks: taskCounts,
        totals: {
          ideas: sumCounts(ideaCounts),
          epics: sumCounts(epicCounts),
          tasks: sumCounts(taskCounts),
        },
      };
    }),

  timeline: requirePermission("stats:read")
    .input(TimelineInputSchema)
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const ideaConditions = await resolveIdeaRepoConditions(
        ctx.db,
        input.repoId,
        userId,
      );
      const taskConditions = await resolveTaskRepoConditions(
        ctx.db,
        input.repoId,
        userId,
      );

      if (!ideaConditions && !taskConditions) return emptyTimeline;

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - input.days);

      // Ideas timeline
      const ideaTimeline = ideaConditions
        ? await ctx.db
            .select({
              date: sql<string>`date_trunc('day', ${ideas.createdAt})::date::text`,
              status: ideas.status,
              count: sql<number>`count(*)::int`,
            })
            .from(ideas)
            .where(and(...ideaConditions, gte(ideas.createdAt, cutoff)))
            .groupBy(
              sql`date_trunc('day', ${ideas.createdAt})::date`,
              ideas.status,
            )
            .orderBy(sql`date_trunc('day', ${ideas.createdAt})::date`)
        : [];

      // Epics timeline (isEpic = true)
      const epicTimeline = taskConditions
        ? await ctx.db
            .select({
              date: sql<string>`date_trunc('day', ${tasks.createdAt})::date::text`,
              status: tasks.status,
              count: sql<number>`count(*)::int`,
            })
            .from(tasks)
            .where(and(...taskConditions, gte(tasks.createdAt, cutoff), eq(tasks.isEpic, true)))
            .groupBy(
              sql`date_trunc('day', ${tasks.createdAt})::date`,
              tasks.status,
            )
            .orderBy(sql`date_trunc('day', ${tasks.createdAt})::date`)
        : [];

      // Tasks timeline (isEpic = false)
      const taskTimeline = taskConditions
        ? await ctx.db
            .select({
              date: sql<string>`date_trunc('day', ${tasks.createdAt})::date::text`,
              status: tasks.status,
              count: sql<number>`count(*)::int`,
            })
            .from(tasks)
            .where(and(...taskConditions, gte(tasks.createdAt, cutoff), eq(tasks.isEpic, false)))
            .groupBy(
              sql`date_trunc('day', ${tasks.createdAt})::date`,
              tasks.status,
            )
            .orderBy(sql`date_trunc('day', ${tasks.createdAt})::date`)
        : [];

      return {
        ideas: ideaTimeline,
        epics: epicTimeline,
        tasks: taskTimeline,
      };
    }),
});
