import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { tasks, taskDependencies } from "@praxis2/api/schema";
import { requiredEnv, createCliSql } from "./cli-db.js";

function parseFlags(args: string[]): { parent?: string } {
  const flags: { parent?: string } = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--parent" && args[i + 1]) {
      flags.parent = args[++i];
    }
  }
  return flags;
}

export async function taskReady(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.parent) {
    console.error("Usage: px task ready --parent <epicId>");
    process.exit(1);
  }

  const databaseUrl = requiredEnv("DATABASE_URL");

  const sql = createCliSql(databaseUrl);
  const db = drizzle(sql);

  try {
    // Resolve parent taskId → UUID
    const [parent] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.taskId, flags.parent))
      .limit(1);

    if (!parent) {
      console.error(`Error: parent not found: ${flags.parent}`);
      process.exit(1);
    }

    // Find children with actionable status (draft or approved)
    const children = await db
      .select()
      .from(tasks)
      .where(eq(tasks.parentId, parent.id));

    const actionable = children.filter(
      (b) => b.status === "draft" || b.status === "approved",
    );

    if (actionable.length === 0) {
      console.log("No ready tasks found.");
      return;
    }

    // For each actionable task, check if all dependencies are resolved
    const ready: typeof actionable = [];

    for (const task of actionable) {
      const deps = await db
        .select({ dependsOnId: taskDependencies.dependsOnId })
        .from(taskDependencies)
        .where(eq(taskDependencies.taskId, task.id));

      if (deps.length === 0) {
        ready.push(task);
        continue;
      }

      // Check if ALL dependencies are complete or archived
      const depIds = deps.map((d) => d.dependsOnId);
      const blockers = await db
        .select({ id: tasks.id, status: tasks.status })
        .from(tasks)
        .where(inArray(tasks.id, depIds));

      const allResolved = blockers.every(
        (b) => b.status === "complete" || b.status === "archived",
      );

      if (allResolved) {
        ready.push(task);
      }
    }

    if (ready.length === 0) {
      console.log("No ready tasks found (all have unresolved dependencies).");
      return;
    }

    // Print header
    console.log(`${"ID".padEnd(16)} ${"Status".padEnd(14)} ${"Priority".padEnd(10)} Title`);
    console.log(`${"─".repeat(16)} ${"─".repeat(14)} ${"─".repeat(10)} ${"─".repeat(30)}`);

    for (const task of ready) {
      console.log(
        `${(task.taskId ?? "?").padEnd(16)} ${task.status.padEnd(14)} ${task.priority.padEnd(10)} ${task.title}`,
      );
    }
  } finally {
    await sql.end();
  }
}
