import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgPubSub, syncChannel } from "@praxis2/shared";
import { tasks, ideas } from "@praxis2/api/schema";
import { propagateInProgressUp } from "@praxis2/api/lib/propagateTaskStatus";
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

export async function taskStart(args: string[]): Promise<void> {
  const taskId = args[0];

  if (!taskId) {
    console.error("Usage: px task start <taskId>");
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
        status: "in_progress",
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

    // Propagate in_progress status up to parent tasks and idea
    const task = rows[0];
    const logger = createCliLogger();
    try {
      if (task.parentId) {
        await propagateInProgressUp(db, pubsub, task.parentId, task.ideaId, logger);
      } else if (task.ideaId) {
        // Top-level task: directly propagate to idea
        const [idea] = await db
          .select()
          .from(ideas)
          .where(eq(ideas.id, task.ideaId))
          .limit(1);
        if (idea && idea.status !== "in_progress" && idea.status !== "complete" && idea.status !== "dismissed" && idea.status !== "archived") {
          await db
            .update(ideas)
            .set({ status: "in_progress", updatedAt: new Date() })
            .where(eq(ideas.id, task.ideaId));
          await pubsub.publish(syncChannel("idea"), {
            action: "updated",
            data: { id: task.ideaId, status: "in_progress" },
            timestamp: Date.now(),
          });
        }
      }
    } catch (err) {
      console.warn(`Warning: propagation failed for task ${taskId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    console.log(`OK: task ${taskId} \u2192 in_progress`);
  } finally {
    await pubsub.close();
    await sql.end();
  }
}
