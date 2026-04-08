import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/index.js", () => ({
  getConnectionString: vi.fn(() => "postgresql://mock"),
  getDb: vi.fn(() => ({})),
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "mock-jwks"),
  jwtVerify: vi.fn().mockResolvedValue({
    payload: { sub: "user123", email: "test@example.com" },
    protectedHeader: { alg: "RS256" },
  }),
}));

vi.mock("../lib/logger.js", () => ({
  getLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn() })),
}));

vi.mock("../jobs/index.js", () => ({
  enqueueJob: vi.fn().mockResolvedValue("job-123"),
}));

vi.mock("../middleware/requirePermission.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware/requirePermission.js")>();
  return {
    ...actual,
    resolveUserPermissions: vi.fn().mockResolvedValue(new Set<string>()),
  };
});

import { appRouter } from "./index.js";
import { resolveUserPermissions } from "../middleware/requirePermission.js";

describe("permissionRouter", () => {
  const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
  const OTHER_USER_ID = "660e8400-e29b-41d4-a716-446655440001";
  const ROLE_ID = "770e8400-e29b-41d4-a716-446655440002";

  const mockAdminUser = {
    id: USER_ID,
    sub: "user123",
    email: "test@example.com",
    name: "Admin User",
    role: "admin",
    roleId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockRegularUser = {
    id: USER_ID,
    sub: "user123",
    email: "test@example.com",
    name: "Regular User",
    role: "user",
    roleId: ROLE_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockRole = {
    id: ROLE_ID,
    name: "Editor",
    description: "Can edit content",
    isSystem: false,
    maxActiveSessions: null,
    maxOrgMemberships: null,
    maxReposPerOrg: null,
    maxIdeasPerRepo: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSystemRole = {
    id: "880e8400-e29b-41d4-a716-446655440003",
    name: "Admin",
    description: "System administrator",
    isSystem: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPubsub = {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    close: vi.fn(),
  };

  let resultQueue: unknown[];
  let orderByQueue: unknown[];

  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn(function (this: any) { return this; }),
    limit: vi.fn(() => {
      const result = resultQueue.shift();
      return Promise.resolve(result ?? []);
    }),
    then: vi.fn((resolve: any) => {
      const result = orderByQueue.shift();
      return Promise.resolve(result ?? []).then(resolve);
    }),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue([]),
  };

  const createCaller = (authenticated = false) =>
    appRouter.createCaller({
      user: authenticated
        ? { sub: "user123", email: "test@example.com" }
        : null,
      db: mockDb as any,
      pubsub: mockPubsub as any,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    resultQueue = [];
    orderByQueue = [];

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockImplementation(function (this: any) { return this; });
    mockDb.limit.mockImplementation(() => {
      const result = resultQueue.shift();
      return Promise.resolve(result ?? []);
    });
    mockDb.then.mockImplementation((resolve: any) => {
      const result = orderByQueue.shift();
      return Promise.resolve(result ?? []).then(resolve);
    });
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValue([]);
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.delete.mockReturnThis();
    mockDb.onConflictDoUpdate.mockResolvedValue(undefined);
    mockDb.execute.mockResolvedValue([]);
  });

  // ── listPermissions ──────────────────────────────────────────────

  describe("listPermissions", () => {
    it("returns all permissions for admin", async () => {
      const mockPermissions = [
        { id: "p1", key: "org:create", category: "Organization", description: "Create orgs" },
        { id: "p2", key: "org:delete", category: "Organization", description: "Delete orgs" },
      ];

      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // listPermissions: select().from(permissions).orderBy() — terminal orderBy
      orderByQueue.push(mockPermissions);

      const caller = createCaller(true);
      const result = await caller.permission.listPermissions();

      expect(result).toEqual(mockPermissions);
    });

    it("requires auth", async () => {
      const caller = createCaller(false);
      await expect(caller.permission.listPermissions()).rejects.toThrow("UNAUTHORIZED");
    });

    it("rejects non-admin user", async () => {
      // protectedProcedure: lookupUserId (non-admin)
      resultQueue.push([mockRegularUser]);

      const caller = createCaller(true);
      await expect(caller.permission.listPermissions()).rejects.toThrow("Admin access required");
    });
  });

  // ── listRoles ────────────────────────────────────────────────────

  describe("listRoles", () => {
    it("returns roles with their permissions", async () => {
      const rolePerms = [{ permissionKey: "org:create" }, { permissionKey: "org:delete" }];

      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // listRoles: select().from(roles).orderBy() — terminal orderBy
      orderByQueue.push([mockRole]);
      // For each role, query permissions: select().from(rolePermissions).where() — terminal where
      orderByQueue.push(rolePerms);

      const caller = createCaller(true);
      const result = await caller.permission.listRoles();

      expect(result).toEqual([
        { ...mockRole, permissions: ["org:create", "org:delete"] },
      ]);
    });

    it("returns limit fields in role data", async () => {
      const roleWithLimits = {
        ...mockRole,
        maxActiveSessions: 5,
        maxOrgMemberships: 3,
        maxReposPerOrg: 10,
        maxIdeasPerRepo: 50,
      };

      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // listRoles: select().from(roles).orderBy() — terminal orderBy
      orderByQueue.push([roleWithLimits]);
      // For each role, query permissions
      orderByQueue.push([]);

      const caller = createCaller(true);
      const result = await caller.permission.listRoles();

      expect(result[0]).toEqual(
        expect.objectContaining({
          maxActiveSessions: 5,
          maxOrgMemberships: 3,
          maxReposPerOrg: 10,
          maxIdeasPerRepo: 50,
        }),
      );
    });

    it("returns empty array when no roles exist", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // listRoles: no roles
      orderByQueue.push([]);

      const caller = createCaller(true);
      const result = await caller.permission.listRoles();

      expect(result).toEqual([]);
    });

    it("requires auth", async () => {
      const caller = createCaller(false);
      await expect(caller.permission.listRoles()).rejects.toThrow("UNAUTHORIZED");
    });

    it("rejects non-admin user", async () => {
      resultQueue.push([mockRegularUser]);

      const caller = createCaller(true);
      await expect(caller.permission.listRoles()).rejects.toThrow("Admin access required");
    });
  });

  // ── getRole ──────────────────────────────────────────────────────

  describe("getRole", () => {
    it("returns role with permissions", async () => {
      const rolePerms = [{ permissionKey: "org:create" }];

      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // getRole: select().from(roles).where().limit(1)
      resultQueue.push([mockRole]);
      // get role permissions: select().from(rolePermissions).where() — terminal where
      orderByQueue.push(rolePerms);

      const caller = createCaller(true);
      const result = await caller.permission.getRole({ id: ROLE_ID });

      expect(result).toEqual({ ...mockRole, permissions: ["org:create"] });
    });

    it("returns limit fields in role data", async () => {
      const roleWithLimits = {
        ...mockRole,
        maxActiveSessions: 5,
        maxOrgMemberships: 3,
        maxReposPerOrg: 10,
        maxIdeasPerRepo: 50,
      };

      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // getRole: select().from(roles).where().limit(1)
      resultQueue.push([roleWithLimits]);
      // get role permissions
      orderByQueue.push([]);

      const caller = createCaller(true);
      const result = await caller.permission.getRole({ id: ROLE_ID });

      expect(result).toEqual(
        expect.objectContaining({
          maxActiveSessions: 5,
          maxOrgMemberships: 3,
          maxReposPerOrg: 10,
          maxIdeasPerRepo: 50,
        }),
      );
    });

    it("throws NOT_FOUND when role does not exist", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // getRole: no role found
      resultQueue.push([]);

      const caller = createCaller(true);
      await expect(
        caller.permission.getRole({ id: ROLE_ID }),
      ).rejects.toThrow("Role not found");
    });

    it("requires auth", async () => {
      const caller = createCaller(false);
      await expect(
        caller.permission.getRole({ id: ROLE_ID }),
      ).rejects.toThrow("UNAUTHORIZED");
    });

    it("rejects non-admin user", async () => {
      resultQueue.push([mockRegularUser]);

      const caller = createCaller(true);
      await expect(
        caller.permission.getRole({ id: ROLE_ID }),
      ).rejects.toThrow("Admin access required");
    });
  });

  // ── createRole ───────────────────────────────────────────────────

  describe("createRole", () => {
    it("creates a new role", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // createRole: check existing by name — select().from(roles).where().limit(1)
      resultQueue.push([]);
      // insert().values().returning()
      mockDb.returning.mockResolvedValueOnce([mockRole]);

      const caller = createCaller(true);
      const result = await caller.permission.createRole({
        name: "Editor",
        description: "Can edit content",
      });

      expect(result).toEqual(mockRole);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("throws CONFLICT when role name already exists", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // createRole: existing role found
      resultQueue.push([mockRole]);

      const caller = createCaller(true);
      await expect(
        caller.permission.createRole({ name: "Editor" }),
      ).rejects.toThrow('Role "Editor" already exists');
    });

    it("creates a role without description", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // createRole: no existing
      resultQueue.push([]);
      const roleWithoutDesc = { ...mockRole, description: null };
      mockDb.returning.mockResolvedValueOnce([roleWithoutDesc]);

      const caller = createCaller(true);
      const result = await caller.permission.createRole({ name: "Editor" });

      expect(result).toEqual(roleWithoutDesc);
    });

    it("requires auth", async () => {
      const caller = createCaller(false);
      await expect(
        caller.permission.createRole({ name: "Editor" }),
      ).rejects.toThrow("UNAUTHORIZED");
    });

    it("rejects non-admin user", async () => {
      resultQueue.push([mockRegularUser]);

      const caller = createCaller(true);
      await expect(
        caller.permission.createRole({ name: "Editor" }),
      ).rejects.toThrow("Admin access required");
    });
  });

  // ── updateRole ───────────────────────────────────────────────────

  describe("updateRole", () => {
    it("updates a role name and description", async () => {
      const updatedRole = { ...mockRole, name: "Super Editor", description: "Updated desc" };

      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // updateRole: fetch existing role
      resultQueue.push([mockRole]);
      // update().set().where().returning()
      mockDb.returning.mockResolvedValueOnce([updatedRole]);

      const caller = createCaller(true);
      const result = await caller.permission.updateRole({
        id: ROLE_ID,
        name: "Super Editor",
        description: "Updated desc",
      });

      expect(result).toEqual(updatedRole);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it("throws NOT_FOUND when role does not exist", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // updateRole: no role found
      resultQueue.push([]);

      const caller = createCaller(true);
      await expect(
        caller.permission.updateRole({ id: ROLE_ID, name: "New Name" }),
      ).rejects.toThrow("Role not found");
    });

    it("throws FORBIDDEN when renaming a system role", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // updateRole: fetch system role
      resultQueue.push([mockSystemRole]);

      const caller = createCaller(true);
      await expect(
        caller.permission.updateRole({ id: mockSystemRole.id, name: "Renamed Admin" }),
      ).rejects.toThrow("Cannot rename system roles");
    });

    it("allows updating description of a system role", async () => {
      const updatedSystemRole = { ...mockSystemRole, description: "Updated system desc" };

      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // updateRole: fetch system role
      resultQueue.push([mockSystemRole]);
      // update().set().where().returning()
      mockDb.returning.mockResolvedValueOnce([updatedSystemRole]);

      const caller = createCaller(true);
      const result = await caller.permission.updateRole({
        id: mockSystemRole.id,
        description: "Updated system desc",
      });

      expect(result).toEqual(updatedSystemRole);
    });

    it("allows setting same name on a system role", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // updateRole: fetch system role
      resultQueue.push([mockSystemRole]);
      // update().set().where().returning()
      mockDb.returning.mockResolvedValueOnce([mockSystemRole]);

      const caller = createCaller(true);
      const result = await caller.permission.updateRole({
        id: mockSystemRole.id,
        name: "Admin", // same name as existing
      });

      expect(result).toEqual(mockSystemRole);
    });

    it("requires auth", async () => {
      const caller = createCaller(false);
      await expect(
        caller.permission.updateRole({ id: ROLE_ID, name: "X" }),
      ).rejects.toThrow("UNAUTHORIZED");
    });

    it("rejects non-admin user", async () => {
      resultQueue.push([mockRegularUser]);

      const caller = createCaller(true);
      await expect(
        caller.permission.updateRole({ id: ROLE_ID, name: "X" }),
      ).rejects.toThrow("Admin access required");
    });

    it("persists limit fields", async () => {
      const updatedRole = {
        ...mockRole,
        maxActiveSessions: 5,
        maxOrgMemberships: 3,
        maxReposPerOrg: 10,
        maxIdeasPerRepo: 50,
      };

      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // updateRole: fetch existing role
      resultQueue.push([mockRole]);
      // update().set().where().returning()
      mockDb.returning.mockResolvedValueOnce([updatedRole]);

      const caller = createCaller(true);
      const result = await caller.permission.updateRole({
        id: ROLE_ID,
        maxActiveSessions: 5,
        maxOrgMemberships: 3,
        maxReposPerOrg: 10,
        maxIdeasPerRepo: 50,
      });

      expect(result).toEqual(updatedRole);
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          maxActiveSessions: 5,
          maxOrgMemberships: 3,
          maxReposPerOrg: 10,
          maxIdeasPerRepo: 50,
        }),
      );
    });

    it("can set a limit to null (clear it)", async () => {
      const updatedRole = {
        ...mockRole,
        maxActiveSessions: null,
        maxOrgMemberships: null,
        maxReposPerOrg: null,
        maxIdeasPerRepo: null,
      };

      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // updateRole: fetch existing role
      resultQueue.push([mockRole]);
      // update().set().where().returning()
      mockDb.returning.mockResolvedValueOnce([updatedRole]);

      const caller = createCaller(true);
      const result = await caller.permission.updateRole({
        id: ROLE_ID,
        maxActiveSessions: null,
        maxOrgMemberships: null,
        maxReposPerOrg: null,
        maxIdeasPerRepo: null,
      });

      expect(result).toEqual(updatedRole);
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          maxActiveSessions: null,
          maxOrgMemberships: null,
          maxReposPerOrg: null,
          maxIdeasPerRepo: null,
        }),
      );
    });
  });

  // ── deleteRole ───────────────────────────────────────────────────

  describe("deleteRole", () => {
    it("deletes a non-system role", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // deleteRole: fetch existing role
      resultQueue.push([mockRole]);

      const caller = createCaller(true);
      const result = await caller.permission.deleteRole({ id: ROLE_ID });

      expect(result).toEqual({ success: true });
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it("throws NOT_FOUND when role does not exist", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // deleteRole: no role found
      resultQueue.push([]);

      const caller = createCaller(true);
      await expect(
        caller.permission.deleteRole({ id: ROLE_ID }),
      ).rejects.toThrow("Role not found");
    });

    it("throws FORBIDDEN when deleting a system role", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // deleteRole: fetch system role
      resultQueue.push([mockSystemRole]);

      const caller = createCaller(true);
      await expect(
        caller.permission.deleteRole({ id: mockSystemRole.id }),
      ).rejects.toThrow("Cannot delete system roles");
    });

    it("requires auth", async () => {
      const caller = createCaller(false);
      await expect(
        caller.permission.deleteRole({ id: ROLE_ID }),
      ).rejects.toThrow("UNAUTHORIZED");
    });

    it("rejects non-admin user", async () => {
      resultQueue.push([mockRegularUser]);

      const caller = createCaller(true);
      await expect(
        caller.permission.deleteRole({ id: ROLE_ID }),
      ).rejects.toThrow("Admin access required");
    });
  });

  // ── myPermissions ────────────────────────────────────────────────

  describe("myPermissions", () => {
    it("returns all permission keys for admin user", async () => {
      // protectedProcedure: lookupUserId (admin)
      resultQueue.push([mockAdminUser]);

      const caller = createCaller(true);
      const result = await caller.permission.myPermissions();

      expect(result.role).toEqual({
        id: mockAdminUser.roleId,
        name: "admin",
        isSystem: true,
      });
      // Admin gets all PermissionKeySchema.options
      expect(result.permissions.length).toBeGreaterThan(0);
      expect(result.permissions).toContain("org:create");
      expect(result.permissions).toContain("admin:users:manage");
    });

    it("returns resolved permissions for non-admin user with role", async () => {
      const userPerms = new Set(["org:create", "session:create:spec"]);
      vi.mocked(resolveUserPermissions).mockResolvedValueOnce(userPerms);

      // protectedProcedure: lookupUserId (regular user)
      resultQueue.push([mockRegularUser]);
      // myPermissions: fetch role info — select().from(roles).where().limit(1)
      resultQueue.push([{ id: ROLE_ID, name: "Editor", isSystem: false }]);

      const caller = createCaller(true);
      const result = await caller.permission.myPermissions();

      expect(result.permissions).toEqual(expect.arrayContaining(["org:create", "session:create:spec"]));
      expect(result.role).toEqual({ id: ROLE_ID, name: "Editor", isSystem: false });
      expect(resolveUserPermissions).toHaveBeenCalledWith(
        mockDb,
        USER_ID,
        ROLE_ID,
      );
    });

    it("returns empty permissions for non-admin user without role", async () => {
      const userWithoutRole = { ...mockRegularUser, roleId: null };
      vi.mocked(resolveUserPermissions).mockResolvedValueOnce(new Set());

      // protectedProcedure: lookupUserId
      resultQueue.push([userWithoutRole]);

      const caller = createCaller(true);
      const result = await caller.permission.myPermissions();

      expect(result.permissions).toEqual([]);
      expect(result.role).toBeNull();
    });

    it("returns empty when dbUser is null", async () => {
      // protectedProcedure: lookupUserId — no user found
      resultQueue.push([]);

      const caller = createCaller(true);
      const result = await caller.permission.myPermissions();

      expect(result).toEqual({ permissions: [], role: null });
    });

    it("requires auth", async () => {
      const caller = createCaller(false);
      await expect(caller.permission.myPermissions()).rejects.toThrow("UNAUTHORIZED");
    });
  });

  // ── setRolePermissions ───────────────────────────────────────────

  describe("setRolePermissions", () => {
    it("replaces all permissions for a role", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);

      const caller = createCaller(true);
      const result = await caller.permission.setRolePermissions({
        roleId: ROLE_ID,
        permissionKeys: ["org:create", "org:update"],
      });

      expect(result).toEqual({ success: true, count: 2 });
      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("clears all permissions when empty array passed", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);

      const caller = createCaller(true);
      const result = await caller.permission.setRolePermissions({
        roleId: ROLE_ID,
        permissionKeys: [],
      });

      expect(result).toEqual({ success: true, count: 0 });
      expect(mockDb.delete).toHaveBeenCalled();
      // insert should NOT be called when empty
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("requires auth", async () => {
      const caller = createCaller(false);
      await expect(
        caller.permission.setRolePermissions({
          roleId: ROLE_ID,
          permissionKeys: ["org:create"],
        }),
      ).rejects.toThrow("UNAUTHORIZED");
    });

    it("rejects non-admin user", async () => {
      resultQueue.push([mockRegularUser]);

      const caller = createCaller(true);
      await expect(
        caller.permission.setRolePermissions({
          roleId: ROLE_ID,
          permissionKeys: ["org:create"],
        }),
      ).rejects.toThrow("Admin access required");
    });
  });

  // ── addRolePermission ────────────────────────────────────────────

  describe("addRolePermission", () => {
    it("adds a permission to a role", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // addRolePermission: verify role exists
      resultQueue.push([mockRole]);
      // addRolePermission: check existing mapping
      resultQueue.push([]);

      const caller = createCaller(true);
      const result = await caller.permission.addRolePermission({
        roleId: ROLE_ID,
        permissionKey: "org:create",
      });

      expect(result).toEqual({ success: true });
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("throws NOT_FOUND when role does not exist", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // addRolePermission: role not found
      resultQueue.push([]);

      const caller = createCaller(true);
      await expect(
        caller.permission.addRolePermission({
          roleId: ROLE_ID,
          permissionKey: "org:create",
        }),
      ).rejects.toThrow("Role not found");
    });

    it("throws CONFLICT when permission already assigned", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // addRolePermission: role exists
      resultQueue.push([mockRole]);
      // addRolePermission: existing mapping found
      resultQueue.push([{ roleId: ROLE_ID, permissionKey: "org:create" }]);

      const caller = createCaller(true);
      await expect(
        caller.permission.addRolePermission({
          roleId: ROLE_ID,
          permissionKey: "org:create",
        }),
      ).rejects.toThrow("Role already has this permission");
    });

    it("requires auth", async () => {
      const caller = createCaller(false);
      await expect(
        caller.permission.addRolePermission({
          roleId: ROLE_ID,
          permissionKey: "org:create",
        }),
      ).rejects.toThrow("UNAUTHORIZED");
    });

    it("rejects non-admin user", async () => {
      resultQueue.push([mockRegularUser]);

      const caller = createCaller(true);
      await expect(
        caller.permission.addRolePermission({
          roleId: ROLE_ID,
          permissionKey: "org:create",
        }),
      ).rejects.toThrow("Admin access required");
    });
  });

  // ── removeRolePermission ─────────────────────────────────────────

  describe("removeRolePermission", () => {
    it("removes a permission from a role", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // removeRolePermission: verify role exists
      resultQueue.push([mockRole]);

      const caller = createCaller(true);
      const result = await caller.permission.removeRolePermission({
        roleId: ROLE_ID,
        permissionKey: "org:create",
      });

      expect(result).toEqual({ success: true });
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it("throws NOT_FOUND when role does not exist", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // removeRolePermission: role not found
      resultQueue.push([]);

      const caller = createCaller(true);
      await expect(
        caller.permission.removeRolePermission({
          roleId: ROLE_ID,
          permissionKey: "org:create",
        }),
      ).rejects.toThrow("Role not found");
    });

    it("requires auth", async () => {
      const caller = createCaller(false);
      await expect(
        caller.permission.removeRolePermission({
          roleId: ROLE_ID,
          permissionKey: "org:create",
        }),
      ).rejects.toThrow("UNAUTHORIZED");
    });

    it("rejects non-admin user", async () => {
      resultQueue.push([mockRegularUser]);

      const caller = createCaller(true);
      await expect(
        caller.permission.removeRolePermission({
          roleId: ROLE_ID,
          permissionKey: "org:create",
        }),
      ).rejects.toThrow("Admin access required");
    });
  });

  // ── listUserOverrides ────────────────────────────────────────────

  describe("listUserOverrides", () => {
    it("returns user permission overrides", async () => {
      const overrides = [
        { userId: OTHER_USER_ID, permissionKey: "org:create", granted: true },
        { userId: OTHER_USER_ID, permissionKey: "org:delete", granted: false },
      ];

      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // listUserOverrides: select().from(userPermissionOverrides).where() — terminal where
      orderByQueue.push(overrides);

      const caller = createCaller(true);
      const result = await caller.permission.listUserOverrides({ userId: OTHER_USER_ID });

      expect(result).toEqual(overrides);
    });

    it("returns empty array when no overrides exist", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // listUserOverrides: no overrides
      orderByQueue.push([]);

      const caller = createCaller(true);
      const result = await caller.permission.listUserOverrides({ userId: OTHER_USER_ID });

      expect(result).toEqual([]);
    });

    it("requires auth", async () => {
      const caller = createCaller(false);
      await expect(
        caller.permission.listUserOverrides({ userId: OTHER_USER_ID }),
      ).rejects.toThrow("UNAUTHORIZED");
    });

    it("rejects non-admin user", async () => {
      resultQueue.push([mockRegularUser]);

      const caller = createCaller(true);
      await expect(
        caller.permission.listUserOverrides({ userId: OTHER_USER_ID }),
      ).rejects.toThrow("Admin access required");
    });
  });

  // ── setUserOverride ──────────────────────────────────────────────

  describe("setUserOverride", () => {
    it("upserts a user permission override (grant)", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);

      const caller = createCaller(true);
      const result = await caller.permission.setUserOverride({
        userId: OTHER_USER_ID,
        permissionKey: "org:create",
        granted: true,
      });

      expect(result).toEqual({ success: true });
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.onConflictDoUpdate).toHaveBeenCalled();
    });

    it("upserts a user permission override (deny)", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);

      const caller = createCaller(true);
      const result = await caller.permission.setUserOverride({
        userId: OTHER_USER_ID,
        permissionKey: "org:delete",
        granted: false,
      });

      expect(result).toEqual({ success: true });
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.onConflictDoUpdate).toHaveBeenCalled();
    });

    it("requires auth", async () => {
      const caller = createCaller(false);
      await expect(
        caller.permission.setUserOverride({
          userId: OTHER_USER_ID,
          permissionKey: "org:create",
          granted: true,
        }),
      ).rejects.toThrow("UNAUTHORIZED");
    });

    it("rejects non-admin user", async () => {
      resultQueue.push([mockRegularUser]);

      const caller = createCaller(true);
      await expect(
        caller.permission.setUserOverride({
          userId: OTHER_USER_ID,
          permissionKey: "org:create",
          granted: true,
        }),
      ).rejects.toThrow("Admin access required");
    });
  });

  // ── removeUserOverride ───────────────────────────────────────────

  describe("removeUserOverride", () => {
    it("removes a user permission override", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);

      const caller = createCaller(true);
      const result = await caller.permission.removeUserOverride({
        userId: OTHER_USER_ID,
        permissionKey: "org:create",
      });

      expect(result).toEqual({ success: true });
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it("requires auth", async () => {
      const caller = createCaller(false);
      await expect(
        caller.permission.removeUserOverride({
          userId: OTHER_USER_ID,
          permissionKey: "org:create",
        }),
      ).rejects.toThrow("UNAUTHORIZED");
    });

    it("rejects non-admin user", async () => {
      resultQueue.push([mockRegularUser]);

      const caller = createCaller(true);
      await expect(
        caller.permission.removeUserOverride({
          userId: OTHER_USER_ID,
          permissionKey: "org:create",
        }),
      ).rejects.toThrow("Admin access required");
    });
  });

  // ── assignRole ───────────────────────────────────────────────────

  describe("assignRole", () => {
    it("assigns a role to a user", async () => {
      const updatedUser = { ...mockRegularUser, roleId: ROLE_ID };

      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // assignRole: verify role exists
      resultQueue.push([mockRole]);
      // update().set().where().returning()
      mockDb.returning.mockResolvedValueOnce([updatedUser]);

      const caller = createCaller(true);
      const result = await caller.permission.assignRole({
        userId: OTHER_USER_ID,
        roleId: ROLE_ID,
      });

      expect(result).toEqual(updatedUser);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it("throws NOT_FOUND when role does not exist", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // assignRole: role not found
      resultQueue.push([]);

      const caller = createCaller(true);
      await expect(
        caller.permission.assignRole({ userId: OTHER_USER_ID, roleId: ROLE_ID }),
      ).rejects.toThrow("Role not found");
    });

    it("throws NOT_FOUND when user does not exist", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // assignRole: role exists
      resultQueue.push([mockRole]);
      // update().set().where().returning() — user not found
      mockDb.returning.mockResolvedValueOnce([]);

      const caller = createCaller(true);
      await expect(
        caller.permission.assignRole({ userId: OTHER_USER_ID, roleId: ROLE_ID }),
      ).rejects.toThrow("User not found");
    });

    it("requires auth", async () => {
      const caller = createCaller(false);
      await expect(
        caller.permission.assignRole({ userId: OTHER_USER_ID, roleId: ROLE_ID }),
      ).rejects.toThrow("UNAUTHORIZED");
    });

    it("rejects non-admin user", async () => {
      resultQueue.push([mockRegularUser]);

      const caller = createCaller(true);
      await expect(
        caller.permission.assignRole({ userId: OTHER_USER_ID, roleId: ROLE_ID }),
      ).rejects.toThrow("Admin access required");
    });
  });

  // ── myLimits ────────────────────────────────────────────────────

  describe("myLimits", () => {
    const nullLimits = {
      maxActiveSessions: null,
      maxOrgMemberships: null,
      maxReposPerOrg: null,
      maxIdeasPerRepo: null,
      maxWorkers: null,
    };

    it("returns null limits and usage for admin", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // single execute() for all counts + role limits
      mockDb.execute.mockResolvedValueOnce([{
        session_count: 3, org_count: 2, worker_count: 4,
        max_active_sessions: null, max_org_memberships: null,
        max_repos_per_org: null, max_ideas_per_repo: null, max_workers: null,
      }]);

      const caller = createCaller(true);
      const result = await caller.permission.myLimits();
      expect(result).toEqual({
        limits: nullLimits,
        usage: { activeSessions: 3, orgMemberships: 2, currentWorkers: 4 },
      });
    });

    it("returns null limits and usage for user without roleId", async () => {
      // protectedProcedure: lookupUserId — member with no role
      resultQueue.push([{ ...mockAdminUser, role: "member", roleId: null }]);
      // single execute() for all counts + role limits
      mockDb.execute.mockResolvedValueOnce([{
        session_count: 1, org_count: 0, worker_count: 0,
        max_active_sessions: null, max_org_memberships: null,
        max_repos_per_org: null, max_ideas_per_repo: null, max_workers: null,
      }]);

      const caller = createCaller(true);
      const result = await caller.permission.myLimits();
      expect(result).toEqual({
        limits: nullLimits,
        usage: { activeSessions: 1, orgMemberships: 0, currentWorkers: 0 },
      });
    });

    it("returns limits and usage for user with role", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([{ ...mockAdminUser, role: "member", roleId: ROLE_ID }]);
      // single execute() for all counts + role limits
      mockDb.execute.mockResolvedValueOnce([{
        session_count: 2, org_count: 1, worker_count: 3,
        max_active_sessions: 5, max_org_memberships: 3,
        max_repos_per_org: 10, max_ideas_per_repo: 50, max_workers: 5,
      }]);

      const caller = createCaller(true);
      const result = await caller.permission.myLimits();
      expect(result).toEqual({
        limits: {
          maxActiveSessions: 5,
          maxOrgMemberships: 3,
          maxReposPerOrg: 10,
          maxIdeasPerRepo: 50,
          maxWorkers: 5,
        },
        usage: { activeSessions: 2, orgMemberships: 1, currentWorkers: 3 },
      });
    });

    it("returns correct maxWorkers and currentWorkers for user with role", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([{ ...mockRegularUser, role: "member", roleId: ROLE_ID }]);
      // single execute() for all counts + role limits
      mockDb.execute.mockResolvedValueOnce([{
        session_count: 0, org_count: 0, worker_count: 3,
        max_active_sessions: null, max_org_memberships: null,
        max_repos_per_org: null, max_ideas_per_repo: null, max_workers: 5,
      }]);

      const caller = createCaller(true);
      const result = await caller.permission.myLimits();

      expect(result.limits.maxWorkers).toBe(5);
      expect(result.usage.currentWorkers).toBe(3);
    });

    it("admin returns null maxWorkers (unlimited) with correct worker count", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // single execute() for all counts + role limits
      mockDb.execute.mockResolvedValueOnce([{
        session_count: 0, org_count: 0, worker_count: 7,
        max_active_sessions: null, max_org_memberships: null,
        max_repos_per_org: null, max_ideas_per_repo: null, max_workers: null,
      }]);

      const caller = createCaller(true);
      const result = await caller.permission.myLimits();

      expect(result.limits.maxWorkers).toBeNull();
      expect(result.usage.currentWorkers).toBe(7);
    });

    it("requires authentication", async () => {
      const caller = createCaller(false);
      await expect(caller.permission.myLimits()).rejects.toThrow("UNAUTHORIZED");
    });
  });

  // ── updateRoleLimits ────────────────────────────────────────────

  describe("updateRoleLimits", () => {
    it("saves limits and returns updated role", async () => {
      const updatedRole = {
        ...mockRole,
        maxActiveSessions: 10,
        maxWorkers: 5,
      };

      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // updateRoleLimits: fetch existing role
      resultQueue.push([mockRole]);
      // update().set().where().returning()
      mockDb.returning.mockResolvedValueOnce([updatedRole]);

      const caller = createCaller(true);
      const result = await caller.permission.updateRoleLimits({
        roleId: ROLE_ID,
        limits: { maxActiveSessions: 10, maxWorkers: 5 },
      });

      expect(result).toEqual(updatedRole);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          maxActiveSessions: 10,
          maxWorkers: 5,
        }),
      );
    });

    it("throws NOT_FOUND when role does not exist", async () => {
      // protectedProcedure: lookupUserId
      resultQueue.push([mockAdminUser]);
      // updateRoleLimits: no role found
      resultQueue.push([]);

      const caller = createCaller(true);
      await expect(
        caller.permission.updateRoleLimits({
          roleId: ROLE_ID,
          limits: { maxWorkers: 5 },
        }),
      ).rejects.toThrow("Role not found");
    });

    it("requires auth", async () => {
      const caller = createCaller(false);
      await expect(
        caller.permission.updateRoleLimits({
          roleId: ROLE_ID,
          limits: { maxWorkers: 5 },
        }),
      ).rejects.toThrow("UNAUTHORIZED");
    });

    it("rejects non-admin user", async () => {
      resultQueue.push([mockRegularUser]);

      const caller = createCaller(true);
      await expect(
        caller.permission.updateRoleLimits({
          roleId: ROLE_ID,
          limits: { maxWorkers: 5 },
        }),
      ).rejects.toThrow("Admin access required");
    });
  });
});
