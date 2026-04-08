import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
  and: (...args: unknown[]) => args,
}));

vi.mock("drizzle-orm/postgres-js", () => ({
  drizzle: () => mockDb,
}));

const mockEnd = vi.fn().mockResolvedValue(undefined);
vi.mock("postgres", () => ({
  default: () => {
    const sql = Object.assign(vi.fn().mockResolvedValue(undefined), {
      end: mockEnd,
    });
    return sql;
  },
}));

const mockPublish = vi.fn().mockResolvedValue(undefined);
const mockClose = vi.fn().mockResolvedValue(undefined);
vi.mock("@praxis2/shared", () => ({
  PgPubSub: vi.fn(() => ({
    publish: mockPublish,
    close: mockClose,
  })),
  syncChannel: (entity: string) => `sync:${entity}`,
}));

vi.mock("@praxis2/api/schema", () => ({
  tasks: {
    taskId: "tasks.taskId",
    id: "tasks.id",
    parentId: "tasks.parentId",
    ideaId: "tasks.ideaId",
  },
  ideas: { id: "ideas.id", status: "ideas.status" },
}));

const mockPropagateInProgressUp = vi.fn().mockResolvedValue(undefined);
vi.mock("@praxis2/api/lib/propagateTaskStatus", () => ({
  propagateInProgressUp: (...args: unknown[]) =>
    mockPropagateInProgressUp(...args),
}));

let updateCallCount = 0;
let selectResults: unknown[][] = [];

let mockDb: {
  update: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
};

function buildMockDb(
  taskRow: Record<string, unknown>,
  ideaRows: unknown[] = [],
) {
  updateCallCount = 0;
  selectResults = [ideaRows];

  mockDb = {
    update: vi.fn().mockImplementation(() => {
      updateCallCount++;
      if (updateCallCount === 1) {
        // First update = task status
        return {
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([taskRow]),
            }),
          }),
        };
      }
      // Subsequent updates = idea status
      return {
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      };
    }),
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(selectResults.shift() ?? []),
        }),
      }),
    })),
  };
}

describe("taskStart", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgres://test:test@localhost/test");
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    mockEnd.mockClear();
    mockPublish.mockClear();
    mockClose.mockClear();
    mockPropagateInProgressUp.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("calls propagateInProgressUp when task has parentId", async () => {
    const taskRow = {
      taskId: "task-1",
      parentId: "parent-uuid",
      ideaId: "idea-uuid",
      status: "in_progress",
    };
    buildMockDb(taskRow);

    const { taskStart } = await import("./task-start.js");
    await taskStart(["task-1"]);

    expect(mockPropagateInProgressUp).toHaveBeenCalledTimes(1);
    // Args: db, pubsub, parentId, ideaId
    const args = mockPropagateInProgressUp.mock.calls[0];
    expect(args[0]).toBe(mockDb); // db
    // args[1] is the pubsub instance
    expect(args[2]).toBe("parent-uuid"); // parentId
    expect(args[3]).toBe("idea-uuid"); // ideaId
  });

  it("updates idea directly when task is top-level (no parentId, has ideaId)", async () => {
    const taskRow = {
      taskId: "task-2",
      parentId: null,
      ideaId: "idea-uuid",
      status: "in_progress",
    };
    const ideaRow = { id: "idea-uuid", status: "planned" };
    buildMockDb(taskRow, [ideaRow]);

    const { taskStart } = await import("./task-start.js");
    await taskStart(["task-2"]);

    // propagateInProgressUp should NOT be called (no parentId)
    expect(mockPropagateInProgressUp).not.toHaveBeenCalled();

    // db.update should be called twice: once for task, once for idea
    expect(mockDb.update).toHaveBeenCalledTimes(2);

    // pubsub.publish should be called with sync:idea
    expect(mockPublish).toHaveBeenCalledWith(
      "sync:idea",
      expect.objectContaining({
        action: "updated",
        data: { id: "idea-uuid", status: "in_progress" },
      }),
    );
  });

  it("does NOT update idea when already in_progress", async () => {
    const taskRow = {
      taskId: "task-3",
      parentId: null,
      ideaId: "idea-uuid",
      status: "in_progress",
    };
    const ideaRow = { id: "idea-uuid", status: "in_progress" };
    buildMockDb(taskRow, [ideaRow]);

    const { taskStart } = await import("./task-start.js");
    await taskStart(["task-3"]);

    // db.update should be called only once (for the task)
    expect(mockDb.update).toHaveBeenCalledTimes(1);

    // pubsub.publish should only be called once (for the task sync)
    // and NOT with sync:idea
    const ideaPublishCalls = mockPublish.mock.calls.filter(
      (call: unknown[]) => call[0] === "sync:idea",
    );
    expect(ideaPublishCalls).toHaveLength(0);
  });

  it("does NOT error when ideaId is null", async () => {
    const taskRow = {
      taskId: "task-4",
      parentId: null,
      ideaId: null,
      status: "in_progress",
    };
    buildMockDb(taskRow);

    const { taskStart } = await import("./task-start.js");
    await taskStart(["task-4"]);

    // No propagation calls
    expect(mockPropagateInProgressUp).not.toHaveBeenCalled();
    // db.update only called once (task)
    expect(mockDb.update).toHaveBeenCalledTimes(1);
    // Should still print OK
    expect(consoleSpy).toHaveBeenCalledWith("OK: task task-4 → in_progress");
  });

  it("prints OK message after propagation", async () => {
    const taskRow = {
      taskId: "task-5",
      parentId: "parent-uuid",
      ideaId: "idea-uuid",
      status: "in_progress",
    };
    buildMockDb(taskRow);

    const { taskStart } = await import("./task-start.js");
    await taskStart(["task-5"]);

    expect(consoleSpy).toHaveBeenCalledWith("OK: task task-5 → in_progress");
  });
});
