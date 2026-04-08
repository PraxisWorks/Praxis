import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  CreatePermissionRoleSchema,
  UpdatePermissionRoleSchema,
  PermissionKeySchema,
  RolePermissionSchema,
  UserPermissionOverrideSchema,
  AssignRoleSchema,
  UpdateRoleLimitsSchema,
} from "@praxis2/shared";
import { router, protectedProcedure } from "../trpc.js";
import { adminProcedure } from "../middleware/requireRole.js";
import { resolveUserPermissions } from "../middleware/requirePermission.js";
import { roles, permissions, rolePermissions, userPermissionOverrides, users } from "../db/schema.js";
import { readSetting, writeSetting } from "../db/system-settings.js";

export const permissionRouter = router({
  listPermissions: adminProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(permissions)
      .orderBy(permissions.category, permissions.key);
  }),

  listRoles: adminProcedure.query(async ({ ctx }) => {
    const allRoles = await ctx.db
      .select()
      .from(roles)
      .orderBy(roles.name);

    const rolesWithPerms = await Promise.all(
      allRoles.map(async (role) => {
        const perms = await ctx.db
          .select({ permissionKey: rolePermissions.permissionKey })
          .from(rolePermissions)
          .where(eq(rolePermissions.roleId, role.id));
        return {
          ...role,
          permissions: perms.map((p) => p.permissionKey),
        };
      }),
    );

    return rolesWithPerms;
  }),

  getRole: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [role] = await ctx.db
        .select()
        .from(roles)
        .where(eq(roles.id, input.id))
        .limit(1);

      if (!role) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Role not found" });
      }

      const perms = await ctx.db
        .select({ permissionKey: rolePermissions.permissionKey })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, role.id));

      return {
        ...role,
        permissions: perms.map((p) => p.permissionKey),
      };
    }),

  createRole: adminProcedure
    .input(CreatePermissionRoleSchema)
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(roles)
        .where(eq(roles.name, input.name))
        .limit(1);

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Role "${input.name}" already exists`,
        });
      }

      const [created] = await ctx.db
        .insert(roles)
        .values({
          name: input.name,
          description: input.description ?? null,
          isSystem: false,
        })
        .returning();

      return created;
    }),

  updateRole: adminProcedure
    .input(UpdatePermissionRoleSchema)
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(roles)
        .where(eq(roles.id, input.id))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Role not found" });
      }

      if (existing.isSystem && input.name && input.name !== existing.name) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot rename system roles",
        });
      }

      const updates: Record<string, unknown> = {};
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined)
        updates.description = input.description;
      if (input.maxActiveSessions !== undefined)
        updates.maxActiveSessions = input.maxActiveSessions;
      if (input.maxOrgMemberships !== undefined)
        updates.maxOrgMemberships = input.maxOrgMemberships;
      if (input.maxReposPerOrg !== undefined)
        updates.maxReposPerOrg = input.maxReposPerOrg;
      if (input.maxIdeasPerRepo !== undefined)
        updates.maxIdeasPerRepo = input.maxIdeasPerRepo;
      if (input.maxWorkers !== undefined)
        updates.maxWorkers = input.maxWorkers;
      updates.updatedAt = new Date();

      const [updated] = await ctx.db
        .update(roles)
        .set(updates)
        .where(eq(roles.id, input.id))
        .returning();

      return updated;
    }),

  deleteRole: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(roles)
        .where(eq(roles.id, input.id))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Role not found" });
      }

      if (existing.isSystem) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot delete system roles",
        });
      }

      await ctx.db.delete(roles).where(eq(roles.id, input.id));
      return { success: true };
    }),

  myPermissions: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.dbUser) {
      return { permissions: [], role: null };
    }

    // Admin bypass — return all permission keys
    if (ctx.dbUser.role === "admin") {
      return {
        permissions: PermissionKeySchema.options as string[],
        role: {
          id: ctx.dbUser.roleId,
          name: "admin",
          isSystem: true,
        },
      };
    }

    const permSet = await resolveUserPermissions(
      ctx.db,
      ctx.dbUser.id,
      ctx.dbUser.roleId,
    );

    // Get role info if user has a roleId
    let role: { id: string; name: string; isSystem: boolean } | null = null;
    if (ctx.dbUser.roleId) {
      const [roleRow] = await ctx.db
        .select({ id: roles.id, name: roles.name, isSystem: roles.isSystem })
        .from(roles)
        .where(eq(roles.id, ctx.dbUser.roleId))
        .limit(1);
      role = roleRow ?? null;
    }

    return {
      permissions: Array.from(permSet),
      role,
    };
  }),

  // ── Role-Permission Management ──────────────────────────────────

  setRolePermissions: adminProcedure
    .input(
      z.object({
        roleId: z.string().uuid(),
        permissionKeys: z.array(PermissionKeySchema),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Delete all existing permissions for this role
      await ctx.db
        .delete(rolePermissions)
        .where(eq(rolePermissions.roleId, input.roleId));

      // Insert the new set
      if (input.permissionKeys.length > 0) {
        await ctx.db.insert(rolePermissions).values(
          input.permissionKeys.map((key) => ({
            roleId: input.roleId,
            permissionKey: key,
          })),
        );
      }

      return { success: true as const, count: input.permissionKeys.length };
    }),

  addRolePermission: adminProcedure
    .input(RolePermissionSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify role exists
      const [role] = await ctx.db
        .select()
        .from(roles)
        .where(eq(roles.id, input.roleId))
        .limit(1);

      if (!role) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Role not found" });
      }

      // Check if mapping already exists
      const [existing] = await ctx.db
        .select()
        .from(rolePermissions)
        .where(
          and(
            eq(rolePermissions.roleId, input.roleId),
            eq(rolePermissions.permissionKey, input.permissionKey),
          ),
        )
        .limit(1);

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Role already has this permission",
        });
      }

      await ctx.db.insert(rolePermissions).values({
        roleId: input.roleId,
        permissionKey: input.permissionKey,
      });

      return { success: true as const };
    }),

  removeRolePermission: adminProcedure
    .input(RolePermissionSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify role exists
      const [role] = await ctx.db
        .select()
        .from(roles)
        .where(eq(roles.id, input.roleId))
        .limit(1);

      if (!role) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Role not found" });
      }

      await ctx.db
        .delete(rolePermissions)
        .where(
          and(
            eq(rolePermissions.roleId, input.roleId),
            eq(rolePermissions.permissionKey, input.permissionKey),
          ),
        );

      return { success: true as const };
    }),

  // ── User Override Management ────────────────────────────────────

  listUserOverrides: adminProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(userPermissionOverrides)
        .where(eq(userPermissionOverrides.userId, input.userId));
    }),

  setUserOverride: adminProcedure
    .input(UserPermissionOverrideSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(userPermissionOverrides)
        .values({
          userId: input.userId,
          permissionKey: input.permissionKey,
          granted: input.granted,
        })
        .onConflictDoUpdate({
          target: [
            userPermissionOverrides.userId,
            userPermissionOverrides.permissionKey,
          ],
          set: { granted: input.granted },
        });

      return { success: true as const };
    }),

  removeUserOverride: adminProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        permissionKey: PermissionKeySchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(userPermissionOverrides)
        .where(
          and(
            eq(userPermissionOverrides.userId, input.userId),
            eq(userPermissionOverrides.permissionKey, input.permissionKey),
          ),
        );

      return { success: true as const };
    }),

  // ── Role Assignment ─────────────────────────────────────────────

  assignRole: adminProcedure
    .input(AssignRoleSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify role exists
      const [role] = await ctx.db
        .select()
        .from(roles)
        .where(eq(roles.id, input.roleId))
        .limit(1);

      if (!role) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Role not found" });
      }

      const [updated] = await ctx.db
        .update(users)
        .set({ roleId: input.roleId })
        .where(eq(users.id, input.userId))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      return updated;
    }),

  // ── Default Role Management ─────────────────────────────────────

  getDefaultRole: adminProcedure.query(async ({ ctx }) => {
    const defaultRoleId = await readSetting("default_role_id");
    if (!defaultRoleId) return null;

    const [role] = await ctx.db
      .select({ id: roles.id, name: roles.name })
      .from(roles)
      .where(eq(roles.id, defaultRoleId))
      .limit(1);

    return role ?? null;
  }),

  setDefaultRole: adminProcedure
    .input(z.object({ roleId: z.string().uuid().nullable() }))
    .mutation(async ({ ctx, input }) => {
      if (input.roleId === null) {
        await writeSetting("default_role_id", "");
        return { success: true as const };
      }

      const [role] = await ctx.db
        .select()
        .from(roles)
        .where(eq(roles.id, input.roleId))
        .limit(1);

      if (!role) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Role not found" });
      }

      await writeSetting("default_role_id", input.roleId);
      return { success: true as const };
    }),

  // ── User-Facing Limits ─────────────────────────────────────────

  myLimits: protectedProcedure.query(async ({ ctx }) => {
    const nullLimits = {
      maxActiveSessions: null,
      maxOrgMemberships: null,
      maxReposPerOrg: null,
      maxIdeasPerRepo: null,
      maxWorkers: null,
    };

    const userId = ctx.dbUser!.id;

    // Single query for all usage counts + role limits via subselects.
    // Replaces 3 sequential COUNT queries + 1 role lookup (4 round-trips → 1).
    const roleId = ctx.dbUser?.roleId;
    const rows = await ctx.db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM sessions
         WHERE user_id = ${userId}
           AND status IN ('active', 'scheduled')) AS session_count,
        (SELECT count(*)::int FROM org_members
         WHERE user_id = ${userId}) AS org_count,
        (SELECT count(*)::int FROM workers
         WHERE user_id = ${userId}) AS worker_count,
        r.max_active_sessions,
        r.max_org_memberships,
        r.max_repos_per_org,
        r.max_ideas_per_repo,
        r.max_workers
      FROM (SELECT 1) AS _dummy
      LEFT JOIN roles r ON r.id = ${roleId ?? null}
    `);
    const row = rows[0] as Record<string, unknown>;

    const usage = {
      activeSessions: row.session_count as number,
      orgMemberships: row.org_count as number,
      currentWorkers: row.worker_count as number,
    };

    // No dbUser, admin, or no role → everything unlimited
    if (!ctx.dbUser || ctx.dbUser.role === "admin" || !ctx.dbUser.roleId) {
      return { limits: nullLimits, usage };
    }

    return {
      limits: {
        maxActiveSessions: (row.max_active_sessions as number | null) ?? null,
        maxOrgMemberships: (row.max_org_memberships as number | null) ?? null,
        maxReposPerOrg: (row.max_repos_per_org as number | null) ?? null,
        maxIdeasPerRepo: (row.max_ideas_per_repo as number | null) ?? null,
        maxWorkers: (row.max_workers as number | null) ?? null,
      },
      usage,
    };
  }),

  // ── Role Limits Management ─────────────────────────────────────

  updateRoleLimits: adminProcedure
    .input(
      z.object({
        roleId: z.string().uuid(),
        limits: UpdateRoleLimitsSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(roles)
        .where(eq(roles.id, input.roleId))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Role not found" });
      }

      const updates: Record<string, unknown> = {};
      if (input.limits.maxActiveSessions !== undefined)
        updates.maxActiveSessions = input.limits.maxActiveSessions;
      if (input.limits.maxOrgMemberships !== undefined)
        updates.maxOrgMemberships = input.limits.maxOrgMemberships;
      if (input.limits.maxReposPerOrg !== undefined)
        updates.maxReposPerOrg = input.limits.maxReposPerOrg;
      if (input.limits.maxIdeasPerRepo !== undefined)
        updates.maxIdeasPerRepo = input.limits.maxIdeasPerRepo;
      if (input.limits.maxWorkers !== undefined)
        updates.maxWorkers = input.limits.maxWorkers;
      updates.updatedAt = new Date();

      const [updated] = await ctx.db
        .update(roles)
        .set(updates)
        .where(eq(roles.id, input.roleId))
        .returning();

      return updated;
    }),
});
