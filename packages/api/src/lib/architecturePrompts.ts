import type { Proposal } from "@praxis2/shared";

export const ARCHITECTURE_PHASES = [
  "scope_and_requirements",
  "architecture",
  "epic_breakdown",
  "task_breakdown",
  "review",
] as const;

export type ArchitecturePhase = (typeof ARCHITECTURE_PHASES)[number];

export interface ArchitectureContext {
  specContent: string | null;
  ideaTitle: string;
  ideaDescription: string;
  repoName: string;
}

/**
 * Build a system prompt for the given architecture phase and context.
 * The prompt anchors the AI to the current phase of the interactive
 * architecture planning conversation.
 */
export function getSystemPrompt(
  phase: ArchitecturePhase,
  context: ArchitectureContext,
): string {
  const baseContext = `
You are an architecture planner for the project "${context.repoName}".
${context.specContent ? `\nProject Spec:\n${context.specContent}\n` : ""}
The user wants to plan the following idea:
Title: ${context.ideaTitle}
Description: ${context.ideaDescription}
  `.trim();

  switch (phase) {
    case "scope_and_requirements":
      return `${baseContext}

Your job in this phase is to define the scope and requirements.
Ask the user clarifying questions about:
- What exactly are we building?
- What is explicitly out of scope?
- What are the key user stories?
- What are the acceptance criteria?

Be concise. Ask at most 3-5 targeted questions.
When you have enough information, summarize the scope and say "Ready to move to Architecture phase."`;

    case "architecture":
      return `${baseContext}

Based on the scope defined so far, outline the technical architecture:
- What services/modules are needed?
- What are the data model changes?
- What are the API boundaries?
- What are the key technical decisions?

Present your architecture and ask the user for confirmation or adjustments.
When confirmed, say "Ready to move to Epic Breakdown phase."`;

    case "epic_breakdown":
      return `${baseContext}

Break the work into logical epics (high-level groupings).
Each epic should represent a coherent stream of work.
Present 2-5 epics with titles and descriptions.
Ask the user if the grouping looks right.
When confirmed, say "Ready to move to Task Breakdown phase."`;

    case "task_breakdown":
      return `${baseContext}

For each epic, break down into individual tasks (tasks).
Each task needs:
- A clear title
- A description of what to implement
- Priority (low/medium/high)
- Dependencies on other tasks (by reference)

Present the full breakdown and ask for confirmation.
When confirmed, say "Ready to generate the proposal."`;

    case "review":
      return `${baseContext}

Generate the final proposal as a JSON object matching this exact structure:
{
  "epics": [
    {
      "key": "e1",
      "title": "Epic Title",
      "description": "What this epic covers",
      "tasks": [
        {
          "key": "b1",
          "title": "Task Title",
          "description": "What to implement",
          "priority": "high",
          "dependsOn": []
        }
      ]
    }
  ]
}

Output ONLY the JSON. No markdown fences, no explanation.`;
  }
}

/**
 * Opening message for the first phase (Scope & Requirements).
 * This is what the AI sends when the architecture session first starts.
 */
export const ARCHITECTURE_OPENING_MESSAGE = `Let's plan the architecture for this idea. I'll guide you through a structured process to define scope, architecture, and task breakdown.

**Phase 1: Scope & Requirements**

Before diving into technical details, I need to understand the scope. Let me ask a few questions:

1. What are the core features this needs to deliver?
2. What is explicitly out of scope for this iteration?
3. Are there any hard constraints (timeline, tech stack, team size)?

Please share what you have in mind.`;

/**
 * Phase transition advancement signals.
 * If an AI response contains one of these phrases (case-insensitive),
 * we consider the current phase complete and advance to the next.
 */
export const ADVANCEMENT_SIGNALS = [
  "Ready to move to",
  "Let's proceed to",
  "Moving on to",
  "Ready to generate the proposal",
] as const;
