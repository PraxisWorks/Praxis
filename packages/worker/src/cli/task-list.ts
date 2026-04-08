import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { tasks } from "@praxis2/api/schema";
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

export async function taskList(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.parent) {
    console.error("Usage: px task list --parent <epicId>");
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

    const children = await db
      .select({
        taskId: tasks.taskId,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
      })
      .from(tasks)
      .where(eq(tasks.parentId, parent.id));

    if (children.length === 0) {
      console.log("No child tasks found.");
      return;
    }

    // Print header
    console.log(`${"ID".padEnd(16)} ${"Status".padEnd(14)} ${"Priority".padEnd(10)} Title`);
    console.log(`${"─".repeat(16)} ${"─".repeat(14)} ${"─".repeat(10)} ${"─".repeat(30)}`);

    for (const child of children) {
      console.log(
        `${(child.taskId ?? "?").padEnd(16)} ${child.status.padEnd(14)} ${child.priority.padEnd(10)} ${child.title}`,
      );
    }
  } finally {
    await sql.end();
  }
}
