import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { taskList } from "./task-list.js";

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
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

describe("taskList", () => {
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
    await expect(taskList([])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("lists child tasks when parent found", async () => {
    const selectResults = [
      // parent lookup
      [{ id: "uuid-epic" }],
      // children lookup
      [
        { taskId: "TST-001", title: "Task 1", status: "draft", priority: "high" },
        { taskId: "TST-002", title: "Task 2", status: "in_progress", priority: "medium" },
      ],
    ];
    mockDb = {
      select: vi.fn().mockImplementation(() => makeSelectChain(selectResults.shift() ?? [])),
    };

    await taskList(["--parent", "TST-e1"]);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("TST-001"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("TST-002"));
  });

  it("prints message when no children found", async () => {
    const selectResults = [
      [{ id: "uuid-epic" }],
      [],
    ];
    mockDb = {
      select: vi.fn().mockImplementation(() => makeSelectChain(selectResults.shift() ?? [])),
    };

    await taskList(["--parent", "TST-e1"]);

    expect(consoleSpy).toHaveBeenCalledWith("No child tasks found.");
  });
});
