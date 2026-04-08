import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { epicComplete } from "./epic-complete.js";

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
  and: (...args: unknown[]) => args,
}));

vi.mock("drizzle-orm/postgres-js", () => ({
  drizzle: () => mockDb,
}));

const mockSqlTagFn = vi.fn().mockResolvedValue(undefined);
const mockEnd = vi.fn().mockResolvedValue(undefined);
vi.mock("postgres", () => ({
  default: () => {
    const sql = Object.assign(mockSqlTagFn, { end: mockEnd });
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

const mockPropagateCompleteUp = vi.fn().mockResolvedValue(undefined);
vi.mock("@praxis2/api/lib/propagateTaskStatus", () => ({
  propagateCompleteUp: (...args: unknown[]) =>
    mockPropagateCompleteUp(...args),
}));

vi.mock("@praxis2/api/schema", () => ({
  tasks: {
    taskId: "tasks.taskId",
    id: "tasks.id",
    parentId: "tasks.parentId",
    isEpic: "tasks.isEpic",
  },
  rigs: { id: "rigs.id" },
  notifications: "notifications",
  sessionMessages: "sessionMessages",
}));

let mockInsertValues = vi.fn().mockResolvedValue(undefined);

let mockDb: {
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
};

function makeSelectChain(results: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockImplementation(() => Promise.resolve(results));
  chain.then = (fn: (v: unknown) => unknown) => Promise.resolve(results).then(fn);
  return chain;
}

function makeUpdateChain() {
  const chain: Record<string, unknown> = {};
  chain.set = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockResolvedValue(undefined);
  return chain;
}

function makeInsertChain() {
  const chain: Record<string, unknown> = {};
  chain.values = mockInsertValues;
  return chain;
}

function buildMockDb(selectResults: unknown[][]) {
  mockInsertValues = vi.fn().mockResolvedValue(undefined);
  mockDb = {
    select: vi
      .fn()
      .mockImplementation(() =>
        makeSelectChain(selectResults.shift() ?? []),
      ),
    update: vi.fn().mockImplementation(() => makeUpdateChain()),
    insert: vi.fn().mockImplementation(() => makeInsertChain()),
  };
}

const epicRow = {
  id: "uuid-epic",
  taskId: "EPIC-1",
  isEpic: true,
  title: "Test Epic",
  repoId: "repo-1",
  status: "approved",
};
const childrenAllComplete = [{ status: "complete", taskId: "B1" }];
const repoRow = { id: "repo-1", name: "test-repo", userId: "user-1" };

describe("epicComplete", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgres://test:test@localhost/test");
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => {
        throw new Error("process.exit");
      });
    mockSqlTagFn.mockClear();
    mockEnd.mockClear();
    mockPropagateCompleteUp.mockClear();
    mockPubsub.publish.mockClear();
    mockPubsub.close.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("inserts session_messages row with system role when PX_SESSION_ID is set", async () => {
    vi.stubEnv("PX_SESSION_ID", "session-123");
    buildMockDb([[epicRow], childrenAllComplete, [repoRow]]);

    await epicComplete(["EPIC-1"]);

    // insert is called for notifications (first) and sessionMessages (second)
    const insertCalls = mockDb.insert.mock.calls;
    expect(insertCalls.length).toBe(2);
    expect(insertCalls[1][0]).toBe("sessionMessages");

    // Check the values passed to sessionMessages insert
    const valuesCall = mockInsertValues.mock.calls[1];
    expect(valuesCall[0]).toEqual(
      expect.objectContaining({
        sessionId: "session-123",
        role: "system",
      }),
    );
  });

  it("inserts pgboss job for session.message queue when PX_SESSION_ID is set", async () => {
    vi.stubEnv("PX_SESSION_ID", "session-123");
    buildMockDb([[epicRow], childrenAllComplete, [repoRow]]);

    await epicComplete(["EPIC-1"]);

    // The sql template tag should have been called for the pgboss INSERT
    expect(mockSqlTagFn).toHaveBeenCalled();
    // Template tag is called with (templateStrings[], ...interpolatedValues)
    const call = mockSqlTagFn.mock.calls[0];
    const templateParts = call[0] as string[];
    const joined = templateParts.join("???");
    expect(joined).toContain("INSERT INTO pgboss.job");
    // "session.message" is an interpolated value, check it in the arguments
    expect(call[1]).toBe("session.message");
  });

  it("does not create session message or job when PX_SESSION_ID is not set", async () => {
    // Explicitly ensure PX_SESSION_ID is not set
    delete process.env.PX_SESSION_ID;
    buildMockDb([[epicRow], childrenAllComplete, [repoRow]]);

    await epicComplete(["EPIC-1"]);

    // insert should only be called once (for notifications)
    const insertTables = mockDb.insert.mock.calls.map(
      (c: unknown[]) => c[0],
    );
    expect(insertTables).toEqual(["notifications"]);

    // sql template tag should NOT be called for pgboss insert
    expect(mockSqlTagFn).not.toHaveBeenCalled();
  });

  it("merge instruction content includes required commands", async () => {
    vi.stubEnv("PX_SESSION_ID", "session-123");
    buildMockDb([[epicRow], childrenAllComplete, [repoRow]]);

    await epicComplete(["EPIC-1"]);

    // Get the content from the sessionMessages insert
    const valuesCall = mockInsertValues.mock.calls[1];
    const content = valuesCall[0].content as string;

    expect(content).toContain("gh pr create");
    expect(content).toContain("gh pr merge");
    expect(content).toContain("Do NOT wait for human review");
  });

  it("logs confirmation when session message is enqueued", async () => {
    vi.stubEnv("PX_SESSION_ID", "session-123");
    buildMockDb([[epicRow], childrenAllComplete, [repoRow]]);

    await epicComplete(["EPIC-1"]);

    expect(consoleSpy).toHaveBeenCalledWith(
      "OK: enqueued session.message for session session-123",
    );
  });

  describe("propagation", () => {
    const repoRowProp = { id: "repo-1", name: "test-repo", userId: "user-1" };
    const childrenComplete = [{ status: "complete", taskId: "B1" }];

    it("calls propagateCompleteUp when epic has parentId", async () => {
      const epicWithParent = {
        id: "uuid-epic",
        taskId: "EPIC-P",
        isEpic: true,
        title: "Test Epic",
        repoId: "repo-1",
        status: "approved",
        parentId: "parent-uuid",
        ideaId: "idea-uuid",
      };
      buildMockDb([[epicWithParent], childrenComplete, [repoRowProp]]);

      await epicComplete(["EPIC-P"]);

      expect(mockPropagateCompleteUp).toHaveBeenCalledOnce();
      expect(mockPropagateCompleteUp).toHaveBeenCalledWith(
        mockDb,
        mockPubsub,
        "parent-uuid",
        "idea-uuid",
        expect.any(Object),
      );
    });

    it("calls propagateCompleteUp with null parentId when epic is top-level with ideaId", async () => {
      const epicTopLevel = {
        id: "uuid-epic",
        taskId: "EPIC-T",
        isEpic: true,
        title: "Test Epic",
        repoId: "repo-1",
        status: "approved",
        parentId: null,
        ideaId: "idea-uuid",
      };
      buildMockDb([[epicTopLevel], childrenComplete, [repoRowProp]]);

      await epicComplete(["EPIC-T"]);

      expect(mockPropagateCompleteUp).toHaveBeenCalledOnce();
      expect(mockPropagateCompleteUp).toHaveBeenCalledWith(
        mockDb,
        mockPubsub,
        null,
        "idea-uuid",
        expect.any(Object),
      );
    });

    it("does NOT call propagateCompleteUp when both parentId and ideaId are null", async () => {
      const epicNoIdea = {
        id: "uuid-epic",
        taskId: "EPIC-N",
        isEpic: true,
        title: "Test Epic",
        repoId: "repo-1",
        status: "approved",
        parentId: null,
        ideaId: null,
      };
      buildMockDb([[epicNoIdea], childrenComplete, [repoRowProp]]);

      await epicComplete(["EPIC-N"]);

      expect(mockPropagateCompleteUp).not.toHaveBeenCalled();
    });
  });
});
