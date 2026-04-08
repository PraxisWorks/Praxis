import { readFileSync } from "node:fs";
import { and, eq, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { ProposalSchema, PgPubSub, syncChannel } from "@praxis2/shared";
import type { Proposal } from "@praxis2/shared";
import { plans, ideas, sessionMessages, tasks, taskDependencies, rigs } from "@praxis2/api/schema";
import { requiredEnv, createCliSql } from "./cli-db.js";

/**
 * Generate a short task ID.
 * Format: {prefix}-prx-{5-char random hex}
 */
function generateTaskId(prefix: string): string {
  const hex = Math.random().toString(16).slice(2, 7);
  return `${prefix}-prx-${hex}`;
}

/** Auto-accept a draft plan: create epics, tasks, dependencies, update statuses. */
async function autoAcceptPlan(
  db: ReturnType<typeof drizzle>,
  pubsub: PgPubSub,
  opts: { ideaId: string; repoId: string; proposal: Proposal; planId: string },
): Promise<void> {
  const { ideaId, repoId, proposal, planId } = opts;

  // Load repo to get bdPrefix
  const [repo] = await db.select().from(rigs).where(eq(rigs.id, repoId)).limit(1);
  if (!repo) throw new Error(`Repo ${repoId} not found`);

  // Load idea for parent epic title/description
  const [idea] = await db.select().from(ideas).where(eq(ideas.id, ideaId)).limit(1);
  if (!idea) throw new Error(`Idea ${ideaId} not found`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await db.transaction(async (tx: any) => {
    const keyToId = new Map<string, string>();

    // 0. Parent epic wrapping all plan epics
    const [parentEpic] = await tx
      .insert(tasks)
      .values({
        repoId,
        ideaId,
        title: idea.title,
        description: idea.description,
        isEpic: true,
        status: "draft",
        priority: "medium",
        taskId: generateTaskId(repo.bdPrefix),
      })
      .returning();

    // 1. Sub-epics + their tasks
    for (const epic of proposal.epics) {
      const [epicRow] = await tx
        .insert(tasks)
        .values({
          repoId,
          parentId: parentEpic.id,
          ideaId,
          title: epic.title,
          description: epic.description,
          isEpic: true,
          status: "draft",
          priority: "medium",
          taskId: generateTaskId(repo.bdPrefix),
        })
        .returning();

      keyToId.set(epic.key, epicRow.id);

      for (const task of epic.tasks) {
        const [taskRow] = await tx
          .insert(tasks)
          .values({
            repoId,
            parentId: epicRow.id,
            ideaId,
            title: task.title,
            description: task.description,
            isEpic: false,
            status: "draft",
            priority: task.priority,
            taskId: generateTaskId(repo.bdPrefix),
          })
          .returning();

        keyToId.set(task.key, taskRow.id);
      }
    }

    // 2. Task dependencies
    for (const epic of proposal.epics) {
      for (const task of epic.tasks) {
        for (const depKey of task.dependsOn) {
          const taskUuid = keyToId.get(task.key);
          const depUuid = keyToId.get(depKey);
          if (taskUuid && depUuid) {
            await tx.insert(taskDependencies).values({ taskId: taskUuid, dependsOnId: depUuid });
          }
        }
      }
    }

    // 3. Update plan status to accepted
    await tx
      .update(plans)
      .set({ status: "accepted", updatedAt: new Date() })
      .where(eq(plans.id, planId));

    // 4. Update idea status to planned
    await tx
      .update(ideas)
      .set({ status: "planned", updatedAt: new Date() })
      .where(eq(ideas.id, ideaId));

    return { keyToId };
  });

  // Publish sync events outside the transaction
  await pubsub.publish(syncChannel("plan"), {
    action: "updated",
    data: { id: planId, status: "accepted" },
    timestamp: Date.now(),
  });

  await pubsub.publish(syncChannel("idea"), {
    action: "updated",
    data: { id: ideaId, status: "planned" },
    timestamp: Date.now(),
  });

  await pubsub.publish(syncChannel("task"), {
    action: "created",
    data: { planId, count: result.keyToId.size },
    timestamp: Date.now(),
  });

  console.log(`Auto-accepted plan (${result.keyToId.size} tasks created)`);
}

export async function planCreate(args: string[]): Promise<void> {
  // Parse args: <ideaId> -f <path>
  let ideaId: string | undefined;
  let filePath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-f" && args[i + 1]) {
      filePath = args[++i];
    } else if (!ideaId) {
      ideaId = args[i];
    }
  }

  ideaId ??= process.env.PX_IDEA_ID;

  if (!ideaId) {
    console.error("Usage: px plan create <ideaId> -f <proposal.json>");
    console.error("  ideaId can also be set via PX_IDEA_ID env var");
    process.exit(1);
  }
  if (!filePath) {
    console.error("Missing required flag: -f <proposal.json>");
    process.exit(1);
  }

  const repoId = requiredEnv("PX_REPO_ID");
  const sessionId = requiredEnv("PX_SESSION_ID");
  const databaseUrl = requiredEnv("DATABASE_URL");

  // Read and validate proposal
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (err) {
    console.error(`Failed to read/parse ${filePath}: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  const result = ProposalSchema.safeParse(raw);
  if (!result.success) {
    console.error("Invalid proposal schema:", result.error.format());
    process.exit(1);
  }
  const proposal = result.data;

  // Connect
  const sql = createCliSql(databaseUrl);
  const db = drizzle(sql);
  const pubsub = new PgPubSub(databaseUrl);

  try {
    // Check for existing non-rejected plan (upsert behavior)
    const [existing] = await db
      .select()
      .from(plans)
      .where(and(eq(plans.ideaId, ideaId), ne(plans.status, "rejected")))
      .limit(1);

    let action: "created" | "updated";
    let planId: string;

    if (existing) {
      // Update existing plan's proposal
      await db
        .update(plans)
        .set({ proposal, updatedAt: new Date() })
        .where(eq(plans.id, existing.id));
      planId = existing.id;
      action = "updated";
    } else {
      // Insert new plan as draft
      const [inserted] = await db.insert(plans).values({
        ideaId,
        repoId,
        sessionId,
        proposal,
        status: "draft" as const,
      }).returning();
      planId = inserted.id;
      action = "created";
    }

    // Update idea status
    await db
      .update(ideas)
      .set({ status: "planning" as const, updatedAt: new Date() })
      .where(eq(ideas.id, ideaId));

    // Publish sync event with correct action
    await pubsub.publish(syncChannel("plan"), {
      action,
      data: { ideaId, repoId },
      timestamp: Date.now(),
    });

    // Insert follow-up session message
    const taskCount = proposal.epics.reduce((sum, e) => sum + e.tasks.length, 0);
    const verb = action === "created" ? "created" : "updated";
    const msg = `Plan ${verb}: ${proposal.epics.length} epic${proposal.epics.length !== 1 ? "s" : ""}, ${taskCount} task${taskCount !== 1 ? "s" : ""}. Review it on the idea page.`;

    await db.insert(sessionMessages).values({
      sessionId,
      role: "assistant" as const,
      content: msg,
      workerName: process.env.WORKER_NAME ?? null,
    });

    await pubsub.publish(`sync:session:${sessionId}:messages`, {
      action: "created",
      data: { sessionId, role: "assistant", content: msg },
      timestamp: Date.now(),
    });

    console.log(`OK: plan ${verb} (${proposal.epics.length} epics, ${taskCount} tasks)`);

    // Auto-accept if PX_AUTO_ACCEPT is set
    if (process.env.PX_AUTO_ACCEPT === "true") {
      try {
        await autoAcceptPlan(db, pubsub, { ideaId, repoId, proposal, planId });
      } catch (err) {
        // Log error but don't exit non-zero — the draft plan is still valid
        console.error(`Auto-accept failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  } finally {
    await pubsub.close();
    await sql.end();
  }
}
