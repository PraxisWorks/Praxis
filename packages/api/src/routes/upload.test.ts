import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────

const mockVerifyToken = vi.fn();
vi.mock("../middleware/auth.js", () => ({
  verifyToken: (...args: any[]) => mockVerifyToken(...args),
}));

const mockResolvePerms = vi.fn();
vi.mock("../middleware/requirePermission.js", () => ({
  resolveUserPermissions: (...args: any[]) => mockResolvePerms(...args),
}));

const mockLimit = vi.fn();
const mockWhere = vi.fn(() => ({ limit: mockLimit }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));
const mockInsertReturning = vi.fn();
const mockInsertValues = vi.fn(() => ({ returning: mockInsertReturning }));
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

vi.mock("../db/index.js", () => ({
  getDb: () => ({
    select: (...a: any[]) => mockSelect(...a),
    insert: (...a: any[]) => mockInsert(...a),
  }),
}));

vi.mock("../db/schema.js", () => ({
  users: { sub: "sub", id: "id", role: "role", roleId: "roleId" },
  sessions: { id: "id" },
  repos: { id: "id", userId: "userId" },
  sessionAttachments: {},
  ideas: { id: "id", userId: "userId" },
  ideaAttachments: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  and: (...args: unknown[]) => ({ and: args }),
}));

const mockStorageUpload = vi
  .fn()
  .mockResolvedValue({ storageKey: "key", sizeBytes: 100 });
vi.mock("../services/storage/index.js", () => ({
  getStorageAdapter: () => ({ upload: mockStorageUpload }),
}));

vi.mock("../lib/logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

// ── Helpers ──────────────────────────────────────────────────────────

import { uploadRouter } from "./upload.js";

function getHandler(path: string) {
  for (const layer of (uploadRouter as any).stack) {
    if (layer.route?.path === path) {
      const handlers = layer.route.stack.filter(
        (s: any) => s.method === "post",
      );
      return handlers[handlers.length - 1]?.handle;
    }
  }
  throw new Error(`POST ${path} handler not found`);
}

function createMockReqRes(body: any = {}, authHeader?: string) {
  const req = {
    body,
    headers: authHeader ? { authorization: authHeader } : {},
    file: body._file,
  } as any;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as any;
  return { req, res };
}

// ── Tests: POST /upload ─────────────────────────────────────────────

describe("POST /upload", () => {
  let handler: (req: any, res: any) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = getHandler("/upload");
  });

  it("returns 401 without auth header", async () => {
    const { req, res } = createMockReqRes({});
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 403 when user lacks file:upload permission", async () => {
    mockVerifyToken.mockResolvedValue({ sub: "user1" });
    mockLimit.mockResolvedValueOnce([
      { id: "u1", sub: "user1", role: "user", roleId: "role1" },
    ]);
    mockResolvePerms.mockResolvedValue(new Set(["idea:read"]));

    const { req, res } = createMockReqRes(
      { sessionId: "s1" },
      "Bearer valid-token",
    );
    req.file = {
      originalname: "test.txt",
      mimetype: "text/plain",
      buffer: Buffer.from("hi"),
    };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "Missing permission: file:upload",
    });
  });

  it("admin bypasses permission check", async () => {
    mockVerifyToken.mockResolvedValue({ sub: "admin1" });
    mockLimit.mockResolvedValueOnce([
      { id: "a1", sub: "admin1", role: "admin", roleId: "role-admin" },
    ]);

    const { req, res } = createMockReqRes(
      { sessionId: "s1" },
      "Bearer admin-token",
    );
    req.file = {
      originalname: "test.txt",
      mimetype: "text/plain",
      buffer: Buffer.from("hi"),
    };
    await handler(req, res);

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(mockResolvePerms).not.toHaveBeenCalled();
  });

  it("user with file:upload permission passes check", async () => {
    mockVerifyToken.mockResolvedValue({ sub: "user1" });
    mockLimit.mockResolvedValueOnce([
      { id: "u1", sub: "user1", role: "user", roleId: "role1" },
    ]);
    mockResolvePerms.mockResolvedValue(new Set(["file:upload", "idea:read"]));

    const { req, res } = createMockReqRes(
      { sessionId: "s1" },
      "Bearer valid-token",
    );
    req.file = {
      originalname: "test.txt",
      mimetype: "text/plain",
      buffer: Buffer.from("hi"),
    };
    await handler(req, res);

    expect(res.status).not.toHaveBeenCalledWith(403);
  });
});

// ── Tests: POST /upload/idea ────────────────────────────────────────

describe("POST /upload/idea", () => {
  let handler: (req: any, res: any) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = getHandler("/upload/idea");
  });

  it("returns 401 without auth header", async () => {
    const { req, res } = createMockReqRes({});
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 403 when user lacks file:upload permission", async () => {
    mockVerifyToken.mockResolvedValue({ sub: "user1" });
    mockLimit.mockResolvedValueOnce([
      { id: "u1", sub: "user1", role: "user", roleId: "role1" },
    ]);
    mockResolvePerms.mockResolvedValue(new Set(["idea:read"]));

    const { req, res } = createMockReqRes(
      { ideaId: "i1" },
      "Bearer valid-token",
    );
    req.file = {
      originalname: "test.txt",
      mimetype: "text/plain",
      buffer: Buffer.from("hi"),
    };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "Missing permission: file:upload",
    });
  });

  it("admin bypasses permission check", async () => {
    mockVerifyToken.mockResolvedValue({ sub: "admin1" });
    mockLimit.mockResolvedValueOnce([
      { id: "a1", sub: "admin1", role: "admin", roleId: "role-admin" },
    ]);

    const { req, res } = createMockReqRes(
      { ideaId: "i1" },
      "Bearer admin-token",
    );
    req.file = {
      originalname: "test.txt",
      mimetype: "text/plain",
      buffer: Buffer.from("hi"),
    };
    await handler(req, res);

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(mockResolvePerms).not.toHaveBeenCalled();
  });

  it("user with file:upload permission passes check", async () => {
    mockVerifyToken.mockResolvedValue({ sub: "user1" });
    mockLimit.mockResolvedValueOnce([
      { id: "u1", sub: "user1", role: "user", roleId: "role1" },
    ]);
    mockResolvePerms.mockResolvedValue(new Set(["file:upload", "idea:read"]));

    const { req, res } = createMockReqRes(
      { ideaId: "i1" },
      "Bearer valid-token",
    );
    req.file = {
      originalname: "test.txt",
      mimetype: "text/plain",
      buffer: Buffer.from("hi"),
    };
    await handler(req, res);

    expect(res.status).not.toHaveBeenCalledWith(403);
  });
});
