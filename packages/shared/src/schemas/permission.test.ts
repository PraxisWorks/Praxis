import { describe, it, expect } from "vitest";
import {
  PermissionKeySchema,
  CreatePermissionRoleSchema,
  UpdatePermissionRoleSchema,
  PermissionRoleSchema,
  RolePermissionSchema,
  UserPermissionOverrideSchema,
  AssignRoleSchema,
  LimitKeySchema,
  SetRoleLimitsSchema,
  GetRoleLimitsSchema,
  RoleLimitsSchema,
  UpdateRoleLimitsSchema,
  MyLimitsResponseSchema,
} from "./permission.js";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("PermissionKeySchema", () => {
  it("accepts all valid permission keys", () => {
    const keys = [
      "org:create",
      "org:delete",
      "org:update",
      "org:member:invite",
      "org:member:remove",
      "session:create:spec",
      "session:create:architecture",
      "session:create:working",
      "session:create:debug",
      "session:create:repo",
      "session:instructions:edit",
      "session:instructions:append",
      "repo:create",
      "repo:add",
      "worker:create:local",
      "worker:create:apikey",
      "worker:delete",
      "idea:read",
      "task:read",
      "plan:read",
      "repo:read",
      "session:read",
      "stats:read",
      "spec:read",
      "admin:users:manage",
      "admin:roles:manage",
      "admin:permissions:manage",
    ];
    for (const key of keys) {
      expect(PermissionKeySchema.safeParse(key).success).toBe(true);
    }
  });

  it("includes repo:create permission key", () => {
    expect(PermissionKeySchema.safeParse("repo:create").success).toBe(true);
  });

  it("includes repo:add permission key", () => {
    expect(PermissionKeySchema.safeParse("repo:add").success).toBe(true);
  });

  it("has at least 15 keys", () => {
    expect(PermissionKeySchema.options.length).toBeGreaterThanOrEqual(24);
  });

  it("rejects unknown permission key", () => {
    expect(PermissionKeySchema.safeParse("unknown:key").success).toBe(false);
  });

  it("accepts worker:create:local permission key", () => {
    expect(PermissionKeySchema.safeParse("worker:create:local").success).toBe(true);
  });

  it("accepts worker:create:apikey permission key", () => {
    expect(PermissionKeySchema.safeParse("worker:create:apikey").success).toBe(true);
  });

  it("rejects old worker:create permission key", () => {
    expect(PermissionKeySchema.safeParse("worker:create").success).toBe(false);
  });
});

describe("CreatePermissionRoleSchema", () => {
  it("accepts valid input", () => {
    const result = CreatePermissionRoleSchema.safeParse({ name: "Editor" });
    expect(result.success).toBe(true);
  });

  it("accepts valid input with description", () => {
    const result = CreatePermissionRoleSchema.safeParse({
      name: "Editor",
      description: "Can edit content",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = CreatePermissionRoleSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects name over 100 characters", () => {
    const result = CreatePermissionRoleSchema.safeParse({ name: "a".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("rejects description over 500 characters", () => {
    const result = CreatePermissionRoleSchema.safeParse({
      name: "Editor",
      description: "a".repeat(501),
    });
    expect(result.success).toBe(false);
  });
});

describe("UpdatePermissionRoleSchema", () => {
  it("accepts valid input with name only", () => {
    const result = UpdatePermissionRoleSchema.safeParse({ id: VALID_UUID, name: "New Name" });
    expect(result.success).toBe(true);
  });

  it("accepts valid input with description only", () => {
    const result = UpdatePermissionRoleSchema.safeParse({
      id: VALID_UUID,
      description: "Updated description",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing id", () => {
    const result = UpdatePermissionRoleSchema.safeParse({ name: "New Name" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid uuid for id", () => {
    const result = UpdatePermissionRoleSchema.safeParse({ id: "not-a-uuid", name: "New Name" });
    expect(result.success).toBe(false);
  });

  it("rejects empty name when provided", () => {
    const result = UpdatePermissionRoleSchema.safeParse({ id: VALID_UUID, name: "" });
    expect(result.success).toBe(false);
  });
});

describe("PermissionRoleSchema", () => {
  const validRole = {
    id: VALID_UUID,
    name: "Admin",
    description: "Full access",
    isSystem: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("accepts valid role", () => {
    const result = PermissionRoleSchema.safeParse(validRole);
    expect(result.success).toBe(true);
  });

  it("accepts null description", () => {
    const result = PermissionRoleSchema.safeParse({ ...validRole, description: null });
    expect(result.success).toBe(true);
  });

  it("rejects invalid uuid", () => {
    const result = PermissionRoleSchema.safeParse({ ...validRole, id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects missing isSystem", () => {
    const { isSystem: _, ...withoutIsSystem } = validRole;
    const result = PermissionRoleSchema.safeParse(withoutIsSystem);
    expect(result.success).toBe(false);
  });
});

describe("RolePermissionSchema", () => {
  it("accepts valid input", () => {
    const result = RolePermissionSchema.safeParse({
      roleId: VALID_UUID,
      permissionKey: "org:create",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid uuid for roleId", () => {
    const result = RolePermissionSchema.safeParse({
      roleId: "not-a-uuid",
      permissionKey: "org:create",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid permission key", () => {
    const result = RolePermissionSchema.safeParse({
      roleId: VALID_UUID,
      permissionKey: "invalid:key",
    });
    expect(result.success).toBe(false);
  });
});

describe("UserPermissionOverrideSchema", () => {
  it("accepts granted override", () => {
    const result = UserPermissionOverrideSchema.safeParse({
      userId: VALID_UUID,
      permissionKey: "admin:users:manage",
      granted: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts denied override", () => {
    const result = UserPermissionOverrideSchema.safeParse({
      userId: VALID_UUID,
      permissionKey: "admin:users:manage",
      granted: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid uuid for userId", () => {
    const result = UserPermissionOverrideSchema.safeParse({
      userId: "not-a-uuid",
      permissionKey: "admin:users:manage",
      granted: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing granted field", () => {
    const result = UserPermissionOverrideSchema.safeParse({
      userId: VALID_UUID,
      permissionKey: "admin:users:manage",
    });
    expect(result.success).toBe(false);
  });
});

describe("AssignRoleSchema", () => {
  it("accepts valid input", () => {
    const result = AssignRoleSchema.safeParse({
      userId: VALID_UUID,
      roleId: VALID_UUID,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid uuid for userId", () => {
    const result = AssignRoleSchema.safeParse({
      userId: "not-a-uuid",
      roleId: VALID_UUID,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid uuid for roleId", () => {
    const result = AssignRoleSchema.safeParse({
      userId: VALID_UUID,
      roleId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing userId", () => {
    const result = AssignRoleSchema.safeParse({ roleId: VALID_UUID });
    expect(result.success).toBe(false);
  });

  it("rejects missing roleId", () => {
    const result = AssignRoleSchema.safeParse({ userId: VALID_UUID });
    expect(result.success).toBe(false);
  });
});

describe("LimitKeySchema", () => {
  it("accepts all valid limit keys", () => {
    const keys = ["max_active_sessions", "max_org_memberships", "max_rigs_per_org", "max_ideas_per_rig"];
    for (const key of keys) {
      expect(LimitKeySchema.safeParse(key).success).toBe(true);
    }
  });

  it("rejects unknown limit key", () => {
    expect(LimitKeySchema.safeParse("max_something_else").success).toBe(false);
  });
});

describe("SetRoleLimitsSchema", () => {
  it("accepts valid input", () => {
    const result = SetRoleLimitsSchema.safeParse({
      roleId: VALID_UUID,
      limits: [{ key: "max_active_sessions", maxValue: 5 }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts maxValue of -1 (unlimited)", () => {
    const result = SetRoleLimitsSchema.safeParse({
      roleId: VALID_UUID,
      limits: [{ key: "max_active_sessions", maxValue: -1 }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts maxValue of 0", () => {
    const result = SetRoleLimitsSchema.safeParse({
      roleId: VALID_UUID,
      limits: [{ key: "max_active_sessions", maxValue: 0 }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects maxValue less than -1", () => {
    const result = SetRoleLimitsSchema.safeParse({
      roleId: VALID_UUID,
      limits: [{ key: "max_active_sessions", maxValue: -2 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty limits array", () => {
    const result = SetRoleLimitsSchema.safeParse({
      roleId: VALID_UUID,
      limits: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid roleId", () => {
    const result = SetRoleLimitsSchema.safeParse({
      roleId: "not-a-uuid",
      limits: [{ key: "max_active_sessions", maxValue: 5 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid limit key", () => {
    const result = SetRoleLimitsSchema.safeParse({
      roleId: VALID_UUID,
      limits: [{ key: "invalid_key", maxValue: 5 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("GetRoleLimitsSchema", () => {
  it("accepts valid roleId", () => {
    const result = GetRoleLimitsSchema.safeParse({ roleId: VALID_UUID });
    expect(result.success).toBe(true);
  });

  it("rejects invalid roleId", () => {
    const result = GetRoleLimitsSchema.safeParse({ roleId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });
});

describe("RoleLimitsSchema", () => {
  it("accepts all null values (unlimited)", () => {
    const result = RoleLimitsSchema.safeParse({
      maxActiveSessions: null,
      maxOrgMemberships: null,
      maxReposPerOrg: null,
      maxIdeasPerRepo: null,
      maxWorkers: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts integer values", () => {
    const result = RoleLimitsSchema.safeParse({
      maxActiveSessions: 5,
      maxOrgMemberships: 3,
      maxReposPerOrg: 10,
      maxIdeasPerRepo: 50,
      maxWorkers: 4,
    });
    expect(result.success).toBe(true);
  });

  it("accepts mixed null and integer values", () => {
    const result = RoleLimitsSchema.safeParse({
      maxActiveSessions: 5,
      maxOrgMemberships: null,
      maxReposPerOrg: 10,
      maxIdeasPerRepo: null,
      maxWorkers: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing fields", () => {
    const result = RoleLimitsSchema.safeParse({ maxActiveSessions: 5 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer numbers", () => {
    const result = RoleLimitsSchema.safeParse({
      maxActiveSessions: 5.5,
      maxOrgMemberships: null,
      maxReposPerOrg: null,
      maxIdeasPerRepo: null,
      maxWorkers: null,
    });
    expect(result.success).toBe(false);
  });
});

describe("UpdateRoleLimitsSchema", () => {
  it("accepts empty object (all optional)", () => {
    const result = UpdateRoleLimitsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts partial fields", () => {
    const result = UpdateRoleLimitsSchema.safeParse({ maxActiveSessions: 5 });
    expect(result.success).toBe(true);
  });

  it("accepts null values", () => {
    const result = UpdateRoleLimitsSchema.safeParse({ maxActiveSessions: null });
    expect(result.success).toBe(true);
  });

  it("rejects non-integer numbers", () => {
    const result = UpdateRoleLimitsSchema.safeParse({ maxActiveSessions: 3.14 });
    expect(result.success).toBe(false);
  });

  it("accepts maxWorkers partial update", () => {
    const result = UpdateRoleLimitsSchema.safeParse({ maxWorkers: 8 });
    expect(result.success).toBe(true);
  });

  it("accepts maxWorkers as null", () => {
    const result = UpdateRoleLimitsSchema.safeParse({ maxWorkers: null });
    expect(result.success).toBe(true);
  });
});

describe("MyLimitsResponseSchema", () => {
  it("accepts valid response", () => {
    const result = MyLimitsResponseSchema.safeParse({
      limits: {
        maxActiveSessions: 5,
        maxOrgMemberships: null,
        maxReposPerOrg: 10,
        maxIdeasPerRepo: null,
        maxWorkers: null,
      },
      usage: {
        activeSessions: 3,
        orgMemberships: 1,
        currentWorkers: 0,
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing usage", () => {
    const result = MyLimitsResponseSchema.safeParse({
      limits: {
        maxActiveSessions: null,
        maxOrgMemberships: null,
        maxReposPerOrg: null,
        maxIdeasPerRepo: null,
        maxWorkers: null,
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing limits", () => {
    const result = MyLimitsResponseSchema.safeParse({
      usage: { activeSessions: 0, orgMemberships: 0, currentWorkers: 0 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer usage values", () => {
    const result = MyLimitsResponseSchema.safeParse({
      limits: {
        maxActiveSessions: null,
        maxOrgMemberships: null,
        maxReposPerOrg: null,
        maxIdeasPerRepo: null,
        maxWorkers: null,
      },
      usage: {
        activeSessions: 1.5,
        orgMemberships: 0,
        currentWorkers: 0,
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("UpdatePermissionRoleSchema with limits", () => {
  it("accepts limit fields", () => {
    const result = UpdatePermissionRoleSchema.safeParse({
      id: VALID_UUID,
      maxActiveSessions: 5,
      maxOrgMemberships: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts without limit fields (backward compatible)", () => {
    const result = UpdatePermissionRoleSchema.safeParse({
      id: VALID_UUID,
      name: "Admin",
    });
    expect(result.success).toBe(true);
  });

  it("accepts maxWorkers field", () => {
    const result = UpdatePermissionRoleSchema.safeParse({
      id: VALID_UUID,
      maxWorkers: 4,
    });
    expect(result.success).toBe(true);
  });

  it("accepts maxWorkers as null", () => {
    const result = UpdatePermissionRoleSchema.safeParse({
      id: VALID_UUID,
      maxWorkers: null,
    });
    expect(result.success).toBe(true);
  });
});
