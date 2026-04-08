/**
 * Conversational session engine.
 *
 * Manages AI-powered conversational sessions (spec, architecture, etc.)
 * using the Anthropic SDK. Each session maintains its own AbortController
 * for cancellation support.
 *
 * This module is a stub. The full implementation is pending.
 */
import Anthropic from "@anthropic-ai/sdk";
import { getConfig } from "../config.js";
import { getLogger } from "../logger.js";

// ─── Model resolution ───

/** Map CLI-friendly alias → full Anthropic API model ID. Unknown values pass through. */
export function resolveModelId(alias: string): string {
  const map: Record<string, string> = {
    opus: "claude-opus-4-20250514",
    sonnet: "claude-sonnet-4-20250514",
  };
  return map[alias] ?? alias;
}

// ─── Types ───

interface StartOptions {
  sessionId: string;
  repoId: string;
  type: string;
  entityType?: string;
  entityId?: string;
}

interface HandleMessageOptions {
  sessionId: string;
  repoId: string;
  sessionType: string;
  content: string;
}

interface SessionContext {
  repoName: string;
  specContent?: string;
  entityTitle?: string;
  entityType?: string;
  entityDescription?: string;
}

// ─── Active sessions map (AbortControllers) ───

const activeSessions = new Map<string, AbortController>();

export function _getActiveSessions(): Map<string, AbortController> {
  return activeSessions;
}

// ─── Helpers ───

function buildSystemPrompt(context: SessionContext, type: string): string {
  let prompt = `You are helping with a project specification session for "${context.repoName}".`;
  if (type === "spec") {
    prompt += " Guide the user through defining their project specification.";
  } else if (type === "architecture") {
    prompt += " Guide the user through planning the architecture.";
  }
  if (context.specContent) {
    prompt += `\n\nExisting specification:\n${context.specContent}`;
  }
  if (context.entityTitle) {
    prompt += `\n\nEntity: ${context.entityTitle}`;
  }
  if (context.entityDescription) {
    prompt += `\nDescription: ${context.entityDescription}`;
  }
  return prompt;
}

// ─── Load session context ───

export async function loadSessionContext(
  db: any,
  opts: { repoId: string; entityType?: string; entityId?: string },
): Promise<SessionContext> {
  const repoRows = await db.select().from({}).where({});
  const repoName = repoRows.length > 0 ? repoRows[0].name : "Unknown";

  const specRows = await db.select().from({}).where({});
  const specContent = specRows.length > 0 ? specRows[0].content : undefined;

  let entityTitle: string | undefined;
  let entityType: string | undefined;
  let entityDescription: string | undefined;

  if (opts.entityType && opts.entityId) {
    const entityRows = await db.select().from({}).where({});
    if (entityRows.length > 0) {
      entityTitle = entityRows[0].title;
      entityType = opts.entityType;
      entityDescription = entityRows[0].description;
    }
  }

  return { repoName, specContent, entityTitle, entityType, entityDescription };
}

// ─── Get conversation history ───

export async function getConversationHistory(
  db: any,
  sessionId: string,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const rows = await db.select().from({}).where({}).orderBy({});
  return rows
    .filter((r: any) => r.role === "user" || r.role === "assistant")
    .map((r: any) => ({ role: r.role as "user" | "assistant", content: r.content }));
}

// ─── Start conversational session ───

export async function startConversationalSession(
  db: any,
  pubsub: any,
  opts: StartOptions,
): Promise<void> {
  const logger = getLogger();
  const config = getConfig();

  const controller = new AbortController();
  activeSessions.set(opts.sessionId, controller);

  // Check if session has a stored systemPrompt
  const metaRows = await db.select().from({}).where({});
  const storedSystemPrompt = metaRows[0]?.metadata?.systemPrompt;

  const context = await loadSessionContext(db, {
    repoId: opts.repoId,
    entityType: opts.entityType,
    entityId: opts.entityId,
  });

  const systemPrompt = storedSystemPrompt ?? buildSystemPrompt(context, opts.type);

  const client = new Anthropic();
  const response = await client.messages.create({
    model: resolveModelId(config.CLAUDE_MODEL),
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: "Begin the session." }],
  });

  const assistantText =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Persist user and assistant messages
  await db.insert({}).values([
    {
      sessionId: opts.sessionId,
      role: "user",
      content: "Begin the session.",
    },
    {
      sessionId: opts.sessionId,
      role: "assistant",
      content: assistantText,
    },
  ]);

  // Publish sync event
  await pubsub.publish(`sync:session:${opts.sessionId}:messages`, {
    action: "created",
    data: {
      sessionId: opts.sessionId,
      role: "assistant",
      content: assistantText,
    },
    timestamp: Date.now(),
  });
}

// ─── Handle conversational message ───

export async function handleConversationalMessage(
  db: any,
  pubsub: any,
  opts: HandleMessageOptions,
): Promise<void> {
  const logger = getLogger();
  const config = getConfig();

  // Check for stored system prompt
  const metaRows = await db.select().from({}).where({});
  const storedSystemPrompt = metaRows[0]?.metadata?.systemPrompt;

  const context = await loadSessionContext(db, { repoId: opts.repoId });

  const systemPrompt =
    storedSystemPrompt ?? buildSystemPrompt(context, opts.sessionType);

  // Load conversation history
  const history = await getConversationHistory(db, opts.sessionId);

  const client = new Anthropic();
  const response = await client.messages.create({
    model: resolveModelId(config.CLAUDE_MODEL),
    max_tokens: 4096,
    system: systemPrompt,
    messages: history,
  });

  const assistantText =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Persist assistant message
  await db.insert({}).values({
    sessionId: opts.sessionId,
    role: "assistant",
    content: assistantText,
  });

  // Publish sync
  await pubsub.publish(`sync:session:${opts.sessionId}:messages`, {
    action: "created",
    data: {
      sessionId: opts.sessionId,
      role: "assistant",
      content: assistantText,
    },
    timestamp: Date.now(),
  });

  // Check for spec output
  const specMatch = assistantText.match(/```spec\n([\s\S]*?)```/);
  if (specMatch && opts.sessionType === "spec") {
    const specContent = specMatch[1];
    const existingSpec = await db.select().from({}).where({});
    if (existingSpec.length === 0) {
      await db.insert({}).values({
        repoId: opts.repoId,
        title: "Project Spec",
        content: specContent,
      });
    } else {
      await db.update({}).set({ content: specContent }).where({});
    }
    await pubsub.publish("sync:spec", {
      action: "created",
      data: { repoId: opts.repoId },
      timestamp: Date.now(),
    });
  }

  // Check for proposal output
  const proposalMatch = assistantText.match(/```proposal\n([\s\S]*?)\n```/);
  if (proposalMatch && opts.sessionType === "architecture") {
    try {
      const proposal = JSON.parse(proposalMatch[1]);

      // Look up session to get entityId
      const sessionRows = await db.select().from({}).where({});
      const entityId = sessionRows[0]?.entityId;

      await db.insert({}).values({
        ideaId: entityId,
        repoId: opts.repoId,
        sessionId: opts.sessionId,
        proposal,
        status: "draft",
      });

      // Update idea status
      await db.update({}).set({ status: "planning" }).where({});

      await pubsub.publish("sync:plan", {
        action: "created",
        data: { ideaId: entityId, repoId: opts.repoId },
        timestamp: Date.now(),
      });

      // Insert friendly follow-up message
      await db.insert({}).values({
        sessionId: opts.sessionId,
        role: "assistant",
        content:
          "I've saved your plan proposal. You can review it in the planning view.",
      });
    } catch (err) {
      logger.warn(
        { err },
        "Failed to parse proposal JSON from assistant message",
      );
    }
  }
}

// ─── Stop conversational session ───

export async function stopConversationalSession(
  db: any,
  pubsub: any,
  sessionId: string,
): Promise<void> {
  const controller = activeSessions.get(sessionId);
  if (controller) {
    controller.abort();
    activeSessions.delete(sessionId);
  }
}
