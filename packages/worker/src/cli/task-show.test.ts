import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { taskShow } from "./task-show.js";

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
  taskDependencies: { taskId: "task_dependencies.taskId" },
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

describe("taskShow", () => {
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

  it("exits with error when no taskId provided", async () => {
    mockDb = { select: vi.fn() };
    await expect(taskShow([])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("prints task details when found", async () => {
    const selectResults = [
      // task lookup
      [{ id: "uuid-1", taskId: "TST-001", title: "Fix login", status: "draft", priority: "high", isEpic: false, description: "Fix the login page", parentId: null }],
      // deps lookup
      [],
    ];
    mockDb = {
      select: vi.fn().mockImplementation(() => makeSelectChain(selectResults.shift() ?? [])),
    };

    await taskShow(["TST-001"]);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("TST-001"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Fix login"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("draft"));
  });

  it("exits with error when task not found", async () => {
    mockDb = {
      select: vi.fn().mockImplementation(() => makeSelectChain([])),
    };

    await expect(taskShow(["NOPE"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
