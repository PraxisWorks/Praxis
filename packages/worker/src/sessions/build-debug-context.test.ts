import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildDebugContext } from "./build-debug-context.js";

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock("@praxis2/api/schema", () => ({
  rigs: { id: "rigs.id" },
  specs: { repoId: "specs.repoId" },
  tasks: { id: "tasks.id" },
  plans: { ideaId: "plans.ideaId" },
  sessions: { id: "sessions.id", entityId: "sessions.entityId", type: "sessions.type", createdAt: "sessions.createdAt" },
  sessionMessages: { sessionId: "sessionMessages.sessionId", role: "sessionMessages.role", content: "sessionMessages.content", createdAt: "sessionMessages.createdAt" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
  and: (...args: unknown[]) => ({ and: args }),
  desc: (col: unknown) => ({ desc: col }),
}));

// ─── Helpers ────────────────────────────────────────────────────────

function buildMockDb(selectResults: unknown[][] = [[]]) {
  const results = [...selectResults];

  const makeSelectChain = () => {
    const resolve = () => Promise.resolve(results.shift() ?? []);
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.orderBy = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockImplementation(() => resolve());
    chain.then = (fn: (v: unknown) => unknown) => resolve().then(fn);
    return chain;
  };

  return {
    select: vi.fn().mockImplementation(() => makeSelectChain()),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("buildDebugContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes spec in system prompt when spec exists", async () => {
    const db = buildMockDb([
      // repo
      [{ name: "My Rig" }],
      // spec
      [{ content: "# Project Spec\nThis project does X." }],
      // task
      [{ id: "b1", title: "Fix login", description: "Login page broken", ideaId: null }],
      // no working sessions
      [],
    ]);

    const result = await buildDebugContext(db as any, {
      repoId: "r1",
      entityType: "task",
      entityId: "b1",
    });

    expect(result.systemPrompt).toContain("Project Spec:");
    expect(result.systemPrompt).toContain("This project does X.");
    expect(result.entityTitle).toBe("Fix login");
    expect(result.entityDescription).toBe("Login page broken");
  });

  it("includes plan content when task has ideaId with plan", async () => {
    const proposal = { epics: [{ title: "E1", tasks: [] }] };

    const db = buildMockDb([
      // repo
      [{ name: "Test Rig" }],
      // spec
      [],
      // task with ideaId
      [{ id: "b1", title: "Fix bug", description: "A bug", ideaId: "idea-1" }],
      // plan for that ideaId
      [{ proposal }],
      // working sessions
      [],
    ]);

    const result = await buildDebugContext(db as any, {
      repoId: "r1",
      entityType: "task",
      entityId: "b1",
    });

    expect(result.systemPrompt).toContain("Implementation Plan:");
    expect(result.systemPrompt).toContain("E1");
  });

  it("includes prior working session commits", async () => {
    const db = buildMockDb([
      // repo
      [{ name: "Rig" }],
      // spec
      [],
      // task
      [{ id: "b1", title: "Task", description: "Do things", ideaId: null }],
      // working sessions for this entity
      [{ id: "ws-1" }],
      // system messages from ws-1
      [{ content: "Committed: fix login form" }, { content: "Committed: add tests" }],
    ]);

    const result = await buildDebugContext(db as any, {
      repoId: "r1",
      entityType: "task",
      entityId: "b1",
    });

    expect(result.systemPrompt).toContain("Prior working session activity:");
    expect(result.systemPrompt).toContain("- Committed: fix login form");
    expect(result.systemPrompt).toContain("- Committed: add tests");
  });

  it("works without spec, plan, or prior sessions (minimal context)", async () => {
    const db = buildMockDb([
      // repo
      [{ name: "Simple Rig" }],
      // no spec
      [],
      // task with no ideaId
      [{ id: "b1", title: "Simple task", description: "Do it", ideaId: null }],
      // no working sessions
      [],
    ]);

    const result = await buildDebugContext(db as any, {
      repoId: "r1",
      entityType: "task",
      entityId: "b1",
    });

    expect(result.systemPrompt).toContain("Repo: Simple Rig");
    expect(result.systemPrompt).toContain("Task: Simple task");
    expect(result.systemPrompt).toContain("Description: Do it");
    expect(result.systemPrompt).not.toContain("Project Spec:");
    expect(result.systemPrompt).not.toContain("Implementation Plan:");
    expect(result.systemPrompt).not.toContain("Prior working session activity:");
    expect(result.entityTitle).toBe("Simple task");
    expect(result.entityDescription).toBe("Do it");
  });

  it("truncates long context to budget", async () => {
    // Create a spec that is way over the 12k budget
    const longSpec = "X".repeat(15_000);

    const db = buildMockDb([
      [{ name: "Rig" }],
      [{ content: longSpec }],
      [{ id: "b1", title: "Task", description: "Desc", ideaId: null }],
      [],
    ]);

    const result = await buildDebugContext(db as any, {
      repoId: "r1",
      entityType: "task",
      entityId: "b1",
    });

    expect(result.systemPrompt.length).toBeLessThanOrEqual(12_000);
    expect(result.systemPrompt).toMatch(/\.\.\.$/);
  });

  it("labels entity as Epic when entityType is epic", async () => {
    const db = buildMockDb([
      [{ name: "Rig" }],
      [],
      [{ id: "e1", title: "Auth Epic", description: "Auth work", ideaId: null }],
      [],
    ]);

    const result = await buildDebugContext(db as any, {
      repoId: "r1",
      entityType: "epic",
      entityId: "e1",
    });

    expect(result.systemPrompt).toContain("Epic: Auth Epic");
  });
});
