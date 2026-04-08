import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgPubSub, syncChannel } from "@praxis2/shared";
import { tasks, ideas } from "@praxis2/api/schema";
import { requiredEnv, createCliSql } from "./cli-db.js";

export async function ideaReconcile(_args: string[]): Promise<void> {
  const databaseUrl = requiredEnv("DATABASE_URL");
  const sql = createCliSql(databaseUrl);
  const db = drizzle(sql);
  const pubsub = new PgPubSub(databaseUrl);

  try {
    // 1. Query all ideas in pre-terminal states
    const preTerminalStatuses = ["new", "planning", "planned", "in_progress"] as const;
    const allIdeas = await db
      .select()
      .from(ideas)
      .where(inArray(ideas.status, [...preTerminalStatuses]));

    let fixedCount = 0;
    const fixes: string[] = [];

    for (const idea of allIdeas) {
      // 2. Query all tasks for this idea
      const ideaTasks = await db
        .select({ status: tasks.status, parentId: tasks.parentId })
        .from(tasks)
        .where(eq(tasks.ideaId, idea.id));

      if (ideaTasks.length === 0) continue; // No tasks — nothing to reconcile

      // 3. Compute correct status
      let computedStatus: string = idea.status;

      // Check if ALL top-level tasks are terminal
      const topLevelTasks = ideaTasks.filter((b) => b.parentId === null);
      const allTopLevelTerminal =
        topLevelTasks.length > 0 &&
        topLevelTasks.every(
          (b) => b.status === "complete" || b.status === "archived",
        );

      if (allTopLevelTerminal) {
        computedStatus = "complete";
      } else {
        // Check if ANY task is active
        const hasActiveTask = ideaTasks.some(
          (b) =>
            b.status === "in_progress" ||
            b.status === "complete" ||
            b.status === "archived",
        );
        if (
          hasActiveTask &&
          idea.status !== "in_progress" &&
          idea.status !== "complete"
        ) {
          computedStatus = "in_progress";
        }
      }

      // 4. Compare and fix
      if (computedStatus !== idea.status) {
        await db
          .update(ideas)
          .set({
            status: computedStatus as typeof idea.status,
            updatedAt: new Date(),
          })
          .where(eq(ideas.id, idea.id));

        // 5. Publish sync event
        await pubsub.publish(syncChannel("idea"), {
          action: "updated",
          data: { id: idea.id, status: computedStatus },
          timestamp: Date.now(),
        });

        fixedCount++;
        fixes.push(`  ${idea.title}: ${idea.status} \u2192 ${computedStatus}`);
      }
    }

    // 6. Print summary
    for (const fix of fixes) {
      console.log(fix);
    }
    console.log(`OK: ${allIdeas.length} ideas checked, ${fixedCount} fixed`);
  } finally {
    await pubsub.close();
    await sql.end();
  }
}
