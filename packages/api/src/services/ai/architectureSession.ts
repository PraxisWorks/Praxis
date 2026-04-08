// TODO: Replace stub with real Anthropic API call in Phase 5 Worker

import { getDb, getConnectionString } from "../../db/index.js";
import { PgPubSub } from "../../pubsub.js";
import { sessionMessages, sessions, specs, ideas, repos, plans } from "../../db/schema.js";
import { eq, asc, and, ne } from "drizzle-orm";
import { syncChannel, type SyncEvent, ProposalSchema } from "@praxis2/shared";
import { getLogger } from "../../lib/logger.js";
import {
  ARCHITECTURE_PHASES,
  ARCHITECTURE_OPENING_MESSAGE,
  ADVANCEMENT_SIGNALS,
  type ArchitecturePhase,
  getSystemPrompt,
} from "../../lib/architecturePrompts.js";

type MessageRow = {
  role: string;
  content: string;
};

// Share/pool PgPubSub instances instead of creating one per writeMessage call.
let sharedPubsub: InstanceType<typeof PgPubSub> | null = null;

function getSharedPubsub(): InstanceType<typeof PgPubSub> {
  if (!sharedPubsub) {
    sharedPubsub = new PgPubSub(getConnectionString());
  }
  return sharedPubsub;
}

/**
 * Write a message to the session_messages table and publish a sync event.
 */
async function writeMessage(
  sessionId: string,
  role: "system" | "assistant",
  content: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  const pubsub = getSharedPubsub();

  const [message] = await db
    .insert(sessionMessages)
    .values({ sessionId, role, content })
    .returning();

  const messagesChannel = `sync:session:${sessionId}:messages`;
  await pubsub.publish(messagesChannel, {
    action: "created",
    data: message,
    timestamp: Date.now(),
  } satisfies SyncEvent<typeof message>);

  // Update session's updatedAt
  await db
    .update(sessions)
    .set({ updatedAt: new Date() })
    .where(eq(sessions.id, sessionId));
}

/**
 * Handle the start of an architecture session.
 * Writes the system prompt and the first assistant message for Phase 1
 * (Scope & Requirements). The session stays "active" and waits for user input.
 *
 * This is the entry point called from the session.start job handler.
 */
export async function handleArchitectureSessionStart(
  sessionId: string,
): Promise<void> {
  const logger = getLogger();
  logger.info({ sessionId }, "Starting architecture session");

  // Write system prompt (not shown in UI but included in AI context)
  const db = getDb();
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!session) {
    logger.error({ sessionId }, "Session not found for architecture start");
    return;
  }

  // Load idea for context in the system prompt
  let ideaTitle = "Unknown";
  let ideaDescription = "";
  if (session.entityId) {
    const [idea] = await db
      .select()
      .from(ideas)
      .where(eq(ideas.id, session.entityId))
      .limit(1);
    if (idea) {
      ideaTitle = idea.title;
      ideaDescription = idea.description;
    }
  }

  // Load repo name
  let repoName = "Unknown";
  const [repo] = await db
    .select()
    .from(repos)
    .where(eq(repos.id, session.repoId))
    .limit(1);
  if (repo) {
    repoName = repo.name;
  }

  // Load spec if available
  let specContent: string | null = null;
  const [spec] = await db
    .select()
    .from(specs)
    .where(eq(specs.repoId, session.repoId))
    .limit(1);
  if (spec) {
    specContent = spec.content;
  }

  const systemPrompt = getSystemPrompt("scope_and_requirements", {
    specContent,
    ideaTitle,
    ideaDescription,
    repoName,
  });

  // Write system prompt as a system message (for AI context, hidden from UI)
  await writeMessage(sessionId, "system", systemPrompt);

  // Write phase marker
  await writeMessage(
    sessionId,
    "system",
    "--- Phase: SCOPE AND REQUIREMENTS ---",
  );

  // Write opening assistant message
  await writeMessage(sessionId, "assistant", ARCHITECTURE_OPENING_MESSAGE);

  logger.info(
    { sessionId },
    "Architecture session started with opening message, waiting for user input",
  );
}

/**
 * Handle a user message in an architecture session.
 * Loads conversation history, determines the current phase, generates
 * a stub response, and writes it to DB.
 *
 * STUB: Returns a formatted acknowledgment instead of calling Anthropic.
 * TODO: Replace generateStubResponse with real Anthropic API call in Phase 5.
 */
export async function handleArchitectureSessionMessage(
  sessionId: string,
  userContent: string,
): Promise<void> {
  const logger = getLogger();
  const db = getDb();

  // Load conversation history
  const messages = await db
    .select({ role: sessionMessages.role, content: sessionMessages.content })
    .from(sessionMessages)
    .where(eq(sessionMessages.sessionId, sessionId))
    .orderBy(asc(sessionMessages.createdAt));

  logger.info(
    { sessionId, messageCount: messages.length },
    "Processing architecture session message",
  );

  // Determine current phase from conversation history
  const currentPhase = determineCurrentPhase(messages);

  // Generate response (stub — no real AI call)
  const response = generateStubResponse(messages, userContent, currentPhase);

  // Detect if the stub response signals a phase advance
  const nextPhase = detectPhaseAdvancement(response, currentPhase);

  if (nextPhase && nextPhase !== currentPhase) {
    // Insert phase transition marker
    const phaseLabel = nextPhase.replace(/_/g, " ").toUpperCase();
    await writeMessage(sessionId, "system", `--- Phase: ${phaseLabel} ---`);
  }

  // Check if the response contains a proposal JSON
  if (looksLikeProposalJson(response)) {
    const planCreated = await tryCreatePlanFromProposal(
      sessionId,
      response,
      logger,
    );
    if (planCreated) {
      // Write a friendly message instead of raw JSON
      const { epicCount, taskCount } = planCreated;
      await writeMessage(
        sessionId,
        "assistant",
        `I've prepared a plan proposal with ${epicCount} epic${epicCount !== 1 ? "s" : ""} and ${taskCount} task${taskCount !== 1 ? "s" : ""}. You can review, edit, and approve it on the idea page.`,
      );
    } else {
      // Fallback: write the raw response if plan creation failed
      await writeMessage(sessionId, "assistant", response);
    }
  } else {
    // Write assistant response normally
    await writeMessage(sessionId, "assistant", response);
  }

  logger.info(
    { sessionId, phase: nextPhase ?? currentPhase },
    "Architecture session message processed",
  );
}

/**
 * Determine the current architecture phase from conversation history.
 * Looks at the last system "--- Phase: ..." marker message.
 */
export function determineCurrentPhase(
  messages: MessageRow[],
): ArchitecturePhase {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "system" && msg.content.startsWith("--- Phase:")) {
      const phaseText = msg.content
        .replace(/--- Phase:\s*/i, "")
        .replace(/\s*---/, "")
        .trim()
        .toLowerCase();
      const match = ARCHITECTURE_PHASES.find(
        (p) => p.replace(/_/g, " ") === phaseText,
      );
      if (match) return match;
    }
  }
  return "scope_and_requirements";
}

/**
 * Detect if the AI response signals advancing to the next phase.
 * Returns the next phase if advancement is detected, or null if staying.
 */
export function detectPhaseAdvancement(
  aiResponse: string,
  currentPhase: ArchitecturePhase,
): ArchitecturePhase | null {
  const phaseIndex = ARCHITECTURE_PHASES.indexOf(currentPhase);
  if (phaseIndex < ARCHITECTURE_PHASES.length - 1) {
    const nextPhase = ARCHITECTURE_PHASES[phaseIndex + 1];
    if (
      ADVANCEMENT_SIGNALS.some((s) =>
        aiResponse.toLowerCase().includes(s.toLowerCase()),
      )
    ) {
      return nextPhase;
    }
  }
  return null;
}

/**
 * Check if an AI response looks like it contains a proposal JSON object.
 */
export function looksLikeProposalJson(response: string): boolean {
  return /\{[\s\S]*"epics"[\s\S]*\}/.test(response);
}

/**
 * Stub AI response generator for architecture sessions.
 *
 * Walks through the 5 architecture phases with canned responses.
 * Each phase acknowledges user input and either asks clarifying questions
 * or advances to the next phase based on how many exchanges have occurred.
 *
 * TODO: Replace with real Anthropic API call in Phase 5 Worker.
 */
export function generateStubResponse(
  history: MessageRow[],
  userContent: string,
  currentPhase: ArchitecturePhase,
): string {
  // Count user messages within the current phase to decide when to advance
  const userMessagesInPhase = countUserMessagesInCurrentPhase(history);

  switch (currentPhase) {
    case "scope_and_requirements":
      if (userMessagesInPhase >= 1) {
        return `Thanks for clarifying the scope. Here's what I understand:

**In scope:** ${userContent}
**Out of scope:** To be refined in later phases.

This looks like a solid foundation. Ready to move to Architecture phase.`;
      }
      return `Thanks for sharing. Let me ask a follow-up:

What are the most critical user-facing requirements? Are there any non-functional requirements (performance, security) we should account for?`;

    case "architecture":
      if (userMessagesInPhase >= 1) {
        return `Good, the architecture looks solid. Here's the summary:

**Services/Modules:** Based on our discussion
**Data Model:** To be detailed in the breakdown
**Key Decisions:** Aligned with project constraints

Ready to move to Epic Breakdown phase.`;
      }
      return `Based on the scope we defined, here's a proposed technical approach:

1. **API Layer** — tRPC endpoints for the core operations
2. **Data Layer** — Database schema changes to support the feature
3. **Service Layer** — Business logic and validation

Does this structure work for you, or would you adjust anything?`;

    case "epic_breakdown":
      if (userMessagesInPhase >= 1) {
        return `Great, I'll use that grouping. Here's the refined epic breakdown:

**Epic 1: Foundation** — Core data model and API setup
**Epic 2: Implementation** — Business logic and feature code
**Epic 3: Polish** — Testing, error handling, and documentation

Ready to move to Task Breakdown phase.`;
      }
      return `I'd suggest organizing the work into these epics:

1. **Foundation** — Schema, migrations, and base API
2. **Core Feature** — Main implementation and business logic
3. **Quality** — Tests, validation, and edge cases

Does this grouping make sense? Would you merge or split any of these?`;

    case "task_breakdown":
      if (userMessagesInPhase >= 1) {
        return `Perfect. The task breakdown is confirmed. Ready to generate the proposal.`;
      }
      return `Here's the task breakdown for each epic:

**Epic 1: Foundation**
- Task 1.1: Database schema changes (high priority)
- Task 1.2: API endpoint scaffolding (high priority, depends on 1.1)

**Epic 2: Core Feature**
- Task 2.1: Service implementation (medium priority, depends on 1.2)
- Task 2.2: Integration wiring (medium priority, depends on 2.1)

**Epic 3: Quality**
- Task 3.1: Unit tests (low priority, depends on 2.1)
- Task 3.2: Integration tests (low priority, depends on 2.2)

Does this breakdown look right? Any tasks to add, remove, or reprioritize?`;

    case "review":
      return `{"epics":[{"key":"e1","title":"Foundation","description":"Core data model and API setup","tasks":[{"key":"b1","title":"Database schema changes","description":"Add required tables and columns","priority":"high","dependsOn":[]},{"key":"b2","title":"API endpoint scaffolding","description":"Create tRPC endpoints","priority":"high","dependsOn":["b1"]}]},{"key":"e2","title":"Core Feature","description":"Main implementation and business logic","tasks":[{"key":"b3","title":"Service implementation","description":"Business logic and validation","priority":"medium","dependsOn":["b2"]},{"key":"b4","title":"Integration wiring","description":"Connect services to API layer","priority":"medium","dependsOn":["b3"]}]},{"key":"e3","title":"Quality","description":"Testing and documentation","tasks":[{"key":"b5","title":"Unit tests","description":"Test core business logic","priority":"low","dependsOn":["b3"]},{"key":"b6","title":"Integration tests","description":"End-to-end API tests","priority":"low","dependsOn":["b4"]}]}]}`;
  }
}

/**
 * Count user messages that occurred after the last phase marker.
 * This helps determine when to advance within a phase.
 */
function countUserMessagesInCurrentPhase(history: MessageRow[]): number {
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === "system" && msg.content.startsWith("--- Phase:")) {
      break;
    }
    if (msg.role === "user") {
      count++;
    }
  }
  return count;
}

/**
 * Attempt to parse a proposal JSON from an AI response and create a draft plan.
 * Returns epic/task counts on success, or null if parsing or creation fails.
 */
async function tryCreatePlanFromProposal(
  sessionId: string,
  response: string,
  logger: ReturnType<typeof getLogger>,
): Promise<{ epicCount: number; taskCount: number } | null> {
  const db = getDb();

  try {
    // Extract JSON from the response (may be embedded in other text)
    const jsonMatch = response.match(/\{[\s\S]*"epics"[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    const proposal = ProposalSchema.parse(parsed);

    // Load session to get entityId (ideaId) and repoId
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (!session?.entityId || !session.repoId) {
      logger.warn({ sessionId }, "Session missing entityId or repoId for plan creation");
      return null;
    }

    // Check no existing non-rejected plan for this idea
    const [existing] = await db
      .select()
      .from(plans)
      .where(
        and(eq(plans.ideaId, session.entityId), ne(plans.status, "rejected")),
      )
      .limit(1);

    if (existing) {
      logger.info(
        { sessionId, planId: existing.id },
        "Plan already exists for this idea, skipping creation",
      );
      return null;
    }

    // Create draft plan
    const [plan] = await db
      .insert(plans)
      .values({
        ideaId: session.entityId,
        repoId: session.repoId,
        sessionId,
        proposal,
        status: "draft",
      })
      .returning();

    // Publish sync event
    const pubsub = getSharedPubsub();
    await pubsub.publish(syncChannel("plan"), {
      action: "created",
      data: plan,
      timestamp: Date.now(),
    } satisfies SyncEvent<typeof plan>);

    const taskCount = proposal.epics.reduce((sum, e) => sum + e.tasks.length, 0);

    logger.info(
      { sessionId, planId: plan.id, epicCount: proposal.epics.length, taskCount },
      "Draft plan created from architecture session proposal",
    );

    return { epicCount: proposal.epics.length, taskCount };
  } catch (err) {
    logger.error(
      { sessionId, error: err instanceof Error ? err.message : String(err) },
      "Failed to create plan from proposal JSON",
    );
    return null;
  }
}
