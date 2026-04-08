import { deployments } from "../db/schema.js";
import { syncChannel, type SyncEvent } from "@praxis2/shared";
import type { PgPubSub } from "../pubsub.js";
import type { getDb } from "../db/index.js";

export function registerDeployment(
  db: ReturnType<typeof getDb>,
  pubsub: PgPubSub,
) {
  return async function (
    service: "api" | "worker" | "web" | "mobile",
    gitSha: string,
    deployedAt: string,
  ): Promise<void> {
    const [deployment] = await db
      .insert(deployments)
      .values({
        service,
        gitSha,
        deployedAt: new Date(deployedAt),
      })
      .onConflictDoUpdate({
        target: deployments.service,
        set: {
          gitSha,
          deployedAt: new Date(deployedAt),
        },
      })
      .returning();

    await pubsub.publish(syncChannel("deployment"), {
      action: "updated",
      data: deployment,
      timestamp: Date.now(),
    } satisfies SyncEvent<typeof deployment>);
  };
}
