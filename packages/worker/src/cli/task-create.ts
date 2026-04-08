import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgPubSub, syncChannel } from "@praxis2/shared";
import { tasks, rigs } from "@praxis2/api/schema";
import { randomBytes } from "node:crypto";
import { requiredEnv, createCliSql } from "./cli-db.js";

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

export async function taskCreate(args: string[]): Promise<void> {
  const title = parseFlag(args, "--title");
  const description = parseFlag(args, "--description") ?? "";
  const repoId = parseFlag(args, "--repo-id") ?? process.env.PX_REPO_ID;
  const priority = parseFlag(args, "--priority") ?? "medium";
  const isEpic = hasFlag(args, "--is-epic");
  const parentId = parseFlag(args, "--parent-id");

  if (!title) {
    console.error("Usage: px task create --title <title> [--description <desc>] [--repo-id <uuid>] [--priority low|medium|high] [--is-epic] [--parent-id <taskId>] [--auto-epic]");
    process.exit(1);
  }

  if (!repoId) {
    console.error("Error: --repo-id or PX_REPO_ID env var is required");
    process.exit(1);
  }

  const autoEpic = hasFlag(args, "--auto-epic");

  if (autoEpic && (isEpic || parentId)) {
    console.error("Error: --auto-epic cannot be used with --is-epic or --parent-id");
    process.exit(1);
  }

  // Validate priority
  const validPriorities = ["low", "medium", "high"];
  if (!validPriorities.includes(priority)) {
    console.error(`Error: priority must be one of: ${validPriorities.join(", ")}`);
    process.exit(1);
  }

  const databaseUrl = requiredEnv("DATABASE_URL");

  const sql = createCliSql(databaseUrl);
  const db = drizzle(sql);
  const pubsub = new PgPubSub(databaseUrl);

  try {
    // Look up rig to get bdPrefix for generating taskId
    const [rig] = await db
      .select({ bdPrefix: rigs.bdPrefix })
      .from(rigs)
      .where(eq(rigs.id, repoId))
      .limit(1);

    if (!rig) {
      console.error(`Error: repo not found: ${repoId}`);
      process.exit(1);
    }

    if (autoEpic) {
      // Generate epic taskId
      const epicSuffix = randomBytes(3).toString("hex").slice(0, 5);
      const epicTaskId = `PRX-${rig.bdPrefix}-${epicSuffix}`;

      // Insert epic
      const [epic] = await db
        .insert(tasks)
        .values({
          repoId,
          title,
          description,
          status: "draft",
          priority: priority as "low" | "medium" | "high",
          isEpic: true,
          taskId: epicTaskId,
        })
        .returning();

      // Generate child taskId
      const childSuffix = randomBytes(3).toString("hex").slice(0, 5);
      const childTaskId = `PRX-${rig.bdPrefix}-${childSuffix}`;

      // Insert child task under epic
      const [child] = await db
        .insert(tasks)
        .values({
          repoId,
          parentId: epic.id,
          title,
          description,
          status: "draft",
          priority: priority as "low" | "medium" | "high",
          isEpic: false,
          taskId: childTaskId,
        })
        .returning();

      // Publish sync events for both
      await pubsub.publish(syncChannel("task"), {
        action: "created",
        data: { taskId: epic.taskId, id: epic.id },
        timestamp: Date.now(),
      });
      await pubsub.publish(syncChannel("task"), {
        action: "created",
        data: { taskId: child.taskId, id: child.id },
        timestamp: Date.now(),
      });

      console.log(`OK: created epic ${epicTaskId} with task ${childTaskId} — ${title}`);
      return;
    }

    // Generate taskId: PRX-prx-<5 hex chars>
    const suffix = randomBytes(3).toString("hex").slice(0, 5);
    const taskId = `PRX-${rig.bdPrefix}-${suffix}`;

    // Resolve parentId from taskId to UUID if provided
    let parentUuid: string | undefined;
    if (parentId) {
      const [parent] = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.taskId, parentId))
        .limit(1);

      if (!parent) {
        console.error(`Error: parent task not found: ${parentId}`);
        process.exit(1);
      }
      parentUuid = parent.id;
    }

    const [created] = await db
      .insert(tasks)
      .values({
        repoId,
        parentId: parentUuid,
        title,
        description,
        status: "draft",
        priority: priority as "low" | "medium" | "high",
        isEpic,
        taskId,
      })
      .returning();

    await pubsub.publish(syncChannel("task"), {
      action: "created",
      data: { taskId: created.taskId, id: created.id },
      timestamp: Date.now(),
    });

    console.log(`OK: created ${isEpic ? "epic" : "task"} ${taskId} — ${title}`);
  } finally {
    await pubsub.close();
    await sql.end();
  }
}
