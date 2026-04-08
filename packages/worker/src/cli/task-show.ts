import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { tasks, taskDependencies } from "@praxis2/api/schema";
import { requiredEnv, createCliSql } from "./cli-db.js";

export async function taskShow(args: string[]): Promise<void> {
  const taskId = args[0];

  if (!taskId) {
    console.error("Usage: px task show <taskId>");
    process.exit(1);
  }

  const databaseUrl = requiredEnv("DATABASE_URL");

  const sql = createCliSql(databaseUrl);
  const db = drizzle(sql);

  try {
    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.taskId, taskId))
      .limit(1);

    if (!task) {
      console.error(`Error: task not found: ${taskId}`);
      process.exit(1);
    }

    // Load dependencies (what this task depends on)
    const deps = await db
      .select()
      .from(taskDependencies)
      .where(eq(taskDependencies.taskId, task.id));

    // Resolve dependency taskIds
    const depTaskIds: string[] = [];
    for (const dep of deps) {
      const [depTask] = await db
        .select({ taskId: tasks.taskId })
        .from(tasks)
        .where(eq(tasks.id, dep.dependsOnId))
        .limit(1);
      if (depTask?.taskId) depTaskIds.push(depTask.taskId);
    }

    // Find parent taskId
    let parentTaskId: string | null = null;
    if (task.parentId) {
      const [parent] = await db
        .select({ taskId: tasks.taskId })
        .from(tasks)
        .where(eq(tasks.id, task.parentId))
        .limit(1);
      parentTaskId = parent?.taskId ?? null;
    }

    console.log(`ID:           ${task.taskId}`);
    console.log(`Title:        ${task.title}`);
    console.log(`Status:       ${task.status}`);
    console.log(`Priority:     ${task.priority}`);
    console.log(`Type:         ${task.isEpic ? "epic" : "task"}`);
    if (parentTaskId) console.log(`Parent:       ${parentTaskId}`);
    if (depTaskIds.length > 0) console.log(`Dependencies: ${depTaskIds.join(", ")}`);
    if (task.description) console.log(`Description:  ${task.description}`);
  } finally {
    await sql.end();
  }
}
