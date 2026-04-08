/**
 * Prompt generation for all session types.
 *
 * Builds the prompt string passed to `claude --dangerously-skip-permissions "<prompt>"`.
 * Each session type (spec, architecture, debug, working) gets a tailored prompt
 * that instructs the Claude CLI how to behave.
 *
 * Default templates are defined in @praxis2/shared/prompt-defaults and shared
 * with the API router (which serves them to the UI for editing).
 * When an org admin provides a system instruction override, it replaces the
 * entire default template. Dynamic context (entity details, spec, etc.)
 * is still appended by each generator.
 */

import {
  DEFAULT_SPEC_TEMPLATE,
  DEFAULT_ARCHITECTURE_TEMPLATE,
  DEFAULT_DEBUG_TEMPLATE,
  DEFAULT_WORKING_TEMPLATE,
  DEFAULT_REPO_TEMPLATE,
} from "@praxis2/shared";

export type SessionInfo = {
  prompt?: string | null; // User-configured custom prompt (from sessions.prompt column)
};

export type EntityInfo = {
  taskId?: string | null;
  epicId?: string | null;
  title?: string | null;
  description?: string | null;
  taskContext?: string | null;
};

export type WorkspaceInfo = {
  repoName: string;
  projectPath: string;
};

export type SessionContext = {
  repoName: string;
  spec?: string;
  existingSpec?: string;
  ideaTitle?: string;
  ideaDescription?: string;
  entityTitle?: string;
  entityType?: string;
  entityDescription?: string;
  recentCommits?: string;
  recentMessages?: string;
  /** Pre-built system prompt (e.g. from debug context builder) */
  systemPrompt?: string;
  /** Phase configuration for architecture sessions */
  phaseConfig?: Array<{ phase: string; mode: "skip" | "full-ai" | "ai-assisted" }>;
};

/** Substitute {repoName} (and any future placeholders) in a template string */
function substituteTemplateVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => vars[key] ?? match);
}

// ─── Conversational Session Prompts ──────────────────────────────────

/**
 * Generate a CLI prompt for a spec session.
 * The AI guides the user through defining their project spec.
 */
export function generateSpecPrompt(ctx: SessionContext, systemInstructionsOverride?: string): string {
  const template = systemInstructionsOverride ?? DEFAULT_SPEC_TEMPLATE;
  const staticPart = substituteTemplateVars(template, { repoName: ctx.repoName });

  const lines: string[] = [staticPart];

  if (ctx.existingSpec) {
    lines.push(``, `Current spec:`, ctx.existingSpec);
  }

  return lines.join("\n");
}

/**
 * Generate a CLI prompt for an architecture session.
 * The AI breaks down a feature idea into epics and tasks.
 */
export function generateArchitecturePrompt(ctx: SessionContext, systemInstructionsOverride?: string): string {
  const template = systemInstructionsOverride ?? DEFAULT_ARCHITECTURE_TEMPLATE;
  const staticPart = substituteTemplateVars(template, { repoName: ctx.repoName });

  const lines: string[] = [staticPart];

  // Append dynamic context that isn't part of the editable template
  if (ctx.spec) lines.push(``, `Spec: ${ctx.spec}`);
  if (ctx.ideaTitle) lines.push(``, `Idea: ${ctx.ideaTitle}`);
  if (ctx.ideaDescription) lines.push(`Idea Description: ${ctx.ideaDescription}`);

  return lines.join("\n");
}

/**
 * Generate a CLI prompt for a debug session.
 * The AI helps troubleshoot issues with full codebase access.
 */
export function generateDebugPrompt(ctx: SessionContext, systemInstructionsOverride?: string): string {
  // If a pre-built system prompt exists (from debug context builder), use it
  if (ctx.systemPrompt) {
    const template = systemInstructionsOverride ?? DEFAULT_DEBUG_TEMPLATE;
    const prefix = substituteTemplateVars(template, { repoName: ctx.repoName });
    return prefix + "\n\n" + ctx.systemPrompt;
  }

  const template = systemInstructionsOverride ?? DEFAULT_DEBUG_TEMPLATE;
  const staticPart = substituteTemplateVars(template, { repoName: ctx.repoName });

  const lines: string[] = [staticPart];

  // Append dynamic context
  if (ctx.spec) lines.push(``, `Spec: ${ctx.spec}`);
  if (ctx.entityTitle) lines.push(``, `Entity: ${ctx.entityTitle} (${ctx.entityType})`);
  if (ctx.entityDescription) lines.push(`Description: ${ctx.entityDescription}`);
  if (ctx.recentCommits) lines.push(``, `Recent commits:`, ctx.recentCommits);
  if (ctx.recentMessages) lines.push(``, `Recent session messages:`, ctx.recentMessages);

  return lines.join("\n");
}

/**
 * Generate the prompt for any conversational session type.
 */
export function generateConversationalPrompt(
  type: "spec" | "architecture" | "debug",
  ctx: SessionContext,
  systemInstructionsOverride?: string,
): string {
  switch (type) {
    case "spec":
      return generateSpecPrompt(ctx, systemInstructionsOverride);
    case "architecture":
      return generateArchitecturePrompt(ctx, systemInstructionsOverride);
    case "debug":
      return generateDebugPrompt(ctx, systemInstructionsOverride);
  }
}

/**
 * Combines user-configured prompt, entity context, and workspace context
 * into the final prompt string.
 *
 * Priority:
 * 1. If session.prompt is set (user customized it), use it as-is.
 * 2. Otherwise, generate a default prompt based on mode (epic vs single task).
 */
export function generateWorkingPrompt(
  session: SessionInfo,
  entity: EntityInfo,
  workspace: WorkspaceInfo,
  systemInstructionsOverride?: string,
): string {
  // If the user has provided a custom prompt, use it directly.
  if (session.prompt && session.prompt.trim().length > 0) {
    return systemInstructionsOverride
      ? systemInstructionsOverride + "\n\n" + session.prompt.trim()
      : session.prompt.trim();
  }

  // Otherwise, build a default prompt based on the entity type.
  if (entity.epicId) {
    return generateOrchestratorPrompt(entity, workspace, systemInstructionsOverride);
  } else {
    return generateFocusedPrompt(entity, workspace, systemInstructionsOverride);
  }
}

/**
 * Used when a working session targets an entire epic. Claude is instructed
 * to coordinate implementation across all tasks within the epic.
 */
export function generateOrchestratorPrompt(
  entity: EntityInfo,
  workspace: WorkspaceInfo,
  systemInstructionsOverride?: string,
): string {
  const template = systemInstructionsOverride ?? DEFAULT_WORKING_TEMPLATE;
  const epicId = entity.epicId ?? "<epic-id>";
  const taskId = entity.taskId ?? "<task-id>";
  const staticPart = substituteTemplateVars(template, { repoName: workspace.repoName, epicId, taskId });

  const lines: string[] = [staticPart];

  // Append dynamic entity context
  lines.push(``, `Your task is to implement the epic: ${entity.title ?? epicId}`);

  if (entity.description) {
    lines.push(``, `Epic description: ${entity.description}`);
  }

  if (entity.taskContext) {
    lines.push(``, `Task Tree:`, entity.taskContext);
  }

  return lines.join("\n");
}

/**
 * Used when a working session targets a single task. Claude is instructed
 * to implement just that one task.
 */
export function generateFocusedPrompt(
  entity: EntityInfo,
  workspace: WorkspaceInfo,
  systemInstructionsOverride?: string,
): string {
  const template = systemInstructionsOverride ?? DEFAULT_WORKING_TEMPLATE;
  const taskId = entity.taskId ?? "<task-id>";
  const epicId = entity.epicId ?? "<epic-id>";
  const staticPart = substituteTemplateVars(template, { repoName: workspace.repoName, taskId, epicId });

  const lines: string[] = [staticPart];

  // Append dynamic entity context
  lines.push(``, `Your task is to implement: ${entity.title ?? entity.taskId}`);

  if (entity.description) {
    lines.push(``, `Task description: ${entity.description}`);
  }

  if (entity.taskContext) {
    lines.push(``, `Task Details:`, entity.taskContext);
  }

  return lines.join("\n");
}

// ─── Context-Only Initial Messages ──────────────────────────────────
// Used when a skill file provides the behavioral instructions via --system-prompt.
// These supply just the session context (repo name, spec, idea, entity info)
// without duplicating the behavioral instructions already in the skill file.

/**
 * Generate a context-only initial message for a spec session.
 * Used when a skill file provides the behavioral instructions.
 */
export function generateSpecInitialMessage(ctx: SessionContext): string {
  const lines: string[] = ["Start the spec workshop session."];

  lines.push("", `Repo: ${ctx.repoName}`);

  if (ctx.existingSpec) {
    lines.push("", "Current spec:", ctx.existingSpec);
  }

  return lines.join("\n");
}

/**
 * Generate a context-only initial message for an architecture session.
 * Used when a skill file provides the behavioral instructions.
 */
export function generateArchitectureInitialMessage(ctx: SessionContext): string {
  const lines: string[] = [
    "Start the architect workshop session. You are the ARCHITECT WORKSHOP assistant.",
  ];

  lines.push("", `Repo: ${ctx.repoName}`);

  if (ctx.spec) lines.push(`Spec: ${ctx.spec}`);
  if (ctx.ideaTitle) {
    lines.push("", `The user is promoting this idea into an architecture plan:`, "");
    lines.push(`Idea: ${ctx.ideaTitle}`);
    if (ctx.ideaDescription) lines.push(`Description: ${ctx.ideaDescription}`);
  }

  if (ctx.phaseConfig && ctx.phaseConfig.length > 0) {
    lines.push("", "Phase Configuration:", JSON.stringify(ctx.phaseConfig));
  }

  return lines.join("\n");
}

/**
 * Generate a context-only initial message for a debug session.
 * Used when a skill file provides the behavioral instructions.
 */
export function generateDebugInitialMessage(ctx: SessionContext): string {
  const lines: string[] = ["Start the debug session."];

  // If a pre-built system prompt exists (from debug context builder), include it as context
  if (ctx.systemPrompt) {
    lines.push("", "Context for this debugging session:", "", ctx.systemPrompt);
    return lines.join("\n");
  }

  lines.push("", `Repo: ${ctx.repoName}`);

  if (ctx.spec) lines.push(`Spec: ${ctx.spec}`);
  if (ctx.entityTitle) lines.push(`Entity: ${ctx.entityTitle} (${ctx.entityType})`);
  if (ctx.entityDescription) lines.push(`Description: ${ctx.entityDescription}`);
  if (ctx.recentCommits) lines.push("", "Recent commits:", ctx.recentCommits);
  if (ctx.recentMessages) lines.push("", "Recent session messages:", ctx.recentMessages);

  return lines.join("\n");
}

/**
 * Generate context-only initial message for any conversational session type.
 * Used when a skill file provides the behavioral instructions via --system-prompt.
 */
export function generateInitialMessage(
  type: "spec" | "architecture" | "debug",
  ctx: SessionContext,
): string {
  switch (type) {
    case "spec":
      return generateSpecInitialMessage(ctx);
    case "architecture":
      return generateArchitectureInitialMessage(ctx);
    case "debug":
      return generateDebugInitialMessage(ctx);
  }
}

// ─── Working Session Initial Message ──────────────────────────────
// Used when the working.md skill file provides behavioral instructions
// via --system-prompt. Sends entity context + mode indicator only.

/**
 * Generate a context-only initial message for a working session.
 * The skill file handles all behavioral instructions (orchestrator vs focused).
 * This just tells the skill which mode to use and provides entity context.
 */
export function generateWorkingInitialMessage(
  entity: EntityInfo,
  workspace: WorkspaceInfo,
): string {
  const lines: string[] = [
    `Start working session for project "${workspace.repoName}".`,
    ``,
  ];

  if (entity.epicId) {
    lines.push(`Mode: Epic`);
    lines.push(`Epic ID: ${entity.epicId}`);
    if (entity.title) lines.push(`Title: ${entity.title}`);
    if (entity.description) lines.push(`Description: ${entity.description}`);
  } else if (entity.taskId) {
    lines.push(`Mode: Task`);
    lines.push(`Task ID: ${entity.taskId}`);
    if (entity.title) lines.push(`Title: ${entity.title}`);
    if (entity.description) lines.push(`Description: ${entity.description}`);
  } else {
    lines.push(`No specific entity assigned.`);
  }

  if (entity.taskContext) {
    lines.push(``, `Task Context:`, entity.taskContext);
  }

  return lines.join("\n");
}

/**
 * Generate a fallback prompt for a repo chat session.
 * Used when no skill file is available.
 */
export function generateRepoSessionPrompt(workspace: WorkspaceInfo, systemInstructionsOverride?: string): string {
  const template = systemInstructionsOverride ?? DEFAULT_REPO_TEMPLATE;
  const staticPart = substituteTemplateVars(template, { repoName: workspace.repoName });
  return staticPart;
}

/**
 * Generate a context-only initial message for a repo chat session.
 * Used when a skill file provides the behavioral instructions.
 */
export function generateRepoSessionInitialMessage(workspace: WorkspaceInfo): string {
  return `Start repo chat session for project "${workspace.repoName}".`;
}

// ─── Resume Messages ──────────────────────────────────────────────
// Short context-appropriate messages sent when resuming a session.

/**
 * Generate a context-appropriate message for resuming a session.
 *
 * Working sessions reference the task/epic being implemented.
 * Other session types get a short generic continuation message.
 */
export function generateResumeMessage(
  type: string,
  entity?: EntityInfo,
): string {
  switch (type) {
    case "working": {
      const ref = entity?.title ?? entity?.epicId ?? entity?.taskId;
      if (entity?.epicId) {
        const label = ref ?? entity.epicId;
        return `Pick up where you left off on epic: ${label}. Check task status and continue implementing.`;
      }
      if (entity?.taskId) {
        const label = ref ?? entity.taskId;
        return `Pick up where you left off on: ${label}. Continue implementing.`;
      }
      return "Pick up where you left off. Check task status and continue implementing.";
    }
    case "debug":
      return "Continue debugging where you left off.";
    case "repo":
      return "Continue the conversation where you left off.";
    default:
      return "Continue the session where you left off.";
  }
}

/**
 * Exported for use in tests and for the UI to show default templates
 * when the user has not customized the prompt.
 */
export const DEFAULT_TEMPLATES = {
  orchestrator: generateOrchestratorPrompt,
  focused: generateFocusedPrompt,
};
