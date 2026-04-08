import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
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
  },
  rigs: {
    id: "rigs.id",
    bdPrefix: "rigs.bdPrefix",
  },
}));

const mockRandomBytes = vi.fn();
vi.mock("node:crypto", () => ({
  randomBytes: (...args: unknown[]) => mockRandomBytes(...args),
}));

let insertCallCount = 0;
let selectResults: unknown[][] = [];

let mockDb: {
  insert: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
};

function buildMockDb(opts: {
  rigRow?: Record<string, unknown> | null;
  insertResults?: Record<string, unknown>[];
  parentRow?: Record<string, unknown> | null;
}) {
  insertCallCount = 0;
  const rigRow = opts.rigRow ?? { bdPrefix: "prx" };
  const insertResults = opts.insertResults ?? [];

  // selectResults: first call is rig lookup, optional second is parent lookup
  selectResults = [];
  selectResults.push(rigRow ? [rigRow] : []);
  if (opts.parentRow !== undefined) {
    selectResults.push(opts.parentRow ? [opts.parentRow] : []);
  }

  mockDb = {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(selectResults.shift() ?? []),
        }),
      }),
    })),
    insert: vi.fn().mockImplementation(() => {
      const result = insertResults[insertCallCount] ?? {};
      insertCallCount++;
      return {
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([result]),
        }),
      };
    }),
  };
}

describe("taskCreate", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgres://test:test@localhost/test");
    vi.stubEnv("PX_REPO_ID", "rig-uuid-1");
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    mockEnd.mockClear();
    mockPublish.mockClear();
    mockClose.mockClear();
    mockRandomBytes.mockReset();
    mockRandomBytes
      .mockReturnValueOnce({ toString: () => "abc123" })
      .mockReturnValueOnce({ toString: () => "def345" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("creates a single task without --auto-epic", async () => {
    buildMockDb({
      insertResults: [
        { id: "task-uuid", taskId: "PRX-prx-abc12" },
      ],
    });

    const { taskCreate } = await import("./task-create.js");
    await taskCreate(["--title", "My task"]);

    expect(mockDb.insert).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledWith(
      "sync:task",
      expect.objectContaining({
        action: "created",
        data: { taskId: "PRX-prx-abc12", id: "task-uuid" },
      }),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("OK: created task PRX-prx-abc12"),
    );
  });

  it("errors when --title is missing", async () => {
    buildMockDb({});

    const { taskCreate } = await import("./task-create.js");
    await expect(taskCreate([])).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Usage:"),
    );
  });

  it("passes repoId (not rigId) in single task insert", async () => {
    const capturedValues: Record<string, unknown>[] = [];
    const insertResults = [{ id: "task-uuid", taskId: "PRX-prx-abc12" }];
    let callIdx = 0;

    selectResults = [[{ bdPrefix: "prx" }]];
    mockDb = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(selectResults.shift() ?? []),
          }),
        }),
      })),
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation((vals: Record<string, unknown>) => {
          capturedValues.push(vals);
          const result = insertResults[callIdx] ?? {};
          callIdx++;
          return {
            returning: vi.fn().mockResolvedValue([result]),
          };
        }),
      })),
    };

    const { taskCreate } = await import("./task-create.js");
    await taskCreate(["--title", "My task"]);

    expect(capturedValues).toHaveLength(1);
    expect(capturedValues[0].repoId).toBe("rig-uuid-1");
    expect(capturedValues[0]).not.toHaveProperty("rigId");
  });
});

describe("taskCreate --auto-epic", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgres://test:test@localhost/test");
    vi.stubEnv("PX_REPO_ID", "rig-uuid-1");
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    mockEnd.mockClear();
    mockPublish.mockClear();
    mockClose.mockClear();
    mockRandomBytes.mockReset();
    mockRandomBytes
      .mockReturnValueOnce({ toString: () => "abc123" })
      .mockReturnValueOnce({ toString: () => "def345" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("creates both an epic and a child task with --auto-epic", async () => {
    buildMockDb({
      insertResults: [
        { id: "epic-uuid", taskId: "PRX-prx-abc12" },
        { id: "child-uuid", taskId: "PRX-prx-def34" },
      ],
    });

    const { taskCreate } = await import("./task-create.js");
    await taskCreate(["--title", "My feature", "--auto-epic"]);

    expect(mockDb.insert).toHaveBeenCalledTimes(2);
  });

  it("sets child parentId to the epic's UUID", async () => {
    const capturedValues: Record<string, unknown>[] = [];
    const insertResults = [
      { id: "epic-uuid", taskId: "PRX-prx-abc12" },
      { id: "child-uuid", taskId: "PRX-prx-def34" },
    ];
    let callIdx = 0;

    // Build a custom mockDb that captures insert values
    selectResults = [[{ bdPrefix: "prx" }]];
    mockDb = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(selectResults.shift() ?? []),
          }),
        }),
      })),
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation((vals: Record<string, unknown>) => {
          capturedValues.push(vals);
          const result = insertResults[callIdx] ?? {};
          callIdx++;
          return {
            returning: vi.fn().mockResolvedValue([result]),
          };
        }),
      })),
    };

    const { taskCreate } = await import("./task-create.js");
    await taskCreate(["--title", "My feature", "--auto-epic"]);

    expect(capturedValues).toHaveLength(2);
    // First insert is the epic
    expect(capturedValues[0].isEpic).toBe(true);
    // Second insert is the child, with parentId set to the epic's UUID
    expect(capturedValues[1].parentId).toBe("epic-uuid");
    expect(capturedValues[1].isEpic).toBe(false);
  });

  it("passes repoId in both auto-epic inserts", async () => {
    const capturedValues: Record<string, unknown>[] = [];
    const insertResults = [
      { id: "epic-uuid", taskId: "PRX-prx-abc12" },
      { id: "child-uuid", taskId: "PRX-prx-def34" },
    ];
    let callIdx = 0;

    selectResults = [[{ bdPrefix: "prx" }]];
    mockDb = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(selectResults.shift() ?? []),
          }),
        }),
      })),
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation((vals: Record<string, unknown>) => {
          capturedValues.push(vals);
          const result = insertResults[callIdx] ?? {};
          callIdx++;
          return {
            returning: vi.fn().mockResolvedValue([result]),
          };
        }),
      })),
    };

    const { taskCreate } = await import("./task-create.js");
    await taskCreate(["--title", "My feature", "--auto-epic"]);

    expect(capturedValues).toHaveLength(2);
    expect(capturedValues[0].repoId).toBe("rig-uuid-1");
    expect(capturedValues[0]).not.toHaveProperty("rigId");
    expect(capturedValues[1].repoId).toBe("rig-uuid-1");
    expect(capturedValues[1]).not.toHaveProperty("rigId");
  });

  it("publishes sync events for both epic and child", async () => {
    buildMockDb({
      insertResults: [
        { id: "epic-uuid", taskId: "PRX-prx-abc12" },
        { id: "child-uuid", taskId: "PRX-prx-def34" },
      ],
    });

    const { taskCreate } = await import("./task-create.js");
    await taskCreate(["--title", "My feature", "--auto-epic"]);

    expect(mockPublish).toHaveBeenCalledTimes(2);
    expect(mockPublish).toHaveBeenCalledWith(
      "sync:task",
      expect.objectContaining({
        action: "created",
        data: { taskId: "PRX-prx-abc12", id: "epic-uuid" },
      }),
    );
    expect(mockPublish).toHaveBeenCalledWith(
      "sync:task",
      expect.objectContaining({
        action: "created",
        data: { taskId: "PRX-prx-def34", id: "child-uuid" },
      }),
    );
  });

  it("prints combined success message", async () => {
    buildMockDb({
      insertResults: [
        { id: "epic-uuid", taskId: "PRX-prx-abc12" },
        { id: "child-uuid", taskId: "PRX-prx-def34" },
      ],
    });

    const { taskCreate } = await import("./task-create.js");
    await taskCreate(["--title", "My feature", "--auto-epic"]);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("OK: created epic"),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("My feature"),
    );
  });

  it("errors when --auto-epic used with --is-epic", async () => {
    buildMockDb({});

    const { taskCreate } = await import("./task-create.js");
    await expect(
      taskCreate(["--title", "My feature", "--auto-epic", "--is-epic"]),
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Error: --auto-epic cannot be used with --is-epic or --parent-id",
    );
  });

  it("errors when --auto-epic used with --parent-id", async () => {
    buildMockDb({});

    const { taskCreate } = await import("./task-create.js");
    await expect(
      taskCreate([
        "--title",
        "My feature",
        "--auto-epic",
        "--parent-id",
        "some-parent",
      ]),
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Error: --auto-epic cannot be used with --is-epic or --parent-id",
    );
  });
});
