// TODO: Replace stub with real Anthropic API call in Phase 5 Worker

import { getDb, getConnectionString } from "../../db/index.js";
import { PgPubSub } from "../../pubsub.js";
import { sessionMessages, sessions, specs } from "../../db/schema.js";
import { eq, asc } from "drizzle-orm";
import { syncChannel, type SyncEvent } from "@praxis2/shared";
import { getLogger } from "../../lib/logger.js";

const SPEC_SYSTEM_PROMPT = `You are a project specification assistant. Your job is to help the user define their project through a structured conversation.

Guide the user through these phases:
1. **Project Overview** — What is this project? What problem does it solve?
2. **Target Users** — Who will use this? What are their needs?
3. **Constraints** — Timeline, budget, technical constraints, team size
4. **Tech Stack** — Languages, frameworks, infrastructure decisions
5. **Boundaries** — What's in scope vs out of scope for v1?

Ask one question at a time. Be concise. When all phases are covered, summarize the spec in structured Markdown and tell the user the spec is ready.`;

const SPEC_OPENING_MESSAGE = `Let's create a specification for your project. I'll guide you through a few questions to understand what you're building.

**Phase 1: Project Overview**

What is this project? In a sentence or two, describe the problem it solves and who it's for.`;

type MessageRow = {
  role: string;
  content: string;
};

// Share/pool PgPubSub instances instead of creating one per writeMessage call.
// A module-level pubsub is initialized once and reused across all writes.
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
 * Handle the start of a spec session.
 * Writes the system prompt and the first assistant message.
 */
export async function handleSpecSessionStart(
  sessionId: string,
): Promise<void> {
  const logger = getLogger();
  logger.info({ sessionId }, "Starting spec session");

  // Write system prompt (not shown in UI but included in AI context)
  await writeMessage(sessionId, "system", SPEC_SYSTEM_PROMPT);

  // Write opening assistant message
  await writeMessage(sessionId, "assistant", SPEC_OPENING_MESSAGE);

  logger.info({ sessionId }, "Spec session started with opening message");
}

/**
 * Handle a user message in a spec session.
 * Loads conversation history, generates a response, writes it to DB.
 *
 * STUB: Returns a formatted acknowledgment instead of calling Anthropic.
 * TODO: Replace generateStubResponse with real Anthropic API call in Phase 5.
 */
export async function handleSpecSessionMessage(
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
    "Processing spec session message",
  );

  // Generate response (stub or real AI)
  const response = generateStubResponse(messages, userContent);

  // Write assistant response
  await writeMessage(sessionId, "assistant", response);

  logger.info({ sessionId }, "Spec session message processed");
}

/**
 * Stub AI response generator.
 * Acknowledges the user's input and asks a follow-up question based on
 * how many exchanges have occurred (approximating the phase progression).
 *
 * TODO: Replace with real Anthropic API call in Phase 5 Worker.
 */
export function generateStubResponse(
  history: MessageRow[],
  userContent: string,
): string {
  // Count user messages to determine which phase we're in
  const userMessages = history.filter((m) => m.role === "user");
  const phase = userMessages.length; // 0-indexed; the newest user msg is not in history yet

  const phases = [
    {
      ack: "Thanks for the overview!",
      next: "**Phase 2: Target Users**\n\nWho will use this project? Describe your primary users and their key needs.",
    },
    {
      ack: "Good, I understand the target users.",
      next: "**Phase 3: Constraints**\n\nWhat are your constraints? Consider timeline, budget, team size, and any technical limitations.",
    },
    {
      ack: "Noted on the constraints.",
      next: "**Phase 4: Tech Stack**\n\nWhat technologies are you using or planning to use? (Languages, frameworks, databases, infrastructure)",
    },
    {
      ack: "Got it on the tech stack.",
      next: "**Phase 5: Boundaries**\n\nWhat's in scope for v1? What's explicitly out of scope?",
    },
  ];

  if (phase < phases.length) {
    return `${phases[phase].ack}\n\n${phases[phase].next}`;
  }

  // All phases covered — generate a summary spec
  return `Great, I have all the information I need. Here's your project specification:

# Project Specification

## Overview
${userContent}

## Target Users
(Based on our conversation)

## Constraints
(Based on our conversation)

## Tech Stack
(Based on our conversation)

## Boundaries (v1 Scope)
(Based on our conversation)

---

The spec is ready. You can complete this session to save it to your repo.

*Note: This is a stub response. With real AI integration, this spec would be synthesized from the full conversation.*`;
}

/**
 * Extract spec content from a completed session and upsert to the specs table.
 *
 * Called from the session.stop job handler when a spec session is completed.
 * Finds the last assistant message (which should contain the spec summary)
 * and saves it as the spec for the session's repo.
 */
export async function extractAndSaveSpec(
  sessionId: string,
  repoId: string,
): Promise<void> {
  const logger = getLogger();
  const db = getDb();
  const pubsub = getSharedPubsub();

  // Load all messages to find the spec content
  const messages = await db
    .select({ role: sessionMessages.role, content: sessionMessages.content })
    .from(sessionMessages)
    .where(eq(sessionMessages.sessionId, sessionId))
    .orderBy(asc(sessionMessages.createdAt));

  // Find the last assistant message (which should contain the spec)
  const assistantMessages = messages.filter((m) => m.role === "assistant");
  const lastAssistantMessage =
    assistantMessages[assistantMessages.length - 1];

  if (!lastAssistantMessage) {
    logger.warn({ sessionId }, "No assistant messages found for spec extraction");
    return;
  }

  const specContent = lastAssistantMessage.content;

  // Upsert the spec for this repo
  const [existing] = await db
    .select()
    .from(specs)
    .where(eq(specs.repoId, repoId))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(specs)
      .set({
        title: "Project Specification",
        content: specContent,
        updatedAt: new Date(),
      })
      .where(eq(specs.id, existing.id))
      .returning();

    await pubsub.publish(syncChannel("spec"), {
      action: "updated",
      data: updated,
      timestamp: Date.now(),
    } satisfies SyncEvent<typeof updated>);
  } else {
    const [created] = await db
      .insert(specs)
      .values({
        repoId,
        title: "Project Specification",
        content: specContent,
      })
      .returning();

    await pubsub.publish(syncChannel("spec"), {
      action: "created",
      data: created,
      timestamp: Date.now(),
    } satisfies SyncEvent<typeof created>);
  }

  logger.info({ sessionId, repoId }, "Spec extracted and saved");
}
