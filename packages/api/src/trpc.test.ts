import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./db/index.js", () => ({
  getConnectionString: vi.fn(() => "postgresql://mock"),
  getDb: vi.fn(() => ({})),
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "mock"),
  jwtVerify: vi.fn().mockResolvedValue({
    payload: { sub: "u1" },
    protectedHeader: { alg: "RS256" },
  }),
}));

import { router, protectedProcedure, jwtProcedure } from "./trpc.js";

const testRouter = router({
  protectedRoute: protectedProcedure.query(({ ctx }) => {
    return { userId: ctx.user.sub };
  }),
  jwtRoute: jwtProcedure.query(({ ctx }) => {
    return { userId: ctx.user.sub };
  }),
});

function makeMockDb() {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([{ id: "db-1", sub: "u1" }]),
  };
  return chain;
}

describe("protectedProcedure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws UNAUTHORIZED when user is null", async () => {
    const caller = testRouter.createCaller({
      user: null,
      db: makeMockDb() as any,
      pubsub: {} as any,
    });

    await expect(caller.protectedRoute()).rejects.toThrow("UNAUTHORIZED");
  });

  it("throws FORBIDDEN when email_verified is false", async () => {
    const caller = testRouter.createCaller({
      user: {
        sub: "u1",
        "https://praxis.app/email_verified": false,
      },
      db: makeMockDb() as any,
      pubsub: {} as any,
    });

    await expect(caller.protectedRoute()).rejects.toThrow(
      "Email verification required",
    );
  });

  it("passes through when email_verified is true", async () => {
    const caller = testRouter.createCaller({
      user: {
        sub: "u1",
        "https://praxis.app/email_verified": true,
      },
      db: makeMockDb() as any,
      pubsub: {} as any,
    });

    const result = await caller.protectedRoute();
    expect(result).toEqual({ userId: "u1" });
  });

  it("passes through when email_verified claim is absent (backward compat)", async () => {
    const caller = testRouter.createCaller({
      user: { sub: "u1" },
      db: makeMockDb() as any,
      pubsub: {} as any,
    });

    const result = await caller.protectedRoute();
    expect(result).toEqual({ userId: "u1" });
  });

  it("passes through when email_verified is false but DISABLE_EMAIL_VERIFICATION=true", async () => {
    const original = process.env.DISABLE_EMAIL_VERIFICATION;
    process.env.DISABLE_EMAIL_VERIFICATION = "true";
    try {
      const caller = testRouter.createCaller({
        user: {
          sub: "u1",
          "https://praxis.app/email_verified": false,
        },
        db: makeMockDb() as any,
        pubsub: {} as any,
      });

      const result = await caller.protectedRoute();
      expect(result).toEqual({ userId: "u1" });
    } finally {
      if (original === undefined) delete process.env.DISABLE_EMAIL_VERIFICATION;
      else process.env.DISABLE_EMAIL_VERIFICATION = original;
    }
  });
});

describe("jwtProcedure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws UNAUTHORIZED when user is null", async () => {
    const caller = testRouter.createCaller({
      user: null,
      db: makeMockDb() as any,
      pubsub: {} as any,
    });

    await expect(caller.jwtRoute()).rejects.toThrow("UNAUTHORIZED");
  });

  it("passes through even when email_verified is false", async () => {
    const caller = testRouter.createCaller({
      user: {
        sub: "u1",
        "https://praxis.app/email_verified": false,
      },
      db: makeMockDb() as any,
      pubsub: {} as any,
    });

    const result = await caller.jwtRoute();
    expect(result).toEqual({ userId: "u1" });
  });
});
