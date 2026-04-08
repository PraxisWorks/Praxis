import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { planCreate } from "./plan-create.js";

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
  and: (...args: unknown[]) => args,
  ne: (col: unknown, val: unknown) => ({ col, val, op: "ne" }),
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
  ProposalSchema: {
    safeParse: (data: unknown) => ({ success: true, data }),
  },
}));

vi.mock("@praxis2/api/schema", () => ({
  plans: {
    id: "plans.id",
    ideaId: "plans.ideaId",
    status: "plans.status",
  },
  ideas: { id: "ideas.id" },
  sessionMessages: { id: "session_messages.id" },
  tasks: { id: "tasks.id" },
  taskDependencies: { id: "task_dependencies.id" },
  rigs: { id: "rigs.id" },
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn().mockReturnValue(
    JSON.stringify({
      epics: [
        {
          key: "e1",
          title: "Epic 1",
          description: "Desc",
          tasks: [
            { key: "b1", title: "Task 1", description: "Desc", priority: "high", dependsOn: [] },
          ],
        },
      ],
    }),
  ),
}));

let selectResults: unknown[][];
let mockDb: Record<string, ReturnType<typeof vi.fn>>;
let txInsertCalls: { table: unknown; values: unknown }[];
let txUpdateCalls: { table: unknown; set: unknown; where: unknown }[];

function buildMockTx() {
  let taskInsertCounter = 0;
  txInsertCalls = [];
  txUpdateCalls = [];

  return {
    insert: vi.fn().mockImplementation((table: unknown) => {
      const chain: Record<string, unknown> = {};
      chain.values = vi.fn().mockImplementation((vals: unknown) => {
        txInsertCalls.push({ table, values: vals });
        const valuesChain: Record<string, unknown> = {};
        const id = `task-uuid-${taskInsertCounter++}`;
        valuesChain.returning = vi.fn().mockResolvedValue([{ id, ...(vals as object) }]);
        return valuesChain;
      });
      return chain;
    }),
    update: vi.fn().mockImplementation((table: unknown) => {
      const chain: Record<string, unknown> = {};
      chain.set = vi.fn().mockImplementation((setVal: unknown) => {
        const setChain: Record<string, unknown> = {};
        setChain.where = vi.fn().mockImplementation((whereVal: unknown) => {
          txUpdateCalls.push({ table, set: setVal, where: whereVal });
          return Promise.resolve(undefined);
        });
        return setChain;
      });
      return chain;
    }),
  };
}

function buildMockDb(opts?: { withTransaction?: boolean }) {
  const results = [...selectResults];

  mockDb = {
    select: vi.fn().mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      chain.from = vi.fn().mockReturnValue(chain);
      chain.where = vi.fn().mockReturnValue(chain);
      chain.limit = vi.fn().mockImplementation(() => Promise.resolve(results.shift() ?? []));
      return chain;
    }),
    insert: vi.fn().mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      chain.values = vi.fn().mockImplementation(() => {
        const valuesChain: Record<string, unknown> = {};
        valuesChain.returning = vi.fn().mockResolvedValue([{ id: "new-plan-id" }]);
        return valuesChain;
      });
      return chain;
    }),
    update: vi.fn().mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      chain.set = vi.fn().mockReturnValue(chain);
      chain.where = vi.fn().mockResolvedValue(undefined);
      return chain;
    }),
  };

  if (opts?.withTransaction) {
    mockDb.transaction = vi.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = buildMockTx();
      return fn(tx);
    });
  }
}

describe("planCreate", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgres://test:test@localhost/test");
    vi.stubEnv("PX_REPO_ID", "repo-123");
    vi.stubEnv("PX_SESSION_ID", "session-123");
    vi.stubEnv("PX_IDEA_ID", "idea-123");
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        epics: [
          {
            key: "e1",
            title: "Epic 1",
            description: "Desc",
            tasks: [
              { key: "b1", title: "Task 1", description: "Desc", priority: "high", dependsOn: [] },
            ],
          },
        ],
      }),
    );
    mockPubsub.publish.mockClear();
    mockPubsub.close.mockClear();
    mockEnd.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("first call inserts a new plan as draft", async () => {
    selectResults = [[]]; // no existing plan
    buildMockDb();

    await planCreate(["-f", "proposal.json"]);

    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.update).toHaveBeenCalled(); // ideas status update
    expect(consoleSpy).toHaveBeenCalledWith("OK: plan created (1 epics, 1 tasks)");
  });

  it("second call with same ideaId updates the existing plan", async () => {
    selectResults = [[{ id: "existing-plan-id", ideaId: "idea-123", status: "draft" }]];
    buildMockDb();

    await planCreate(["-f", "proposal.json"]);

    // update called twice: once for plan update, once for idea status update
    expect(mockDb.update).toHaveBeenCalledTimes(2);
    // insert called once: only the session message insert
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith("OK: plan updated (1 epics, 1 tasks)");
  });

  it("a rejected plan allows re-insert", async () => {
    selectResults = [[]]; // ne(status, "rejected") filters out the rejected plan, so empty result
    buildMockDb();

    await planCreate(["-f", "proposal.json"]);

    // insert called twice: once for new plan, once for session message
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
    expect(consoleSpy).toHaveBeenCalledWith("OK: plan created (1 epics, 1 tasks)");
  });

  it('publishes sync event with action "created" for new plan', async () => {
    selectResults = [[]];
    buildMockDb();

    await planCreate(["-f", "proposal.json"]);

    expect(mockPubsub.publish).toHaveBeenCalledWith("sync:plan", {
      action: "created",
      data: { ideaId: "idea-123", repoId: "repo-123" },
      timestamp: expect.any(Number),
    });
  });

  it('publishes sync event with action "updated" for upsert', async () => {
    selectResults = [[{ id: "existing-plan-id", ideaId: "idea-123", status: "draft" }]];
    buildMockDb();

    await planCreate(["-f", "proposal.json"]);

    expect(mockPubsub.publish).toHaveBeenCalledWith("sync:plan", {
      action: "updated",
      data: { ideaId: "idea-123", repoId: "repo-123" },
      timestamp: expect.any(Number),
    });
  });

  it("cleans up connections in finally block", async () => {
    selectResults = [[]];
    buildMockDb();

    await planCreate(["-f", "proposal.json"]);

    expect(mockPubsub.close).toHaveBeenCalledOnce();
    expect(mockEnd).toHaveBeenCalledOnce();
  });

  describe("auto-accept (PX_AUTO_ACCEPT=true)", () => {
    const proposalWithDeps = {
      epics: [
        {
          key: "e1",
          title: "Epic 1",
          description: "Desc",
          tasks: [
            { key: "b1", title: "Task 1", description: "D", priority: "high", dependsOn: [] },
            { key: "b2", title: "Task 2", description: "D", priority: "medium", dependsOn: ["b1"] },
          ],
        },
      ],
    };

    it("creates tasks, dependencies, and updates statuses when PX_AUTO_ACCEPT=true", async () => {
      vi.stubEnv("PX_AUTO_ACCEPT", "true");
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(proposalWithDeps));

      // selectResults order:
      // 1. existing plan check (none)
      // 2. repo lookup for autoAcceptPlan
      // 3. idea lookup for autoAcceptPlan
      selectResults = [
        [],
        [{ id: "repo-123", bdPrefix: "TST" }],
        [{ id: "idea-123", title: "Test Idea", description: "Test Desc" }],
      ];
      buildMockDb({ withTransaction: true });

      await planCreate(["-f", "proposal.json"]);

      // Transaction was called
      expect(mockDb.transaction).toHaveBeenCalledOnce();

      // 5 tx inserts: 1 parent epic + 1 sub-epic + 2 leaf tasks + 1 dependency
      expect(txInsertCalls).toHaveLength(5);

      // Parent epic (first insert) uses idea title/description
      expect(txInsertCalls[0].values).toEqual(
        expect.objectContaining({
          repoId: "repo-123",
          ideaId: "idea-123",
          title: "Test Idea",
          description: "Test Desc",
          isEpic: true,
        }),
      );

      // Sub-epic (second insert) has parentId pointing to parent epic
      expect(txInsertCalls[1].values).toEqual(
        expect.objectContaining({
          parentId: "task-uuid-0", // parent epic id
          title: "Epic 1",
          isEpic: true,
        }),
      );

      // Leaf task b1 (third insert) has parentId pointing to sub-epic
      expect(txInsertCalls[2].values).toEqual(
        expect.objectContaining({
          parentId: "task-uuid-1", // sub-epic id
          title: "Task 1",
          isEpic: false,
          priority: "high",
        }),
      );

      // Leaf task b2 (fourth insert) has parentId pointing to sub-epic
      expect(txInsertCalls[3].values).toEqual(
        expect.objectContaining({
          parentId: "task-uuid-1", // sub-epic id
          title: "Task 2",
          isEpic: false,
          priority: "medium",
        }),
      );

      // Dependency insert: b2 depends on b1
      // b1 = task-uuid-2, b2 = task-uuid-3 (keyed in insertion order)
      expect(txInsertCalls[4].values).toEqual({
        taskId: "task-uuid-3",
        dependsOnId: "task-uuid-2",
      });

      // 2 tx updates: plan status -> accepted, idea status -> planned
      expect(txUpdateCalls).toHaveLength(2);
      expect(txUpdateCalls[0].set).toEqual(
        expect.objectContaining({ status: "accepted" }),
      );
      expect(txUpdateCalls[1].set).toEqual(
        expect.objectContaining({ status: "planned" }),
      );

      // 3 additional sync events from autoAcceptPlan (plan, idea, task)
      expect(mockPubsub.publish).toHaveBeenCalledWith("sync:plan", {
        action: "updated",
        data: { id: "new-plan-id", status: "accepted" },
        timestamp: expect.any(Number),
      });
      expect(mockPubsub.publish).toHaveBeenCalledWith("sync:idea", {
        action: "updated",
        data: { id: "idea-123", status: "planned" },
        timestamp: expect.any(Number),
      });
      expect(mockPubsub.publish).toHaveBeenCalledWith("sync:task", {
        action: "created",
        data: { planId: "new-plan-id", count: expect.any(Number) },
        timestamp: expect.any(Number),
      });

      // Console log for auto-accept
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Auto-accepted plan"),
      );
    });

    it("without PX_AUTO_ACCEPT, plan remains in draft status", async () => {
      // PX_AUTO_ACCEPT is not set (default)
      selectResults = [[]];
      buildMockDb({ withTransaction: true });

      await planCreate(["-f", "proposal.json"]);

      // Transaction should NOT be called
      expect(mockDb.transaction).not.toHaveBeenCalled();
      // Only the standard plan creation log
      expect(consoleSpy).toHaveBeenCalledWith("OK: plan created (1 epics, 1 tasks)");
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("Auto-accepted"),
      );
    });

    it("auto-accept failure is caught and logged without throwing", async () => {
      vi.stubEnv("PX_AUTO_ACCEPT", "true");

      // selectResults: existing plan check (none), repo lookup (empty = will throw)
      selectResults = [[], []];
      buildMockDb({ withTransaction: true });

      // Should not throw even though autoAcceptPlan will fail (repo not found)
      await expect(planCreate(["-f", "proposal.json"])).resolves.toBeUndefined();

      // Standard plan creation still succeeds
      expect(consoleSpy).toHaveBeenCalledWith("OK: plan created (1 epics, 1 tasks)");
      // Error is logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Auto-accept failed"),
      );
    });
  });
});
