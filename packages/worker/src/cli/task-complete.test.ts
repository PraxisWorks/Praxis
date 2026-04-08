import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { taskComplete } from "./task-complete.js";

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

const mockPubsub = {
  publish: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@praxis2/shared", () => ({
  PgPubSub: vi.fn(() => mockPubsub),
  syncChannel: (entity: string) => `sync:${entity}`,
}));

vi.mock("@praxis2/api/schema", () => ({
  tasks: {
    taskId: "tasks.taskId",
    id: "tasks.id",
    parentId: "tasks.parentId",
    ideaId: "tasks.ideaId",
    status: "tasks.status",
  },
  ideas: { id: "ideas.id", status: "ideas.status" },
}));

const mockPropagateCompleteUp = vi.fn().mockResolvedValue(undefined);
vi.mock("@praxis2/api/lib/propagateTaskStatus", () => ({
  propagateCompleteUp: (...args: unknown[]) =>
    mockPropagateCompleteUp(...args),
}));

let mockDb: {
  update: ReturnType<typeof vi.fn>;
};

function buildMockDb(returningRows: unknown[]) {
  mockDb = {
    update: vi.fn().mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      chain.set = vi.fn().mockReturnValue(chain);
      chain.where = vi.fn().mockReturnValue(chain);
      chain.returning = vi.fn().mockResolvedValue(returningRows);
      return chain;
    }),
  };
}

describe("taskComplete", () => {
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
    mockPropagateCompleteUp.mockClear();
    mockPubsub.publish.mockClear();
    mockPubsub.close.mockClear();
    mockEnd.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe("propagation", () => {
    it("calls propagateCompleteUp with parentId when task has parent", async () => {
      buildMockDb([
        {
          id: "uuid-task",
          taskId: "B-1",
          parentId: "parent-uuid",
          ideaId: "idea-uuid",
          status: "complete",
        },
      ]);

      await taskComplete(["B-1"]);

      expect(mockPropagateCompleteUp).toHaveBeenCalledOnce();
      expect(mockPropagateCompleteUp).toHaveBeenCalledWith(
        mockDb,
        mockPubsub,
        "parent-uuid",
        "idea-uuid",
        expect.any(Object),
      );
    });

    it("calls propagateCompleteUp with null parentId when task is top-level", async () => {
      buildMockDb([
        {
          id: "uuid-task",
          taskId: "B-2",
          parentId: null,
          ideaId: "idea-uuid",
          status: "complete",
        },
      ]);

      await taskComplete(["B-2"]);

      expect(mockPropagateCompleteUp).toHaveBeenCalledOnce();
      expect(mockPropagateCompleteUp).toHaveBeenCalledWith(
        mockDb,
        mockPubsub,
        null,
        "idea-uuid",
        expect.any(Object),
      );
    });

    it("does NOT call propagateCompleteUp when ideaId is null", async () => {
      buildMockDb([
        {
          id: "uuid-task",
          taskId: "B-3",
          parentId: null,
          ideaId: null,
          status: "complete",
        },
      ]);

      await taskComplete(["B-3"]);

      expect(mockPropagateCompleteUp).not.toHaveBeenCalled();
    });

    it("still prints OK message after propagation", async () => {
      buildMockDb([
        {
          id: "uuid-task",
          taskId: "B-4",
          parentId: "parent-uuid",
          ideaId: "idea-uuid",
          status: "complete",
        },
      ]);

      await taskComplete(["B-4"]);

      expect(consoleSpy).toHaveBeenCalledWith("OK: task B-4 \u2192 complete");
    });
  });
});
