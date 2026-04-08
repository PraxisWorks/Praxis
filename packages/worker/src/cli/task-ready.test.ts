import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { taskReady } from "./task-ready.js";

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
  inArray: (col: unknown, vals: unknown) => ({ col, vals }),
  sql: {},
}));

vi.mock("drizzle-orm/postgres-js", () => ({
  drizzle: () => mockDb,
}));

const mockEnd = vi.fn().mockResolvedValue(undefined);
vi.mock("postgres", () => ({
  default: () => {
    const sql = Object.assign(() => {}, { end: mockEnd });
    return sql;
  },
}));

vi.mock("@praxis2/api/schema", () => ({
  tasks: { taskId: "tasks.taskId", id: "tasks.id", parentId: "tasks.parentId" },
  taskDependencies: { taskId: "task_dependencies.taskId", dependsOnId: "task_dependencies.dependsOnId" },
}));

let mockDb: {
  select: ReturnType<typeof vi.fn>;
};

function makeSelectChain(results: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockImplementation(() => Promise.resolve(results));
  chain.then = (fn: (v: unknown) => unknown) => Promise.resolve(results).then(fn);
  return chain;
}

describe("taskReady", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgres://test:test@localhost/test");
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("exits with error when no --parent provided", async () => {
    mockDb = { select: vi.fn() };
    await expect(taskReady([])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("shows ready tasks with no dependencies", async () => {
    const selectResults = [
      // parent lookup
      [{ id: "uuid-epic" }],
      // children lookup
      [
        { id: "uuid-1", taskId: "TST-001", title: "Task 1", status: "draft", priority: "high" },
        { id: "uuid-2", taskId: "TST-002", title: "Task 2", status: "complete", priority: "medium" },
      ],
      // deps for TST-001
      [],
    ];
    mockDb = {
      select: vi.fn().mockImplementation(() => makeSelectChain(selectResults.shift() ?? [])),
    };

    await taskReady(["--parent", "TST-e1"]);

    // Only TST-001 is actionable (draft), TST-002 is complete so not actionable
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("TST-001"));
  });

  it("filters out tasks with unresolved dependencies", async () => {
    const selectResults = [
      // parent lookup
      [{ id: "uuid-epic" }],
      // children lookup — both draft
      [
        { id: "uuid-1", taskId: "TST-001", title: "Task 1", status: "draft", priority: "high" },
        { id: "uuid-2", taskId: "TST-002", title: "Task 2", status: "draft", priority: "medium" },
      ],
      // deps for TST-001: no deps → ready
      [],
      // deps for TST-002: depends on TST-001
      [{ dependsOnId: "uuid-1" }],
      // blocker status lookup for TST-002's dep
      [{ id: "uuid-1", status: "draft" }],
    ];
    mockDb = {
      select: vi.fn().mockImplementation(() => makeSelectChain(selectResults.shift() ?? [])),
    };

    await taskReady(["--parent", "TST-e1"]);

    // TST-001 should be ready (no deps), TST-002 blocked by TST-001 (draft)
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("TST-001"));
    // TST-002 should NOT be in the output (blocked)
    const allCalls = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    // Header contains TST-001 but the data rows should only show TST-001
    const dataLines = allCalls.split("\n").filter((l: string) => l.includes("TST-"));
    expect(dataLines.some((l: string) => l.includes("TST-001"))).toBe(true);
    expect(dataLines.some((l: string) => l.includes("TST-002"))).toBe(false);
  });

  it("prints message when no ready tasks found", async () => {
    const selectResults = [
      [{ id: "uuid-epic" }],
      // all children are complete
      [
        { id: "uuid-1", taskId: "TST-001", title: "Task 1", status: "complete", priority: "high" },
      ],
    ];
    mockDb = {
      select: vi.fn().mockImplementation(() => makeSelectChain(selectResults.shift() ?? [])),
    };

    await taskReady(["--parent", "TST-e1"]);

    expect(consoleSpy).toHaveBeenCalledWith("No ready tasks found.");
  });
});
