import { eq, and, desc } from "drizzle-orm";
import type { DrizzleDb } from "../db.js";
import {
  rigs,
  specs,
  tasks,
  plans,
  sessions,
  sessionMessages,
} from "@praxis2/api/schema";

const CONTEXT_BUDGET = 12_000;

export interface DebugContext {
  systemPrompt: string;
  entityTitle: string;
  entityDescription: string;
}

interface DebugContextParams {
  repoId: string;
  entityType: "task" | "epic";
  entityId: string;
}

/**
 * Builds a rich debug context for a task or epic, gathering:
 * - Repo info
 * - Spec content (if exists)
 * - Entity (task/epic) details
 * - Plan content (if entity has an ideaId)
 * - Prior working session system messages (commits/activity)
 *
 * Truncates the assembled context to fit within ~12k character budget.
 */
export async function buildDebugContext(
  db: DrizzleDb,
  params: DebugContextParams,
): Promise<DebugContext> {
  // 1. Load repo info
  const [repo] = await db
    .select()
    .from(rigs)
    .where(eq(rigs.id, params.repoId))
    .limit(1);

  const repoName = repo?.name ?? "Unknown";

  // 2. Load spec for this repo
  const [spec] = await db
    .select()
    .from(specs)
    .where(eq(specs.repoId, params.repoId))
    .limit(1);

  // 3. Load entity (task/epic)
  const [entity] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, params.entityId))
    .limit(1);

  const entityTitle = entity?.title ?? "Unknown entity";
  const entityDescription = entity?.description ?? "";

  // 4. Load plan content if the task has an ideaId
  let planContent: string | null = null;
  if (entity?.ideaId) {
    const [plan] = await db
      .select()
      .from(plans)
      .where(eq(plans.ideaId, entity.ideaId))
      .limit(1);

    if (plan?.proposal) {
      planContent = JSON.stringify(plan.proposal, null, 2);
    }
  }

  // 5. Load prior working session messages (system messages with commit/activity info)
  let priorMessages: string[] = [];
  if (entity) {
    // Find working sessions for this entity
    const workingSessions = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.entityId, params.entityId),
          eq(sessions.type, "working"),
        ),
      )
      .orderBy(desc(sessions.createdAt))
      .limit(3);

    for (const ws of workingSessions) {
      const msgs = await db
        .select({ content: sessionMessages.content })
        .from(sessionMessages)
        .where(
          and(
            eq(sessionMessages.sessionId, ws.id),
            eq(sessionMessages.role, "system"),
          ),
        )
        .orderBy(desc(sessionMessages.createdAt))
        .limit(10);

      for (const m of msgs) {
        priorMessages.push(m.content);
      }
    }
  }

  // Assemble the system prompt
  const sections: string[] = [];

  sections.push(`You are a debugging assistant for Praxis. You help troubleshoot issues in the context of a specific piece of work.`);
  sections.push(``);
  sections.push(`Repo: ${repoName}`);

  if (spec?.content) {
    sections.push(``);
    sections.push(`Project Spec:`);
    sections.push(spec.content);
  }

  sections.push(``);
  sections.push(`${params.entityType === "epic" ? "Epic" : "Task"}: ${entityTitle}`);
  if (entityDescription) {
    sections.push(`Description: ${entityDescription}`);
  }

  if (planContent) {
    sections.push(``);
    sections.push(`Implementation Plan:`);
    sections.push(planContent);
  }

  if (priorMessages.length > 0) {
    sections.push(``);
    sections.push(`Prior working session activity:`);
    for (const msg of priorMessages) {
      sections.push(`- ${msg}`);
    }
  }

  sections.push(``);
  sections.push(`Help the user diagnose the problem. Ask clarifying questions.`);
  sections.push(`Suggest specific code changes or investigation steps.`);
  sections.push(`If you can identify the root cause, explain it clearly and propose a fix.`);

  let systemPrompt = sections.join("\n");

  // Truncate to budget
  if (systemPrompt.length > CONTEXT_BUDGET) {
    systemPrompt = systemPrompt.slice(0, CONTEXT_BUDGET - 3) + "...";
  }

  return {
    systemPrompt,
    entityTitle,
    entityDescription,
  };
}
