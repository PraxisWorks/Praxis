import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ideaCreate } from "./idea-create.js";

const {
  mockEnd,
  mockPublish,
  mockClose,
} = vi.hoisted(() => ({
  mockEnd: vi.fn().mockResolvedValue(undefined),
  mockPublish: vi.fn().mockResolvedValue(undefined),
  mockClose: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
  sql: Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => "mock-sql", {
    raw: (s: string) => s,
  }),
}));

vi.mock("drizzle-orm/postgres-js", () => ({
  drizzle: () => mockDb,
}));

vi.mock("postgres", () => ({
  default: () => {
    const sql = Object.assign(() => {}, { end: mockEnd });
    return sql;
  },
}));

vi.mock("@praxis2/api/schema", () => ({
  ideas: { repoId: "ideas.repoId", order: "ideas.order", id: "ideas.id" },
  rigs: { id: "rigs.id", userId: "repos.userId" },
}));

vi.mock("@praxis2/shared", () => {
  return {
    PgPubSub: class {
      publish = mockPublish;
      close = mockClose;
    },
    syncChannel: (entity: string) => `sync:${entity}`,
  };
});

let mockDb: {
  select: ReturnType<typeof vi.fn>;
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

function makeInsertChain(results: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.values = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockImplementation(() => Promise.resolve(results));
  chain.then = (fn: (v: unknown) => unknown) => Promise.resolve(results).then(fn);
  return chain;
}

describe("ideaCreate", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgres://test:test@localhost/test");
    vi.stubEnv("PX_REPO_ID", "");
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    mockPublish.mockClear();
    mockClose.mockClear();
    mockEnd.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("exits with error when --title is missing", async () => {
    mockDb = { select: vi.fn(), insert: vi.fn() };
    await expect(ideaCreate(["--description", "desc"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "Usage: px idea create --title <title> --description <desc> [--repo-id <uuid>]",
    );
  });

  it("exits with error when --description is missing", async () => {
    mockDb = { select: vi.fn(), insert: vi.fn() };
    await expect(ideaCreate(["--title", "Test"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "Usage: px idea create --title <title> --description <desc> [--repo-id <uuid>]",
    );
  });

  it("exits with error when no repo ID provided", async () => {
    mockDb = { select: vi.fn(), insert: vi.fn() };
    await expect(
      ideaCreate(["--title", "Test", "--description", "desc"]),
    ).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "Error: --repo-id or PX_REPO_ID env var is required",
    );
  });

  it("exits with error when repo not found", async () => {
    const selectResults: unknown[][] = [[]];
    mockDb = {
      select: vi.fn().mockImplementation(() => makeSelectChain(selectResults.shift() ?? [])),
      insert: vi.fn(),
    };

    await expect(
      ideaCreate(["--title", "Test", "--description", "desc", "--repo-id", "bad-repo"]),
    ).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith("Error: repo not found: bad-repo");
  });

  it("successfully creates idea with valid args", async () => {
    const selectResults: unknown[][] = [
      [{ userId: "user-uuid" }],
      [{ maxOrder: 2 }],
    ];
    const insertResult = [{ id: "idea-uuid", title: "Test" }];

    mockDb = {
      select: vi.fn().mockImplementation(() => makeSelectChain(selectResults.shift() ?? [])),
      insert: vi.fn().mockImplementation(() => makeInsertChain(insertResult)),
    };

    await ideaCreate(["--title", "Test", "--description", "desc", "--repo-id", "repo-uuid"]);

    expect(consoleSpy).toHaveBeenCalledWith("OK: idea created — Test");
  });

  it("publishes sync event on successful creation", async () => {
    const selectResults: unknown[][] = [
      [{ userId: "user-uuid" }],
      [{ maxOrder: 2 }],
    ];
    const insertResult = [{ id: "idea-uuid", title: "Test" }];

    mockDb = {
      select: vi.fn().mockImplementation(() => makeSelectChain(selectResults.shift() ?? [])),
      insert: vi.fn().mockImplementation(() => makeInsertChain(insertResult)),
    };

    await ideaCreate(["--title", "Test", "--description", "desc", "--repo-id", "repo-uuid"]);

    expect(mockPublish).toHaveBeenCalledWith("sync:idea", {
      action: "created",
      data: { id: "idea-uuid", title: "Test" },
      timestamp: expect.any(Number),
    });
  });

  it("falls back to PX_REPO_ID env var when --repo-id not provided", async () => {
    vi.stubEnv("PX_REPO_ID", "repo-uuid");

    const selectResults: unknown[][] = [
      [{ userId: "user-uuid" }],
      [{ maxOrder: 2 }],
    ];
    const insertResult = [{ id: "idea-uuid", title: "Test" }];

    mockDb = {
      select: vi.fn().mockImplementation(() => makeSelectChain(selectResults.shift() ?? [])),
      insert: vi.fn().mockImplementation(() => makeInsertChain(insertResult)),
    };

    await ideaCreate(["--title", "Test", "--description", "desc"]);

    expect(consoleSpy).toHaveBeenCalledWith("OK: idea created — Test");
  });
});
