import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgPubSub, syncChannel } from "@praxis2/shared";
import { tasks } from "@praxis2/api/schema";
import { propagateCompleteUp } from "@praxis2/api/lib/propagateTaskStatus";
import type { Logger } from "@praxis2/api/lib/propagateTaskStatus";
import { requiredEnv, createCliSql } from "./cli-db.js";

function createCliLogger(): Logger {
  const verbose = process.env.PX_VERBOSE === "1" || process.env.PX_VERBOSE === "true";
  if (!verbose) {
    const noop: Logger = { info: () => {}, warn: () => {}, error: () => {}, child() { return noop; } };
    return noop;
  }
  return {
    info: (obj, msg) => console.log(`[propagation] ${msg}`, JSON.stringify(obj)),
    warn: (obj, msg) => console.warn(`[propagation] ${msg}`, JSON.stringify(obj)),
    error: (obj, msg) => console.error(`[propagation] ${msg}`, JSON.stringify(obj)),
    child() { return this; },
  };
}

export async function taskComplete(args: string[]): Promise<void> {
  const taskId = args[0];

  if (!taskId) {
    console.error("Usage: px task complete <taskId>");
    process.exit(1);
  }

  const databaseUrl = requiredEnv("DATABASE_URL");

  const sql = createCliSql(databaseUrl);
  const db = drizzle(sql);
  const pubsub = new PgPubSub(databaseUrl);

  try {
    const rows = await db
      .update(tasks)
      .set({
        status: "complete",
        statusChangedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tasks.taskId, taskId))
      .returning();

    if (rows.length === 0) {
      console.error(`Error: task not found: ${taskId}`);
      process.exit(1);
    }

    await pubsub.publish(syncChannel("task"), {
      action: "updated",
      data: { taskId },
      timestamp: Date.now(),
    });

    // Propagate complete status up to parent tasks and idea
    const task = rows[0];
    const logger = createCliLogger();
    try {
      if (task.parentId) {
        await propagateCompleteUp(db, pubsub, task.parentId, task.ideaId, logger);
      } else if (task.ideaId) {
        await propagateCompleteUp(db, pubsub, null, task.ideaId, logger);
      }
    } catch (err) {
      console.warn(`Warning: propagation failed for task ${taskId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    console.log(`OK: task ${taskId} \u2192 complete`);
  } finally {
    await pubsub.close();
    await sql.end();
  }
}
