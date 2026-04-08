import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgPubSub, syncChannel } from "@praxis2/shared";
import { tasks, rigs, notifications, sessionMessages } from "@praxis2/api/schema";
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

export async function epicComplete(args: string[]): Promise<void> {
  const epicId = args[0];

  if (!epicId) {
    console.error("Usage: px epic complete <epicId>");
    process.exit(1);
  }

  const databaseUrl = requiredEnv("DATABASE_URL");

  const sql = createCliSql(databaseUrl);
  const db = drizzle(sql);
  const pubsub = new PgPubSub(databaseUrl);

  try {
    // 1. Look up the epic by taskId where isEpic=true
    const [epicRow] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.taskId, epicId), eq(tasks.isEpic, true)));

    if (!epicRow) {
      console.error(`Error: epic not found: ${epicId}`);
      process.exit(1);
    }

    // 2. Query all child tasks and verify all are complete
    const children = await db
      .select()
      .from(tasks)
      .where(eq(tasks.parentId, epicRow.id));

    const incomplete = children.filter((c) => c.status !== "complete");

    if (incomplete.length > 0) {
      console.error(`Error: ${incomplete.length} child task(s) not complete:`);
      for (const child of incomplete) {
        console.error(`  - ${child.taskId ?? child.id}: ${child.status}`);
      }
      process.exit(1);
    }

    // 3. Set epic status to complete
    await db
      .update(tasks)
      .set({
        status: "complete",
        statusChangedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, epicRow.id));

    // 3b. Propagate complete status up to parent tasks and idea
    const logger = createCliLogger();
    try {
      if (epicRow.parentId) {
        await propagateCompleteUp(db, pubsub, epicRow.parentId, epicRow.ideaId, logger);
      } else if (epicRow.ideaId) {
        await propagateCompleteUp(db, pubsub, null, epicRow.ideaId, logger);
      }
    } catch (err) {
      console.warn(`Warning: propagation failed for epic ${epicId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 4. Load repo for notification context
    const [repoRow] = await db
      .select()
      .from(rigs)
      .where(eq(rigs.id, epicRow.repoId));

    // 5. Insert notification
    const title = `Epic completed: ${epicRow.title}`;
    const body = `All tasks in "${epicRow.title}" (${repoRow.name}) are complete.`;
    const actionUrl = `/board?task=${epicId}`;

    await db.insert(notifications).values({
      userId: repoRow.userId,
      title,
      body,
      actionUrl,
      repoId: epicRow.repoId,
    });

    // 6. Publish notification sync event
    await pubsub.publish(syncChannel("notification"), {
      action: "created",
      data: { userId: repoRow.userId, title, body, actionUrl, repoId: epicRow.repoId },
      timestamp: Date.now(),
    });

    // 7. Publish task sync event
    await pubsub.publish(syncChannel("task"), {
      action: "updated",
      data: { taskId: epicId },
      timestamp: Date.now(),
    });

    // 8. Enqueue session.message for auto-merge if running inside a session
    const sessionId = process.env.PX_SESSION_ID;
    if (sessionId) {
      const mergeInstruction = [
        "All tasks are complete. Finalize the epic:",
        "",
        "1. Push the session branch: `git push -u origin HEAD`",
        '2. Create a PR: `gh pr create --base main --fill`',
        "3. Wait for CI checks: `gh pr checks --watch`",
        "4. If checks pass, merge: `gh pr merge --merge --delete-branch`",
        "5. If checks fail, report the failure. Do NOT force-merge.",
        "",
        "Do NOT wait for human review or approval. Execute these steps now.",
      ].join("\n");

      // Insert audit trail row
      await db.insert(sessionMessages).values({
        sessionId,
        role: "system",
        content: mergeInstruction,
        workerName: process.env.WORKER_NAME ?? null,
      });

      // Enqueue pg-boss job for the session agent
      await sql`INSERT INTO pgboss.job (name, data, state) VALUES (
        ${"session.message"},
        ${JSON.stringify({ sessionId, content: mergeInstruction })},
        'created'
      )`;

      console.log(`OK: enqueued session.message for session ${sessionId}`);
    }

    console.log(
      `OK: epic ${epicId} \u2192 complete (${children.length} tasks, notification sent)`,
    );
  } finally {
    await pubsub.close();
    await sql.end();
  }
}
