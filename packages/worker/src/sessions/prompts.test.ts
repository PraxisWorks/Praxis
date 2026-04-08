import { describe, it, expect } from "vitest";
import {
  generateWorkingPrompt,
  generateOrchestratorPrompt,
  generateFocusedPrompt,
  generateResumeMessage,
  generateSpecPrompt,
  generateArchitecturePrompt,
  generateDebugPrompt,
  generateRepoSessionPrompt,
} from "./prompts.js";
import type { SessionInfo, EntityInfo, WorkspaceInfo, SessionContext } from "./prompts.js";

const workspace: WorkspaceInfo = {
  repoName: "my-app",
  projectPath: "/tmp/my-app",
};

describe("prompt generation", () => {
  describe("generateWorkingPrompt", () => {
    it("returns custom prompt when session.prompt is set", () => {
      const result = generateWorkingPrompt(
        { prompt: "Do the custom thing" },
        { taskId: "b1" },
        workspace,
      );
      expect(result).toBe("Do the custom thing");
    });

    it("trims whitespace from custom prompt", () => {
      const result = generateWorkingPrompt(
        { prompt: "  custom prompt  \n" },
        { taskId: "b1" },
        workspace,
      );
      expect(result).toBe("custom prompt");
    });

    it("generates orchestrator prompt when entity has epicId", () => {
      const result = generateWorkingPrompt(
        { prompt: null },
        { epicId: "e1", title: "Auth Epic", description: "Implement auth" },
        workspace,
      );
      expect(result).toContain("my-app");
      expect(result).toContain("Auth Epic");
      expect(result).toContain("Implement auth");
      expect(result).toContain("epic");
    });

    it("generates focused prompt when entity has taskId but no epicId", () => {
      const result = generateWorkingPrompt(
        { prompt: null },
        {
          taskId: "b1",
          title: "Add login form",
          description: "Create the login component",
        },
        workspace,
      );
      expect(result).toContain("my-app");
      expect(result).toContain("Add login form");
      expect(result).toContain("Create the login component");
    });

    it("uses taskId as fallback when title is missing", () => {
      const result = generateWorkingPrompt(
        { prompt: null },
        { taskId: "b1", title: null },
        workspace,
      );
      expect(result).toContain("b1");
    });

    it("omits description line when description is null", () => {
      const result = generateWorkingPrompt(
        { prompt: null },
        { taskId: "b1", title: "Task", description: null },
        workspace,
      );
      expect(result).not.toContain("Task description:");
    });

    it("treats empty string prompt as unset (generates default)", () => {
      const result = generateWorkingPrompt(
        { prompt: "   " },
        { taskId: "b1", title: "Task" },
        workspace,
      );
      expect(result).toContain("my-app");
    });

    it("treats null prompt as unset (generates default)", () => {
      const result = generateWorkingPrompt(
        { prompt: null },
        { taskId: "b1", title: "Task" },
        workspace,
      );
      expect(result).toContain("my-app");
    });

    it("treats undefined prompt as unset (generates default)", () => {
      const result = generateWorkingPrompt(
        {},
        { taskId: "b1", title: "Task" },
        workspace,
      );
      expect(result).toContain("my-app");
    });
  });

  describe("generateOrchestratorPrompt", () => {
    it("includes repo name in the prompt", () => {
      const result = generateOrchestratorPrompt(
        { epicId: "e1", title: "Auth Epic" },
        workspace,
      );
      expect(result).toContain("my-app");
    });

    it("includes epic title", () => {
      const result = generateOrchestratorPrompt(
        { epicId: "e1", title: "Auth Epic" },
        workspace,
      );
      expect(result).toContain("Auth Epic");
    });

    it("includes epic description when provided", () => {
      const result = generateOrchestratorPrompt(
        { epicId: "e1", title: "Auth", description: "Full auth flow" },
        workspace,
      );
      expect(result).toContain("Full auth flow");
    });

    it("falls back to epicId when title is null", () => {
      const result = generateOrchestratorPrompt(
        { epicId: "e1", title: null },
        workspace,
      );
      expect(result).toContain("e1");
    });

    it("includes instruction to implement tasks in dependency order", () => {
      const result = generateOrchestratorPrompt(
        { epicId: "e1", title: "Auth" },
        workspace,
      );
      expect(result).toContain("dependency order");
    });

    it("uses px task list with actual epic ID instead of bd commands", () => {
      const result = generateOrchestratorPrompt(
        { epicId: "e1", title: "Auth" },
        workspace,
      );
      expect(result).toContain("$PX_CLI bead list --parent e1");
      expect(result).not.toContain("bd show");
      expect(result).not.toContain("bd update");
      expect(result).not.toContain("bd close");
    });

    it("uses px task ready with actual epic ID", () => {
      const result = generateOrchestratorPrompt(
        { epicId: "e1", title: "Auth" },
        workspace,
      );
      expect(result).toContain("$PX_CLI bead ready --parent e1");
    });

    it("includes taskContext when provided", () => {
      const result = generateOrchestratorPrompt(
        { epicId: "e1", title: "Auth", taskContext: "ID  Status  Title\nb1  draft   Login" },
        workspace,
      );
      expect(result).toContain("Task Tree:");
      expect(result).toContain("b1  draft   Login");
    });

    it("includes epic complete command with actual epic ID in Session Close", () => {
      const result = generateOrchestratorPrompt(
        { epicId: "e1", title: "Auth Epic" },
        workspace,
      );
      expect(result).toContain("epic complete e1");
    });

    it("includes Session Close section", () => {
      const result = generateOrchestratorPrompt(
        { epicId: "e1", title: "Auth Epic" },
        workspace,
      );
      expect(result).toContain("Session Close:");
    });

    it("mentions follow-up system message for PR/merge", () => {
      const result = generateOrchestratorPrompt(
        { epicId: "e1", title: "Auth Epic" },
        workspace,
      );
      expect(result).toContain("system message");
    });

    it("tells agent not to wait for human review", () => {
      const result = generateOrchestratorPrompt(
        { epicId: "e1", title: "Auth Epic" },
        workspace,
      );
      expect(result).toContain("Do NOT wait for human review");
    });
  });

  describe("generateFocusedPrompt", () => {
    it("includes repo name in the prompt", () => {
      const result = generateFocusedPrompt(
        { taskId: "b1", title: "Login" },
        workspace,
      );
      expect(result).toContain("my-app");
    });

    it("includes task title", () => {
      const result = generateFocusedPrompt(
        { taskId: "b1", title: "Add login form" },
        workspace,
      );
      expect(result).toContain("Add login form");
    });

    it("includes task description when provided", () => {
      const result = generateFocusedPrompt(
        { taskId: "b1", title: "Login", description: "Create login component" },
        workspace,
      );
      expect(result).toContain("Create login component");
    });

    it("falls back to taskId when title is null", () => {
      const result = generateFocusedPrompt(
        { taskId: "b1", title: null },
        workspace,
      );
      expect(result).toContain("b1");
    });

    it("includes instruction to run tests", () => {
      const result = generateFocusedPrompt(
        { taskId: "b1", title: "Task" },
        workspace,
      );
      expect(result).toContain("Run tests");
    });

    it("uses px commands with actual task ID instead of bd commands", () => {
      const result = generateFocusedPrompt(
        { taskId: "b1", title: "Task" },
        workspace,
      );
      expect(result).toContain("$PX_CLI bead show b1");
      expect(result).toContain("$PX_CLI bead start b1");
      expect(result).toContain("$PX_CLI bead complete b1");
      expect(result).not.toContain("bd show");
      expect(result).not.toContain("bd update");
      expect(result).not.toContain("bd close");
    });

    it("includes taskContext when provided", () => {
      const result = generateFocusedPrompt(
        { taskId: "b1", title: "Task", taskContext: "ID: b1\nStatus: draft\nPriority: high" },
        workspace,
      );
      expect(result).toContain("Task Details:");
      expect(result).toContain("ID: b1");
    });
  });

  describe("generateResumeMessage", () => {
    it("returns working message with epic reference when epicId provided", () => {
      const result = generateResumeMessage("working", {
        epicId: "e1",
        title: "Auth Epic",
      });
      expect(result).toBe(
        "Pick up where you left off on epic: Auth Epic. Check task status and continue implementing.",
      );
    });

    it("returns working message with task reference when taskId provided (no epicId)", () => {
      const result = generateResumeMessage("working", {
        taskId: "b1",
        title: "Add login form",
      });
      expect(result).toBe(
        "Pick up where you left off on: Add login form. Continue implementing.",
      );
    });

    it("returns working message with no entity reference when entity is undefined", () => {
      const result = generateResumeMessage("working");
      expect(result).toBe(
        "Pick up where you left off. Check task status and continue implementing.",
      );
    });

    it("returns working message with no entity reference when entity has no IDs", () => {
      const result = generateResumeMessage("working", {});
      expect(result).toBe(
        "Pick up where you left off. Check task status and continue implementing.",
      );
    });

    it("returns debug message", () => {
      const result = generateResumeMessage("debug");
      expect(result).toBe("Continue debugging where you left off.");
    });

    it("returns repo message", () => {
      const result = generateResumeMessage("repo");
      expect(result).toBe("Continue the conversation where you left off.");
    });

    it("returns default message for spec type", () => {
      const result = generateResumeMessage("spec");
      expect(result).toBe("Continue the session where you left off.");
    });

    it("returns default message for architecture type", () => {
      const result = generateResumeMessage("architecture");
      expect(result).toBe("Continue the session where you left off.");
    });

    it("uses title as reference if available, falls back to epicId", () => {
      const withTitle = generateResumeMessage("working", {
        epicId: "e1",
        title: "My Epic",
      });
      expect(withTitle).toContain("My Epic");

      const withoutTitle = generateResumeMessage("working", {
        epicId: "e1",
      });
      expect(withoutTitle).toContain("e1");
    });

    it("uses title as reference if available, falls back to taskId", () => {
      const withTitle = generateResumeMessage("working", {
        taskId: "b1",
        title: "My Task",
      });
      expect(withTitle).toContain("My Task");

      const withoutTitle = generateResumeMessage("working", {
        taskId: "b1",
      });
      expect(withoutTitle).toContain("b1");
    });
  });

  // ─── System Instructions Override Tests ────────────────────────────

  const baseCtx: SessionContext = { repoName: "my-app" };

  describe("generateSpecPrompt systemInstructionsOverride", () => {
    it("uses default behavioral text when override is undefined", () => {
      const result = generateSpecPrompt(baseCtx);
      expect(result).toContain("You are a project specification assistant for Praxis");
    });

    it("replaces entire template with override when provided", () => {
      const result = generateSpecPrompt(baseCtx, "Custom spec instructions");
      expect(result).toContain("Custom spec instructions");
      expect(result).not.toContain("You are a project specification assistant for Praxis");
    });

    it("does not include default template content when override replaces it", () => {
      const result = generateSpecPrompt(baseCtx, "Custom spec instructions");
      // Override replaces the entire template, so structured question instruction is gone
      expect(result).not.toContain("Ask questions in this order");
    });

    it("still appends dynamic context (existing spec) when override is provided", () => {
      const ctx: SessionContext = { repoName: "my-app", existingSpec: "Some spec content" };
      const result = generateSpecPrompt(ctx, "Custom spec instructions with {repoName}");
      expect(result).toContain("Custom spec instructions with my-app");
      expect(result).toContain("Some spec content");
    });
  });

  describe("generateArchitecturePrompt systemInstructionsOverride", () => {
    it("uses default behavioral text when override is undefined", () => {
      const result = generateArchitecturePrompt(baseCtx);
      expect(result).toContain("You are an architecture planning assistant for Praxis");
    });

    it("replaces entire template with override when provided", () => {
      const result = generateArchitecturePrompt(baseCtx, "Custom arch instructions");
      expect(result).toContain("Custom arch instructions");
      expect(result).not.toContain("You are an architecture planning assistant for Praxis");
    });

    it("does not include default template content when override replaces it", () => {
      const result = generateArchitecturePrompt(baseCtx, "Custom arch instructions");
      expect(result).not.toContain("Walk through these phases");
    });

    it("still appends dynamic context (spec, idea) when override is provided", () => {
      const ctx: SessionContext = {
        repoName: "my-app",
        spec: "My spec",
        ideaTitle: "Auth feature",
        ideaDescription: "Add OAuth",
      };
      const result = generateArchitecturePrompt(ctx, "Custom arch instructions");
      expect(result).toContain("My spec");
      expect(result).toContain("Auth feature");
      expect(result).toContain("Add OAuth");
    });
  });

  describe("generateDebugPrompt systemInstructionsOverride", () => {
    it("uses default behavioral text when override is undefined", () => {
      const result = generateDebugPrompt(baseCtx);
      expect(result).toContain("You are a debugging assistant for Praxis");
    });

    it("replaces entire template with override when provided (no systemPrompt)", () => {
      const result = generateDebugPrompt(baseCtx, "Custom debug instructions");
      expect(result).toContain("Custom debug instructions");
      expect(result).not.toContain("You are a debugging assistant for Praxis");
    });

    it("does not include default template content when override replaces it", () => {
      const result = generateDebugPrompt(baseCtx, "Custom debug instructions");
      expect(result).not.toContain("Help the user diagnose the problem");
    });

    it("prepends override to systemPrompt when both are provided", () => {
      const ctx: SessionContext = { repoName: "my-app", systemPrompt: "Pre-built debug context" };
      const result = generateDebugPrompt(ctx, "Custom debug instructions");
      expect(result).toContain("Custom debug instructions");
      expect(result).toContain("Pre-built debug context");
      // Override should come before systemPrompt
      expect(result.indexOf("Custom debug instructions")).toBeLessThan(
        result.indexOf("Pre-built debug context"),
      );
    });

    it("uses default template when systemPrompt is set but override is undefined", () => {
      const ctx: SessionContext = { repoName: "my-app", systemPrompt: "Pre-built debug context" };
      const result = generateDebugPrompt(ctx);
      expect(result).toContain("Pre-built debug context");
      // Default template is prepended
      expect(result).toContain("You are a debugging assistant for Praxis");
    });

    it("still appends dynamic context (entity info) when override is provided", () => {
      const ctx: SessionContext = {
        repoName: "my-app",
        entityTitle: "Login bug",
        entityType: "task",
        entityDescription: "Fix login",
      };
      const result = generateDebugPrompt(ctx, "Custom debug instructions");
      expect(result).toContain("Login bug");
      expect(result).toContain("Fix login");
    });
  });

  describe("generateWorkingPrompt systemInstructionsOverride", () => {
    it("prepends override to custom session prompt when both exist", () => {
      const result = generateWorkingPrompt(
        { prompt: "Do the custom thing" },
        { taskId: "b1" },
        workspace,
        "Org-level instructions",
      );
      expect(result).toContain("Org-level instructions");
      expect(result).toContain("Do the custom thing");
      expect(result.indexOf("Org-level instructions")).toBeLessThan(
        result.indexOf("Do the custom thing"),
      );
    });

    it("returns only custom prompt when override is undefined", () => {
      const result = generateWorkingPrompt(
        { prompt: "Do the custom thing" },
        { taskId: "b1" },
        workspace,
      );
      expect(result).toBe("Do the custom thing");
    });

    it("passes override to orchestrator prompt for epic entities", () => {
      const result = generateWorkingPrompt(
        { prompt: null },
        { epicId: "e1", title: "Auth Epic" },
        workspace,
        "Org-level instructions",
      );
      expect(result).toContain("Org-level instructions");
      expect(result).not.toContain(`You are working on the project "my-app"`);
    });

    it("passes override to focused prompt for task entities", () => {
      const result = generateWorkingPrompt(
        { prompt: null },
        { taskId: "b1", title: "Login task" },
        workspace,
        "Org-level instructions",
      );
      expect(result).toContain("Org-level instructions");
      expect(result).not.toContain(`You are working on the project "my-app"`);
    });
  });

  describe("generateOrchestratorPrompt systemInstructionsOverride", () => {
    it("uses default text when override is undefined", () => {
      const result = generateOrchestratorPrompt(
        { epicId: "e1", title: "Auth" },
        workspace,
      );
      expect(result).toContain(`You are working on the project "my-app"`);
    });

    it("replaces entire template with override when provided", () => {
      const result = generateOrchestratorPrompt(
        { epicId: "e1", title: "Auth" },
        workspace,
        "Custom orchestrator instructions",
      );
      expect(result).toContain("Custom orchestrator instructions");
      expect(result).not.toContain(`You are working on the project "my-app"`);
    });

    it("still appends dynamic entity context when override is provided", () => {
      const result = generateOrchestratorPrompt(
        { epicId: "e1", title: "Auth" },
        workspace,
        "Custom orchestrator instructions",
      );
      expect(result).toContain("Auth");
    });
  });

  describe("generateFocusedPrompt systemInstructionsOverride", () => {
    it("uses default text when override is undefined", () => {
      const result = generateFocusedPrompt(
        { taskId: "b1", title: "Task" },
        workspace,
      );
      expect(result).toContain(`You are working on the project "my-app"`);
    });

    it("replaces entire template with override when provided", () => {
      const result = generateFocusedPrompt(
        { taskId: "b1", title: "Task" },
        workspace,
        "Custom focused instructions",
      );
      expect(result).toContain("Custom focused instructions");
      expect(result).not.toContain(`You are working on the project "my-app"`);
    });

    it("still appends dynamic entity context when override is provided", () => {
      const result = generateFocusedPrompt(
        { taskId: "b1", title: "Task" },
        workspace,
        "Custom focused instructions",
      );
      expect(result).toContain("Task");
    });
  });

  describe("generateRepoSessionPrompt systemInstructionsOverride", () => {
    it("uses default text when override is undefined", () => {
      const result = generateRepoSessionPrompt(workspace);
      expect(result).toContain(`You are an AI assistant attached to the repo "my-app"`);
    });

    it("replaces entire template with override when provided", () => {
      const result = generateRepoSessionPrompt(workspace, "Custom rig instructions");
      expect(result).toContain("Custom rig instructions");
      expect(result).not.toContain(`You are an AI assistant attached to the repo "my-app"`);
    });

    it("substitutes {repoName} placeholder in override", () => {
      const result = generateRepoSessionPrompt(workspace, "Assistant for {repoName}");
      expect(result).toContain("Assistant for my-app");
    });
  });
});
