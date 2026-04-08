import { z } from "zod";

// All predefined permission keys in the system
export const PermissionKeySchema = z.enum([
  // Organization
  "org:create",
  "org:delete",
  "org:update",

  // Organization membership
  "org:member:invite",
  "org:member:remove",

  // Sessions
  "session:create:spec",
  "session:create:architecture",
  "session:create:working",
  "session:create:debug",
  "session:create:repo",

  // Instructions
  "session:instructions:edit",
  "session:instructions:append",

  // Repo
  "repo:create",
  "repo:add",

  // Read
  "idea:read",
  "task:read",
  "plan:read",
  "repo:read",
  "session:read",
  "stats:read",
  "spec:read",

  // Workers
  "worker:create:local",
  "worker:create:apikey",
  "worker:delete",

  // Files
  "file:upload",

  // Admin
  "admin:users:manage",
  "admin:roles:manage",
  "admin:permissions:manage",
]);
export type PermissionKey = z.infer<typeof PermissionKeySchema>;

// Input schema for creating a new role
export const CreatePermissionRoleSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional(),
});
export type CreatePermissionRole = z.infer<typeof CreatePermissionRoleSchema>;

// Input schema for updating an existing role
export const UpdatePermissionRoleSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, "Name is required").max(100).optional(),
  description: z.string().max(500).optional(),
  maxActiveSessions: z.number().int().nullable().optional(),
  maxOrgMemberships: z.number().int().nullable().optional(),
  maxReposPerOrg: z.number().int().nullable().optional(),
  maxIdeasPerRepo: z.number().int().nullable().optional(),
  maxWorkers: z.number().int().nullable().optional(),
});
export type UpdatePermissionRole = z.infer<typeof UpdatePermissionRoleSchema>;

// Full role shape as returned from the API
export const PermissionRoleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type PermissionRole = z.infer<typeof PermissionRoleSchema>;

// Mapping a permission to a role
export const RolePermissionSchema = z.object({
  roleId: z.string().uuid(),
  permissionKey: PermissionKeySchema,
});
export type RolePermission = z.infer<typeof RolePermissionSchema>;

// Per-user permission override (grant or deny)
export const UserPermissionOverrideSchema = z.object({
  userId: z.string().uuid(),
  permissionKey: PermissionKeySchema,
  granted: z.boolean(),
});
export type UserPermissionOverride = z.infer<typeof UserPermissionOverrideSchema>;

// Input for assigning a role to a user
export const AssignRoleSchema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
});
export type AssignRole = z.infer<typeof AssignRoleSchema>;

// ── Limits ──────────────────────────────────────────────────────

// All limit keys in the system (-1 = unlimited)
export const LimitKeySchema = z.enum([
  "max_active_sessions",
  "max_org_memberships",
  "max_rigs_per_org",
  "max_ideas_per_rig",
]);
export type LimitKey = z.infer<typeof LimitKeySchema>;

// Single limit entry
export const RoleLimitEntrySchema = z.object({
  key: LimitKeySchema,
  maxValue: z.number().int().min(-1, "maxValue must be >= -1"),
});
export type RoleLimitEntry = z.infer<typeof RoleLimitEntrySchema>;

// Admin input: set limits for a role
export const SetRoleLimitsSchema = z.object({
  roleId: z.string().uuid(),
  limits: z.array(RoleLimitEntrySchema).min(1),
});
export type SetRoleLimits = z.infer<typeof SetRoleLimitsSchema>;

// Admin input: get limits for a role
export const GetRoleLimitsSchema = z.object({
  roleId: z.string().uuid(),
});
export type GetRoleLimits = z.infer<typeof GetRoleLimitsSchema>;

// ── Column-based limit schemas ─────────────────────────────────

// Role limits matching DB columns (null = unlimited)
export const RoleLimitsSchema = z.object({
  maxActiveSessions: z.number().int().nullable(),
  maxOrgMemberships: z.number().int().nullable(),
  maxReposPerOrg: z.number().int().nullable(),
  maxIdeasPerRepo: z.number().int().nullable(),
  maxWorkers: z.number().int().nullable(),
});
export type RoleLimits = z.infer<typeof RoleLimitsSchema>;

// Partial update for role limits
export const UpdateRoleLimitsSchema = z.object({
  maxActiveSessions: z.number().int().nullable().optional(),
  maxOrgMemberships: z.number().int().nullable().optional(),
  maxReposPerOrg: z.number().int().nullable().optional(),
  maxIdeasPerRepo: z.number().int().nullable().optional(),
  maxWorkers: z.number().int().nullable().optional(),
});
export type UpdateRoleLimits = z.infer<typeof UpdateRoleLimitsSchema>;

// Response for the user-facing /my/limits endpoint
export const MyLimitsResponseSchema = z.object({
  limits: RoleLimitsSchema,
  usage: z.object({
    activeSessions: z.number().int(),
    orgMemberships: z.number().int(),
    currentWorkers: z.number().int().min(0),
  }),
});
export type MyLimitsResponse = z.infer<typeof MyLimitsResponseSchema>;
