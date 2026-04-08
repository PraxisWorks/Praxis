import { eq } from "drizzle-orm";
import { getLogger } from "../logger.js";
import type { DrizzleDb } from "../db.js";
import { sessions, sessionMessages } from "@praxis2/api/schema";
import { buildDebugContext } from "./build-debug-context.js";

interface PubSub {
  publish(channel: string, data: unknown): Promise<void>;
}

interface HandleDebugSessionParams {
  sessionId: string;
  repoId: string;
  entityType: "task" | "epic";
  entityId: string;
}

/**
 * Handles the initial setup of a debug session:
 * 1. Calls buildDebugContext to gather all relevant context
 * 2. Writes a system message to session_messages
 * 3. Publishes sync event on the scoped channel
 * 4. Stores systemPrompt in session metadata for use by conversational engine
 *
 * Ongoing messages flow through the existing conversational engine.
 */
export async function handleDebugSession(
  db: DrizzleDb,
  pubsub: PubSub,
  params: HandleDebugSessionParams,
): Promise<void> {
  const logger = getLogger();

  const debugContext = await buildDebugContext(db, {
    repoId: params.repoId,
    entityType: params.entityType,
    entityId: params.entityId,
  });

  const systemContent = `Debug session started for ${params.entityType}: ${debugContext.entityTitle}`;

  // Write system message to session_messages
  const [message] = await db
    .insert(sessionMessages)
    .values({
      sessionId: params.sessionId,
      role: "system" as const,
      content: systemContent,
    })
    .returning();

  // Publish sync event on scoped channel
  const messagesChannel = `sync:session:${params.sessionId}:messages`;
  await pubsub.publish(messagesChannel, {
    action: "created",
    data: message,
    timestamp: Date.now(),
  });

  // Store systemPrompt in session metadata for use by conversational engine
  await db
    .update(sessions)
    .set({
      metadata: { systemPrompt: debugContext.systemPrompt },
      updatedAt: new Date(),
    })
    .where(eq(sessions.id, params.sessionId));

  logger.info(
    {
      sessionId: params.sessionId,
      entityType: params.entityType,
      entityTitle: debugContext.entityTitle,
    },
    "Debug session initialized with context",
  );
}
