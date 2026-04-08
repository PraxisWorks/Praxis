import { describe, it, expect } from "vitest";
import {
  ProposalTaskSchema,
  ProposalEpicSchema,
  ProposalSchema,
  CreatePlanSchema,
  PlanStatusSchema,
} from "./plan.js";

describe("PlanStatusSchema", () => {
  it("accepts valid statuses", () => {
    expect(PlanStatusSchema.parse("draft")).toBe("draft");
    expect(PlanStatusSchema.parse("accepted")).toBe("accepted");
    expect(PlanStatusSchema.parse("rejected")).toBe("rejected");
  });

  it("rejects invalid status", () => {
    expect(() => PlanStatusSchema.parse("pending")).toThrow();
  });
});

describe("ProposalTaskSchema", () => {
  it("validates a minimal task", () => {
    const result = ProposalTaskSchema.parse({
      key: "b1",
      title: "Setup database",
      description: "Create the initial DB schema",
      priority: "high",
    });
    expect(result.dependsOn).toEqual([]); // default
  });

  it("validates task with dependencies", () => {
    const result = ProposalTaskSchema.parse({
      key: "b2",
      title: "Add API routes",
      description: "Create tRPC router",
      priority: "medium",
      dependsOn: ["b1"],
    });
    expect(result.dependsOn).toEqual(["b1"]);
  });

  it("rejects empty title", () => {
    expect(() =>
      ProposalTaskSchema.parse({
        key: "b1",
        title: "",
        description: "desc",
        priority: "low",
      }),
    ).toThrow();
  });

  it("rejects invalid priority", () => {
    expect(() =>
      ProposalTaskSchema.parse({
        key: "b1",
        title: "t",
        description: "d",
        priority: "critical",
      }),
    ).toThrow();
  });
});

describe("ProposalEpicSchema", () => {
  it("validates epic with tasks", () => {
    const result = ProposalEpicSchema.parse({
      key: "e1",
      title: "Backend",
      description: "All backend work",
      tasks: [
        { key: "b1", title: "Schema", description: "DB schema", priority: "high" },
      ],
    });
    expect(result.tasks).toHaveLength(1);
  });

  it("rejects epic with zero tasks", () => {
    expect(() =>
      ProposalEpicSchema.parse({
        key: "e1",
        title: "Empty",
        description: "No tasks",
        tasks: [],
      }),
    ).toThrow();
  });
});

describe("ProposalSchema", () => {
  it("validates a full proposal", () => {
    const result = ProposalSchema.parse({
      epics: [
        {
          key: "e1",
          title: "Backend",
          description: "Server work",
          tasks: [
            { key: "b1", title: "Schema", description: "DB", priority: "high" },
            { key: "b2", title: "Router", description: "API", priority: "medium", dependsOn: ["b1"] },
          ],
        },
        {
          key: "e2",
          title: "Frontend",
          description: "UI work",
          tasks: [
            { key: "b3", title: "View", description: "Page", priority: "medium", dependsOn: ["b2"] },
          ],
        },
      ],
    });
    expect(result.epics).toHaveLength(2);
  });

  it("rejects proposal with zero epics", () => {
    expect(() => ProposalSchema.parse({ epics: [] })).toThrow();
  });
});

describe("CreatePlanSchema", () => {
  it("validates a full create plan input", () => {
    const result = CreatePlanSchema.parse({
      ideaId: "550e8400-e29b-41d4-a716-446655440000",
      repoId: "660e8400-e29b-41d4-a716-446655440001",
      sessionId: "770e8400-e29b-41d4-a716-446655440002",
      proposal: {
        epics: [
          {
            key: "e1",
            title: "Epic",
            description: "Desc",
            tasks: [{ key: "b1", title: "Task", description: "D", priority: "low" }],
          },
        ],
      },
    });
    expect(result.ideaId).toBeDefined();
  });

  it("rejects non-uuid ideaId", () => {
    expect(() =>
      CreatePlanSchema.parse({
        ideaId: "not-a-uuid",
        repoId: "660e8400-e29b-41d4-a716-446655440001",
        sessionId: "770e8400-e29b-41d4-a716-446655440002",
        proposal: {
          epics: [
            {
              key: "e1",
              title: "E",
              description: "D",
              tasks: [{ key: "b1", title: "B", description: "D", priority: "low" }],
            },
          ],
        },
      }),
    ).toThrow();
  });
});
