import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module — MUST be before any imports that use it
vi.mock("../db/index.js", () => ({
  getConnectionString: vi.fn(() => "postgresql://mock"),
  getDb: vi.fn(() => ({})),
}));

// Mock jose for auth middleware
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "mock-jwks"),
  jwtVerify: vi.fn().mockResolvedValue({
    payload: { sub: "user123", email: "test@example.com" },
    protectedHeader: { alg: "RS256" },
  }),
}));

vi.mock("../lib/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock("../jobs/index.js", () => ({
  enqueueJob: vi.fn().mockResolvedValue("job-123"),
}));

import { appRouter } from "./index.js";

describe("deploymentRouter", () => {
  const mockDeployment = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    service: "api",
    gitSha: "abc1234",
    deployedAt: new Date("2026-02-28T14:30:00Z"),
    createdAt: new Date(),
  };

  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue([mockDeployment]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([mockDeployment]),
  };

  const mockPubsub = {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    close: vi.fn(),
  };

  const createCaller = () =>
    appRouter.createCaller({
      user: null,
      db: mockDb as any,
      pubsub: mockPubsub as any,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.orderBy.mockResolvedValue([mockDeployment]);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.onConflictDoUpdate.mockReturnThis();
    mockDb.returning.mockResolvedValue([mockDeployment]);
  });

  it("list returns deployments", async () => {
    const caller = createCaller();
    const result = await caller.deployment.list();
    expect(result).toEqual([mockDeployment]);
  });

  it("register upserts deployment and publishes sync event", async () => {
    const caller = createCaller();
    const result = await caller.deployment.register({
      service: "api",
      gitSha: "abc1234",
      deployedAt: new Date("2026-02-28T14:30:00Z"),
    });
    expect(result).toEqual(mockDeployment);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:deployment",
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("register upserts mobile deployment", async () => {
    const caller = createCaller();
    const result = await caller.deployment.register({
      service: "mobile",
      gitSha: "mob1234",
      deployedAt: new Date("2026-02-28T14:30:00Z"),
    });
    expect(result).toEqual(mockDeployment);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:deployment",
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("register rejects invalid service", async () => {
    const caller = createCaller();
    await expect(
      caller.deployment.register({
        service: "invalid" as any,
        gitSha: "abc1234",
        deployedAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("register rejects short gitSha", async () => {
    const caller = createCaller();
    await expect(
      caller.deployment.register({
        service: "api",
        gitSha: "abc",
        deployedAt: new Date(),
      }),
    ).rejects.toThrow();
  });
});
