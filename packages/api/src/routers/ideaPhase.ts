import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { tracked, TRPCError } from "@trpc/server";
import { syncChannel, type SyncEvent, type IdeaPhase } from "@praxis2/shared";
import { router, protectedProcedure } from "../trpc.js";
import { ideas, ideaPhases } from "../db/schema.js";
import { iterateEvents } from "../lib/iterateEvents.js";
import { requireDbUser } from "../lib/requireDbUser.js";

let eventId = 0;

export const ideaPhaseRouter = router({
  list: protectedProcedure
    .input(z.object({ ideaId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Verify idea exists and belongs to user
      const [idea] = await ctx.db
        .select()
        .from(ideas)
        .where(and(eq(ideas.id, input.ideaId), eq(ideas.userId, userId)))
        .limit(1);

      if (!idea) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Idea not found" });
      }

      return ctx.db
        .select()
        .from(ideaPhases)
        .where(eq(ideaPhases.ideaId, input.ideaId))
        .orderBy(ideaPhases.phaseNumber);
    }),

  onSync: protectedProcedure.subscription(async function* ({ ctx, signal }) {
    for await (const event of iterateEvents<SyncEvent<IdeaPhase>>(
      ctx.pubsub,
      syncChannel("ideaPhase"),
      signal!,
    )) {
      yield tracked(String(++eventId), event);
    }
  }),
});
