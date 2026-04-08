import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module
vi.mock("../db/index.js", () => ({
  getConnectionString: vi.fn(() => "postgresql://mock"),
  getDb: vi.fn(() => ({})),
}));

// Mock jose for auth middleware
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "mock-jwks"),
  jwtVerify: vi.fn().mockResolvedValue({
    payload: { sub: "u1", email: "test@test.com" },
    protectedHeader: { alg: "RS256" },
  }),
}));

import { router } from "../trpc.js";
import { requirePermission, resolveUserPermissions } from "./requirePermission.js";
import { users, rolePermissions, userPermissionOverrides } from "../db/schema.js";

// ---------- helpers ----------

const ROLE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

/** Build a mock user record */
function fakeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    sub: "u1",
    name: "Test",
    email: "test@test.com",
    role: "user",
    roleId: ROLE_ID,
    avatarUrl: null,
    lastLoginAt: null,
    pushOptOut: false,
    theme: "light",
    apiKeyHash: null,
    activeWorkerId: null,
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * Creates a mockDb where `.from(table)` dispatches to per-table stubs.
 *
 * - `users` table: used by protectedProcedure to look up dbUser
 * - `rolePermissions`: used by resolveUserPermissions to get role permissions
 * - `userPermissionOverrides`: used by resolveUserPermissions to get overrides
 */
function createMockDb(opts: {
  dbUser?: ReturnType<typeof fakeUser> | null;
  rolePerms?: { permissionKey: string }[];
  overrides?: { permissionKey: string; granted: boolean }[];
}) {
  const {
    dbUser = fakeUser(),
    rolePerms = [],
    overrides = [],
  } = opts;

  // Track which table was queried via `.from()`
  let lastTable: unknown = null;

  const mockDb = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockImplementation((table: unknown) => {
        lastTable = table;

        // Return an object with where/limit that resolves to table-specific data
        const chain = {
          where: vi.fn().mockImplementation(() => {
            if (lastTable === users) {
              // protectedProcedure calls .where().limit(1)
              return {
                limit: vi.fn().mockResolvedValue(dbUser ? [dbUser] : []),
              };
            }
            if (lastTable === rolePermissions) {
              return Promise.resolve(rolePerms);
            }
            if (lastTable === userPermissionOverrides) {
              return Promise.resolve(overrides);
            }
            return Promise.resolve([]);
          }),
          limit: vi.fn().mockResolvedValue(dbUser ? [dbUser] : []),
        };
        return chain;
      }),
    }),
  };

  return mockDb;
}

// Build a small test router using requirePermission
const testRouter = router({
  single: requirePermission("org:create").query(() => "ok"),
  multi: requirePermission("org:create", "org:delete").query(() => "ok"),
  triple: requirePermission("org:create", "org:delete", "org:update").query(
    () => "ok",
  ),
  // Exposes ctx.permissions so tests can inspect the Set
  exposeCtx: requirePermission("org:create").query(({ ctx }) => {
    return Array.from((ctx as any).permissions).sort();
  }),
  exposeCtxMulti: requirePermission("org:create", "org:delete").query(
    ({ ctx }) => {
      return Array.from((ctx as any).permissions).sort();
    },
  ),
});

function createCaller(
  mockDb: ReturnType<typeof createMockDb>,
  authenticated = true,
) {
  return testRouter.createCaller({
    user: authenticated ? { sub: "u1", email: "test@test.com" } : null,
    db: mockDb as any,
    pubsub: { publish: vi.fn(), subscribe: vi.fn(), close: vi.fn() } as any,
  });
}

// ---------- tests ----------

describe("requirePermission middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows access when user role has the required permission", async () => {
    const mockDb = createMockDb({
      rolePerms: [{ permissionKey: "org:create" }],
    });
    const caller = createCaller(mockDb);
    const result = await caller.single();
    expect(result).toBe("ok");
  });

  it("throws FORBIDDEN when user lacks the required permission", async () => {
    const mockDb = createMockDb({
      rolePerms: [], // no permissions
    });
    const caller = createCaller(mockDb);
    await expect(caller.single()).rejects.toThrow("Missing permissions: org:create");
  });

  it("grants access via user override even if role lacks the permission", async () => {
    const mockDb = createMockDb({
      rolePerms: [], // role doesn't have it
      overrides: [{ permissionKey: "org:create", granted: true }],
    });
    const caller = createCaller(mockDb);
    const result = await caller.single();
    expect(result).toBe("ok");
  });

  it("denies access via user override even if role has the permission", async () => {
    const mockDb = createMockDb({
      rolePerms: [{ permissionKey: "org:create" }],
      overrides: [{ permissionKey: "org:create", granted: false }],
    });
    const caller = createCaller(mockDb);
    await expect(caller.single()).rejects.toThrow("Missing permissions: org:create");
  });

  it("checks all required permissions (multiple)", async () => {
    const mockDb = createMockDb({
      rolePerms: [{ permissionKey: "org:create" }], // missing org:delete
    });
    const caller = createCaller(mockDb);
    await expect(caller.multi()).rejects.toThrow("Missing permissions: org:delete");
  });

  it("allows access when user has all multiple required permissions", async () => {
    const mockDb = createMockDb({
      rolePerms: [
        { permissionKey: "org:create" },
        { permissionKey: "org:delete" },
      ],
    });
    const caller = createCaller(mockDb);
    const result = await caller.multi();
    expect(result).toBe("ok");
  });

  it("bypasses permission check for legacy admin role", async () => {
    const mockDb = createMockDb({
      dbUser: fakeUser({ role: "admin", roleId: null }),
      rolePerms: [], // no role permissions — doesn't matter for admin
    });
    const caller = createCaller(mockDb);
    const result = await caller.single();
    expect(result).toBe("ok");
  });

  it("throws FORBIDDEN when there is no dbUser", async () => {
    const mockDb = createMockDb({ dbUser: null });
    const caller = createCaller(mockDb);
    await expect(caller.single()).rejects.toThrow("User account required");
  });

  it("throws UNAUTHORIZED when not authenticated", async () => {
    const mockDb = createMockDb({});
    const caller = createCaller(mockDb, false);
    await expect(caller.single()).rejects.toThrow("UNAUTHORIZED");
  });

  // ---------- edge cases ----------

  describe("edge cases", () => {
    it("denies when user has a role but role has NO permissions (empty role_permissions)", async () => {
      const mockDb = createMockDb({
        dbUser: fakeUser({ roleId: ROLE_ID }),
        rolePerms: [], // role exists but grants nothing
        overrides: [],
      });
      const caller = createCaller(mockDb);
      await expect(caller.single()).rejects.toThrow(
        "Missing permissions: org:create",
      );
    });

    it("denies when user has no roleId (null) and no overrides", async () => {
      const mockDb = createMockDb({
        dbUser: fakeUser({ roleId: null }),
        rolePerms: [],
        overrides: [],
      });
      const caller = createCaller(mockDb);
      await expect(caller.single()).rejects.toThrow(
        "Missing permissions: org:create",
      );
    });

    it("allows when user has no roleId but has an override granting the permission", async () => {
      const mockDb = createMockDb({
        dbUser: fakeUser({ roleId: null }),
        rolePerms: [],
        overrides: [{ permissionKey: "org:create", granted: true }],
      });
      const caller = createCaller(mockDb);
      const result = await caller.single();
      expect(result).toBe("ok");
    });
  });

  // ---------- override priority ----------

  describe("override priority", () => {
    it("override granted:false takes precedence over role permission", async () => {
      const mockDb = createMockDb({
        rolePerms: [{ permissionKey: "org:create" }],
        overrides: [{ permissionKey: "org:create", granted: false }],
      });
      const caller = createCaller(mockDb);
      await expect(caller.single()).rejects.toThrow(
        "Missing permissions: org:create",
      );
    });

    it("handles multiple overrides for different keys (one granted, one denied)", async () => {
      const mockDb = createMockDb({
        rolePerms: [{ permissionKey: "org:create" }], // role has org:create but not org:delete
        overrides: [
          { permissionKey: "org:delete", granted: true }, // adds org:delete
          { permissionKey: "org:create", granted: false }, // removes org:create
        ],
      });
      const caller = createCaller(mockDb);
      // org:create is denied via override, org:delete is granted via override
      // multi requires both org:create and org:delete
      await expect(caller.multi()).rejects.toThrow(
        "Missing permissions: org:create",
      );
    });

    it("override for a key not in role permissions adds the permission", async () => {
      const mockDb = createMockDb({
        rolePerms: [{ permissionKey: "org:create" }], // role only has org:create
        overrides: [{ permissionKey: "org:delete", granted: true }], // override adds org:delete
      });
      const caller = createCaller(mockDb);
      const result = await caller.multi(); // requires org:create + org:delete
      expect(result).toBe("ok");
    });
  });

  // ---------- multiple permissions (3+) ----------

  describe("multiple permissions (3+)", () => {
    it("allows when user has all 3 required permissions", async () => {
      const mockDb = createMockDb({
        rolePerms: [
          { permissionKey: "org:create" },
          { permissionKey: "org:delete" },
          { permissionKey: "org:update" },
        ],
      });
      const caller = createCaller(mockDb);
      const result = await caller.triple();
      expect(result).toBe("ok");
    });

    it("denies when user is missing one of 3 required permissions", async () => {
      const mockDb = createMockDb({
        rolePerms: [
          { permissionKey: "org:create" },
          { permissionKey: "org:delete" },
          // missing org:update
        ],
      });
      const caller = createCaller(mockDb);
      await expect(caller.triple()).rejects.toThrow(
        "Missing permissions: org:update",
      );
    });

    it("denies listing all missing when user has none of the 3 required permissions", async () => {
      const mockDb = createMockDb({
        rolePerms: [], // user has nothing
      });
      const caller = createCaller(mockDb);
      await expect(caller.triple()).rejects.toThrow(
        "Missing permissions: org:create, org:delete, org:update",
      );
    });
  });

  // ---------- context extension ----------

  describe("context extension", () => {
    it("populates ctx.permissions Set after middleware passes", async () => {
      const mockDb = createMockDb({
        rolePerms: [
          { permissionKey: "org:create" },
          { permissionKey: "org:update" },
        ],
      });
      const caller = createCaller(mockDb);
      const result = await caller.exposeCtx();
      // ctx.permissions should be an array (from Set) containing the role permissions
      expect(result).toContain("org:create");
      expect(result).toContain("org:update");
    });

    it("ctx.permissions includes both role permissions and override-granted permissions", async () => {
      const mockDb = createMockDb({
        rolePerms: [{ permissionKey: "org:create" }],
        overrides: [{ permissionKey: "org:delete", granted: true }],
      });
      const caller = createCaller(mockDb);
      const result = await caller.exposeCtxMulti();
      expect(result).toContain("org:create");
      expect(result).toContain("org:delete");
    });

    it("admin bypass populates ctx.permissions with the required keys", async () => {
      const mockDb = createMockDb({
        dbUser: fakeUser({ role: "admin", roleId: null }),
        rolePerms: [],
      });
      const caller = createCaller(mockDb);
      const result = await caller.exposeCtxMulti();
      // Admin bypass gives a Set containing just the required keys
      expect(result).toEqual(["org:create", "org:delete"]);
    });
  });

  // ---------- error messages ----------

  describe("error messages", () => {
    it("FORBIDDEN error message lists the specific missing permission key", async () => {
      const mockDb = createMockDb({
        rolePerms: [], // no permissions
      });
      const caller = createCaller(mockDb);
      await expect(caller.single()).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "Missing permissions: org:create",
      });
    });

    it("FORBIDDEN error message lists all missing permission keys when multiple are absent", async () => {
      const mockDb = createMockDb({
        rolePerms: [], // missing both
      });
      const caller = createCaller(mockDb);
      await expect(caller.multi()).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "Missing permissions: org:create, org:delete",
      });
    });

    it("shows 'User account required' message when dbUser is null", async () => {
      const mockDb = createMockDb({ dbUser: null });
      const caller = createCaller(mockDb);
      await expect(caller.single()).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "User account required",
      });
    });
  });
});

describe("resolveUserPermissions", () => {
  it("returns role permissions when user has a role", async () => {
    const mockDb = createMockDb({
      rolePerms: [
        { permissionKey: "org:create" },
        { permissionKey: "org:update" },
      ],
    });
    const result = await resolveUserPermissions(mockDb, USER_ID, ROLE_ID);
    expect(result).toEqual(new Set(["org:create", "org:update"]));
  });

  it("returns empty set when user has no role", async () => {
    const mockDb = createMockDb({ overrides: [] });
    const result = await resolveUserPermissions(mockDb, USER_ID, null);
    expect(result).toEqual(new Set());
  });

  it("adds override-granted permissions", async () => {
    const mockDb = createMockDb({
      rolePerms: [],
      overrides: [{ permissionKey: "admin:users:manage", granted: true }],
    });
    const result = await resolveUserPermissions(mockDb, USER_ID, ROLE_ID);
    expect(result.has("admin:users:manage")).toBe(true);
  });

  it("removes override-denied permissions from role set", async () => {
    const mockDb = createMockDb({
      rolePerms: [{ permissionKey: "org:create" }],
      overrides: [{ permissionKey: "org:create", granted: false }],
    });
    const result = await resolveUserPermissions(mockDb, USER_ID, ROLE_ID);
    expect(result.has("org:create")).toBe(false);
  });

  it("returns empty set when user has a role but role has no permissions and no overrides", async () => {
    const mockDb = createMockDb({
      rolePerms: [],
      overrides: [],
    });
    const result = await resolveUserPermissions(mockDb, USER_ID, ROLE_ID);
    expect(result.size).toBe(0);
  });

  it("applies multiple overrides correctly (mixed grant and deny)", async () => {
    const mockDb = createMockDb({
      rolePerms: [
        { permissionKey: "org:create" },
        { permissionKey: "org:update" },
      ],
      overrides: [
        { permissionKey: "org:create", granted: false }, // remove
        { permissionKey: "org:delete", granted: true }, // add
      ],
    });
    const result = await resolveUserPermissions(mockDb, USER_ID, ROLE_ID);
    expect(result.has("org:create")).toBe(false); // removed by override
    expect(result.has("org:update")).toBe(true); // kept from role
    expect(result.has("org:delete")).toBe(true); // added by override
    expect(result.size).toBe(2);
  });

  it("handles overrides when user has no role (null roleId)", async () => {
    const mockDb = createMockDb({
      rolePerms: [],
      overrides: [
        { permissionKey: "org:create", granted: true },
        { permissionKey: "org:delete", granted: true },
      ],
    });
    const result = await resolveUserPermissions(mockDb, USER_ID, null);
    expect(result.has("org:create")).toBe(true);
    expect(result.has("org:delete")).toBe(true);
    expect(result.size).toBe(2);
  });

  it("deny override for a permission not in the role set has no effect", async () => {
    const mockDb = createMockDb({
      rolePerms: [{ permissionKey: "org:create" }],
      overrides: [{ permissionKey: "org:delete", granted: false }], // deny something not in role
    });
    const result = await resolveUserPermissions(mockDb, USER_ID, ROLE_ID);
    expect(result.has("org:create")).toBe(true);
    expect(result.has("org:delete")).toBe(false);
    expect(result.size).toBe(1);
  });
});
