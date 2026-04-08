import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
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
const mockParse = vi.fn((val: unknown) => val);
vi.mock("@praxis2/shared", () => ({
  PgPubSub: vi.fn(function () {
    return { publish: mockPublish, close: mockClose };
  }),
  syncChannel: function (entity: string) {
    return `sync:${entity}`;
  },
  StructuredQuestionMetadataSchema: {
    parse: (val: unknown) => mockParse(val),
  },
}));

vi.mock("@praxis2/api/schema", () => ({
  sessionMessages: {
    id: "sessionMessages.id",
    metadata: "sessionMessages.metadata",
    sessionId: "sessionMessages.sessionId",
  },
  sessions: {
    id: "sessions.id",
    metadata: "sessions.metadata",
    updatedAt: "sessions.updatedAt",
  },
}));

let mockDb: {
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
};

function buildMockDb(answeredMeta?: Record<string, unknown>) {
  mockDb = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "msg-uuid-1" }]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi
          .fn()
          .mockResolvedValue([
            { metadata: answeredMeta ?? { answered: false } },
          ]),
      }),
    }),
  };
}

describe("ask", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  const validArgs = [
    "--question",
    "Which auth?",
    "--header",
    "Auth",
    "--option",
    "JWT::JSON Web Token",
    "--option",
    "SSO::Single Sign-On",
  ];

  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgres://test:test@localhost/test");
    vi.stubEnv("PX_SESSION_ID", "session-uuid-1");
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(function () {
      throw new Error("process.exit");
    } as never);
    mockEnd.mockClear();
    mockPublish.mockClear();
    mockClose.mockClear();
    mockParse.mockClear();
    mockParse.mockImplementation((val: unknown) => val);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("exits 1 when --question is missing", async () => {
    buildMockDb();
    const { ask } = await import("./ask.js");
    await expect(
      ask(["--header", "Auth", "--option", "A::desc", "--option", "B::desc"]),
    ).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits 1 when --header is missing", async () => {
    buildMockDb();
    const { ask } = await import("./ask.js");
    await expect(
      ask([
        "--question",
        "Which?",
        "--option",
        "A::desc",
        "--option",
        "B::desc",
      ]),
    ).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits 1 when fewer than 2 options", async () => {
    buildMockDb();
    const { ask } = await import("./ask.js");
    await expect(
      ask(["--question", "Which?", "--header", "Auth", "--option", "A::desc"]),
    ).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits 1 on invalid option format (missing ::)", async () => {
    buildMockDb();
    const { ask } = await import("./ask.js");
    await expect(
      ask([
        "--question",
        "Which?",
        "--header",
        "Auth",
        "--option",
        "bad format",
        "--option",
        "B::desc",
      ]),
    ).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("inserts message and publishes events on valid args", async () => {
    vi.useFakeTimers();
    buildMockDb({ answered: true, selectedOptions: ["JWT"] });
    const { ask } = await import("./ask.js");

    const promise = ask(validArgs);
    await vi.advanceTimersByTimeAsync(2100);
    await promise;

    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockPublish).toHaveBeenCalledTimes(2);
    expect(consoleSpy).toHaveBeenCalledWith("Selected: JWT");
  });

  it("prints comma-separated labels for multi-select", async () => {
    vi.useFakeTimers();
    buildMockDb({ answered: true, selectedOptions: ["SSO", "MFA"] });
    const { ask } = await import("./ask.js");

    const promise = ask([...validArgs, "--multi-select"]);
    await vi.advanceTimersByTimeAsync(2100);
    await promise;

    expect(consoleSpy).toHaveBeenCalledWith("Selected: SSO, MFA");
  });

  it("exits 1 on timeout", async () => {
    vi.useFakeTimers();
    buildMockDb({ answered: false });

    // Use a non-throwing exit mock for the timeout path. The real
    // process.exit never returns, so throwing simulates that, but here
    // the throw inside the catch/finally async chain becomes an
    // unhandled rejection that vitest flags. Instead we record the call
    // without throwing — the catch block falls through to `throw err`
    // which we catch normally via rejects.toThrow.
    exitSpy.mockRestore();
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(function () {} as never);

    const { ask } = await import("./ask.js");

    const promise = ask([...validArgs, "--timeout", "100"]);

    // Advance past the timeout and catch the rejection in one step so
    // vitest never sees an unhandled rejection.
    const [, rejection] = await Promise.allSettled([
      vi.advanceTimersByTimeAsync(150),
      promise,
    ]);

    expect(rejection.status).toBe("rejected");
    expect((rejection as PromiseRejectedResult).reason).toBeInstanceOf(Error);
    expect(((rejection as PromiseRejectedResult).reason as Error).message).toBe(
      "timeout",
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "No answer received (timeout)",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("parses --option Label::Description into label and description", async () => {
    vi.useFakeTimers();
    buildMockDb({ answered: true, selectedOptions: ["JWT"] });
    const { ask } = await import("./ask.js");

    const promise = ask([
      "--question",
      "Pick one",
      "--header",
      "Choice",
      "--option",
      "JWT::JSON Web Token",
      "--option",
      "SSO::Single Sign-On",
    ]);
    await vi.advanceTimersByTimeAsync(2100);
    await promise;

    const parsed = mockParse.mock.calls[0][0] as Record<string, unknown>;
    const questions = parsed.questions as Array<Record<string, unknown>>;
    expect(questions[0].options).toEqual([
      { label: "JWT", description: "JSON Web Token" },
      { label: "SSO", description: "Single Sign-On" },
    ]);
  });

  it("sets multiSelect true when --multi-select flag is present", async () => {
    vi.useFakeTimers();
    buildMockDb({ answered: true, selectedOptions: ["JWT"] });
    const { ask } = await import("./ask.js");

    const promise = ask([...validArgs, "--multi-select"]);
    await vi.advanceTimersByTimeAsync(2100);
    await promise;

    const parsed = mockParse.mock.calls[0][0] as Record<string, unknown>;
    const questions = parsed.questions as Array<Record<string, unknown>>;
    expect(questions[0].multiSelect).toBe(true);
  });

  it("uses custom --timeout value", async () => {
    vi.useFakeTimers();
    buildMockDb({ answered: false });

    exitSpy.mockRestore();
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(function () {} as never);

    const { ask } = await import("./ask.js");

    const promise = ask([...validArgs, "--timeout", "500"]);

    // At 400ms the timeout (500ms) has not fired yet, so advance timers
    // partially first. The promise should still be pending.
    await vi.advanceTimersByTimeAsync(400);

    // Now advance past 500ms to trigger the timeout.
    const [, rejection] = await Promise.allSettled([
      vi.advanceTimersByTimeAsync(200),
      promise,
    ]);

    expect(rejection.status).toBe("rejected");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("constructs metadata matching StructuredQuestionMetadataSchema shape", async () => {
    vi.useFakeTimers();
    buildMockDb({ answered: true, selectedOptions: ["JWT"] });
    const { ask } = await import("./ask.js");

    const promise = ask(validArgs);
    await vi.advanceTimersByTimeAsync(2100);
    await promise;

    expect(mockParse).toHaveBeenCalledTimes(1);
    const metadata = mockParse.mock.calls[0][0] as Record<string, unknown>;
    expect(metadata).toEqual({
      type: "structured_question",
      questions: [
        {
          question: "Which auth?",
          header: "Auth",
          options: [
            { label: "JWT", description: "JSON Web Token" },
            { label: "SSO", description: "Single Sign-On" },
          ],
          multiSelect: false,
        },
      ],
      answered: false,
    });
  });

  it("throws when header exceeds 12 characters (schema validation)", async () => {
    buildMockDb();
    mockParse.mockImplementation(() => {
      throw new Error("String must contain at most 12 character(s)");
    });

    const { ask } = await import("./ask.js");
    await expect(
      ask([
        "--question",
        "Which?",
        "--header",
        "TooLongHeader!",
        "--option",
        "A::desc",
        "--option",
        "B::desc",
      ]),
    ).rejects.toThrow("String must contain at most 12 character(s)");
  });
});
