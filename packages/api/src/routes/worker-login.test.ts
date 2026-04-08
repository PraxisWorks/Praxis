import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWorkerLoginRouter } from "./worker-login.js";

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock("../middleware/rateLimit.js", () => ({
  strictLimiter: (_req: any, _res: any, next: any) => next(),
}));

// DB mock: each method returns a fresh chainable object per call
const mockSelectWhere = vi.fn();
const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

const mockUpdateWhere = vi.fn();
const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

const mockInsertReturning = vi.fn();
const mockInsertValues = vi.fn(() => ({ returning: mockInsertReturning }));
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

vi.mock("../db/index.js", () => ({
  getDb: () => ({
    select: (...a: any[]) => mockSelect(...a),
    update: (...a: any[]) => mockUpdate(...a),
    insert: (...a: any[]) => mockInsert(...a),
  }),
}));

vi.mock("../db/schema.js", () => ({
  workers: { id: "id", userId: "userId", name: "name", status: "status" },
  workerTokens: {
    id: "id",
    userId: "userId",
    tokenHash: "tokenHash",
    expiresAt: "expiresAt",
    used: "used",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
}));

const mockCompare = vi.fn();
vi.mock("bcrypt", () => ({
  compare: (...args: any[]) => mockCompare(...args),
}));

const mockLogInfo = vi.fn();
const mockLogError = vi.fn();
vi.mock("../lib/logger.js", () => ({
  getLogger: () => ({ info: mockLogInfo, error: mockLogError, warn: vi.fn() }),
}));

const mockCreateUser = vi.fn();
vi.mock("../services/db-provisioner/index.js", () => ({
  getDbProvisioner: () => ({ createUser: mockCreateUser }),
}));

vi.mock("@praxis2/shared", () => ({
  syncChannel: (name: string) => `sync:${name}`,
}));

// ── Helpers ──────────────────────────────────────────────────────────

const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const TOKEN_ID = "770e8400-e29b-41d4-a716-446655440002";
const WORKER_ID = "660e8400-e29b-41d4-a716-446655440001";
const FUTURE = new Date(Date.now() + 3_600_000);
const PAST = new Date(Date.now() - 3_600_000);

const validCandidate = {
  id: TOKEN_ID,
  userId: USER_ID,
  tokenHash: "$2b$10$hashedvalue",
  expiresAt: FUTURE,
  used: false,
};

const createdWorker = {
  id: WORKER_ID,
  userId: USER_ID,
  name: "my-worker",
  status: "online",
};

const mockPubsub = {
  publish: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn(),
  close: vi.fn(),
};

function createMockReqRes(body: any = {}) {
  const req = { body, headers: {}, hostname: "praxis2.example.com" } as any;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as any;
  return { req, res };
}

/** Wire up default DB chain mocks for a valid-token happy path. */
function setupHappyPath() {
  mockSelectWhere.mockResolvedValue([validCandidate]);
  mockCompare.mockResolvedValue(true);
  mockUpdateWhere.mockResolvedValue(undefined);
  mockInsertReturning.mockResolvedValue([createdWorker]);
}

/** Extract the POST /login handler from the router stack. */
function getLoginHandler(router: ReturnType<typeof createWorkerLoginRouter>) {
  for (const layer of (router as any).stack) {
    if (layer.route?.path === "/login") {
      return layer.route.stack.find((s: any) => s.method === "post")?.handle;
    }
  }
  throw new Error("POST /login handler not found on router");
}

// ── Tests ────────────────────────────────────────────────────────────

describe("POST /api/worker/login", () => {
  let handler: (req: any, res: any) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    const router = createWorkerLoginRouter(mockPubsub as any);
    handler = getLoginHandler(router);
  });

  // ── Validation ───────────────────────────────────────────────────

  it("returns 400 when name is missing", async () => {
    const { req, res } = createMockReqRes({ token: "abc123" });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Worker name is required" });
  });

  it("returns 401 when token is missing", async () => {
    const { req, res } = createMockReqRes({ name: "my-macbook" });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid or expired token" });
  });

  it("returns 401 when body is empty", async () => {
    const { req, res } = createMockReqRes({});
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  // ── Token Validation ─────────────────────────────────────────────

  it("returns 401 when no matching token exists", async () => {
    mockSelectWhere.mockResolvedValue([]);
    const { req, res } = createMockReqRes({ token: "bad", name: "w" });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid or expired token" });
  });

  it("returns 401 when token is expired", async () => {
    mockSelectWhere.mockResolvedValue([{ ...validCandidate, expiresAt: PAST }]);
    mockCompare.mockResolvedValue(true);
    const { req, res } = createMockReqRes({ token: "expired", name: "w" });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockCompare).not.toHaveBeenCalled();
  });

  it("returns 401 when bcrypt compare fails", async () => {
    mockSelectWhere.mockResolvedValue([validCandidate]);
    mockCompare.mockResolvedValue(false);
    const { req, res } = createMockReqRes({ token: "wrong", name: "w" });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  // ── Provisioning fails → 422, NO side effects ──────────

  it("returns 422 when provisioning fails, token NOT consumed, no worker row", async () => {
    setupHappyPath();
    mockCreateUser.mockRejectedValue(new Error("DO API timeout"));

    const { req, res } = createMockReqRes({ token: "good", name: "w" });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      error: "Database provisioning failed: DO API timeout",
    });
    // Token must NOT be consumed
    expect(mockUpdate).not.toHaveBeenCalled();
    // No worker row created
    expect(mockInsert).not.toHaveBeenCalled();
    // No sync event published
    expect(mockPubsub.publish).not.toHaveBeenCalled();
    // Error was logged
    expect(mockLogError).toHaveBeenCalled();
  });

  // ── Success ─────────────────────────────────────────────

  it("returns 201 with databaseUrl on success", async () => {
    setupHappyPath();
    mockCreateUser.mockResolvedValue({ databaseUrl: "postgres://worker:pass@host/db" });

    const { req, res } = createMockReqRes({ token: "good", name: "my-worker" });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      workerId: WORKER_ID,
      workerName: "my-worker",
      userId: USER_ID,
      databaseUrl: "postgres://worker:pass@host/db",
    });
    // Token consumed
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockUpdateSet).toHaveBeenCalledWith({ used: true });
    // Worker row created
    expect(mockInsert).toHaveBeenCalled();
    // Sync event published
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:worker",
      expect.objectContaining({ action: "created", data: createdWorker }),
    );
    // Provisioner called with userId and hostname
    expect(mockCreateUser).toHaveBeenCalledWith(USER_ID, "praxis2.example.com");
  });

  // ── Misc ─────────────────────────────────────────────────────────

  it("skips expired tokens and matches a valid one", async () => {
    mockSelectWhere.mockResolvedValue([
      { ...validCandidate, id: "expired-id", expiresAt: PAST },
      validCandidate,
    ]);
    mockCompare.mockResolvedValue(true);
    mockCreateUser.mockResolvedValue({ databaseUrl: "postgres://worker:pass@host/db" });
    mockUpdateWhere.mockResolvedValue(undefined);
    mockInsertReturning.mockResolvedValue([createdWorker]);
    const { req, res } = createMockReqRes({ token: "good", name: "w" });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockCompare).toHaveBeenCalledTimes(1);
  });

  it("returns 500 on unexpected error", async () => {
    mockSelectWhere.mockRejectedValue(new Error("DB connection failed"));

    const { req, res } = createMockReqRes({ token: "good", name: "w" });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
  });
});
