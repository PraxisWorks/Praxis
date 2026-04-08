import { tracked } from "@trpc/server";
import {
  RegisterDeploymentSchema,
  syncChannel,
  type SyncEvent,
  type Deployment,
} from "@praxis2/shared";
import { router, publicProcedure } from "../trpc.js";
import { deployments } from "../db/schema.js";
import { iterateEvents } from "../lib/iterateEvents.js";

let eventId = 0;

export const deploymentRouter = router({
  // Public query — deployment info is non-sensitive
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(deployments).orderBy(deployments.deployedAt);
  }),

  // Real-time subscription — identical pattern to user.onSync
  onSync: publicProcedure.subscription(async function* ({ ctx, signal }) {
    for await (const event of iterateEvents<SyncEvent<Deployment>>(
      ctx.pubsub,
      syncChannel("deployment"),
      signal!,
    )) {
      yield tracked(String(++eventId), event);
    }
  }),

  // Public mutation — services call this to register themselves (no auth needed, server-to-server)
  register: publicProcedure
    .input(RegisterDeploymentSchema)
    .mutation(async ({ ctx, input }) => {
      // Upsert: insert or update on service conflict
      const [deployment] = await ctx.db
        .insert(deployments)
        .values({
          service: input.service,
          gitSha: input.gitSha,
          deployedAt: input.deployedAt,
        })
        .onConflictDoUpdate({
          target: deployments.service,
          set: {
            gitSha: input.gitSha,
            deployedAt: input.deployedAt,
          },
        })
        .returning();

      await ctx.pubsub.publish(syncChannel("deployment"), {
        action: "updated",
        data: deployment,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof deployment>);

      return deployment;
    }),
});
