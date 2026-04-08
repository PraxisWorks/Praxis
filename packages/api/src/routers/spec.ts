import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { tracked, TRPCError } from "@trpc/server";
import {
  CreateSpecSchema,
  syncChannel,
  type SyncEvent,
  type Spec,
} from "@praxis2/shared";
import { router, protectedProcedure } from "../trpc.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { specs, repos } from "../db/schema.js";
import { iterateEvents } from "../lib/iterateEvents.js";
import { requireDbUser } from "../lib/requireDbUser.js";
import { requireAccessibleRepo } from "../lib/requireAccessibleRepo.js";
import { getUserOrgIds } from "../lib/orgSyncFilter.js";

let eventId = 0;

export const specRouter = router({
  // Get the spec for a repo (returns null if no spec exists yet)
  getByRepo: requirePermission("spec:read")
    .input(z.object({ repoId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Verify user has access to this repo via org membership
      await requireAccessibleRepo(ctx.db, input.repoId, userId);

      const [spec] = await ctx.db
        .select()
        .from(specs)
        .where(eq(specs.repoId, input.repoId))
        .limit(1);

      return spec ?? null;
    }),

  // Create or update the spec for a repo
  upsert: protectedProcedure
    .input(CreateSpecSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Verify user has access to this repo via org membership
      await requireAccessibleRepo(ctx.db, input.repoId, userId);

      // Check if spec already exists for this repo
      const [existing] = await ctx.db
        .select()
        .from(specs)
        .where(eq(specs.repoId, input.repoId))
        .limit(1);

      let spec;
      let action: "created" | "updated";

      if (existing) {
        // Update existing spec
        const updateData: Record<string, unknown> = { updatedAt: new Date() };
        if (input.title) updateData.title = input.title;
        if (input.content) updateData.content = input.content;

        const [updated] = await ctx.db
          .update(specs)
          .set(updateData)
          .where(eq(specs.id, existing.id))
          .returning();
        spec = updated;
        action = "updated";
      } else {
        // Create new spec
        const [created] = await ctx.db
          .insert(specs)
          .values(input)
          .returning();
        spec = created;
        action = "created";
      }

      await ctx.pubsub.publish(syncChannel("spec"), {
        action,
        data: spec,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof spec>);

      return spec;
    }),

  // Real-time sync subscription (filtered by org membership via repo)
  onSync: protectedProcedure.subscription(async function* ({ ctx, signal }) {
    const userId = requireDbUser(ctx);

    // Load repo IDs from user's orgs for filtering
    const userOrgIds = await getUserOrgIds(ctx.db, userId);
    const orgRepos = userOrgIds.size > 0
      ? await ctx.db
          .select({ id: repos.id })
          .from(repos)
          .where(inArray(repos.orgId, [...userOrgIds]))
      : [];
    const repoIds = new Set(orgRepos.map((r: { id: string }) => r.id));

    for await (const event of iterateEvents<SyncEvent<Spec>>(
      ctx.pubsub,
      syncChannel("spec"),
      signal!,
    )) {
      // Filter: only yield events for specs belonging to user's org repos
      const data = event.data as Record<string, unknown>;
      if (data.repoId && !repoIds.has(data.repoId as string)) continue;
      yield tracked(String(++eventId), event);
    }
  }),
});
