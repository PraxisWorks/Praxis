import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import type { PermissionKey } from "@praxis2/shared";
import { protectedProcedure } from "../trpc.js";
import { rolePermissions, userPermissionOverrides } from "../db/schema.js";

/**
 * Resolves the effective permissions for a user.
 * Returns a Set of permission keys the user has.
 *
 * Resolution logic:
 * 1. Get all permissions from the user's role (via role_permissions)
 * 2. Apply user-specific overrides (granted=true adds, granted=false removes)
 */
export async function resolveUserPermissions(
  db: any,
  userId: string,
  roleId: string | null,
): Promise<Set<string>> {
  const granted = new Set<string>();

  // 1. Get role permissions (if user has a role)
  if (roleId) {
    const rolePerms = await db
      .select({ permissionKey: rolePermissions.permissionKey })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, roleId));

    for (const rp of rolePerms) {
      granted.add(rp.permissionKey);
    }
  }

  // 2. Apply user-specific overrides
  const overrides = await db
    .select({
      permissionKey: userPermissionOverrides.permissionKey,
      granted: userPermissionOverrides.granted,
    })
    .from(userPermissionOverrides)
    .where(eq(userPermissionOverrides.userId, userId));

  for (const override of overrides) {
    if (override.granted) {
      granted.add(override.permissionKey);
    } else {
      granted.delete(override.permissionKey);
    }
  }

  return granted;
}

/**
 * Creates a tRPC procedure that requires the caller to have a specific permission.
 * Builds on protectedProcedure (JWT required + dbUser resolved).
 *
 * Usage:
 *   requirePermission("org:create").mutation(async ({ ctx }) => { ... })
 */
export function requirePermission(...requiredKeys: PermissionKey[]) {
  return protectedProcedure.use(async ({ ctx, next }) => {
    if (!ctx.dbUser) {
      throw new TRPCError({ code: "FORBIDDEN", message: "User account required" });
    }

    // Admin role bypass — users with the legacy role "admin" get all permissions.
    // This ensures backward compatibility during the migration period
    // before all admins have roleId set via the backfill.
    if (ctx.dbUser.role === "admin") {
      return next({ ctx: { ...ctx, permissions: new Set(requiredKeys) } });
    }

    const permissions = await resolveUserPermissions(
      ctx.db,
      ctx.dbUser.id,
      ctx.dbUser.roleId,
    );

    // Check all required permissions
    const missing = requiredKeys.filter((key) => !permissions.has(key));
    if (missing.length > 0) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Missing permissions: ${missing.join(", ")}`,
      });
    }

    return next({ ctx: { ...ctx, permissions } });
  });
}

/**
 * Checks a permission inside a mutation handler (not as middleware).
 * Use when the required permission depends on the input.
 *
 * Throws FORBIDDEN if the user lacks the permission.
 */
export async function checkPermission(
  ctx: { db: any; dbUser: { id: string; role: string; roleId: string | null } | null },
  ...requiredKeys: PermissionKey[]
): Promise<void> {
  if (!ctx.dbUser) {
    throw new TRPCError({ code: "FORBIDDEN", message: "User account required" });
  }

  // Admin bypass
  if (ctx.dbUser.role === "admin") return;

  const permissions = await resolveUserPermissions(
    ctx.db,
    ctx.dbUser.id,
    ctx.dbUser.roleId,
  );

  const missing = requiredKeys.filter((key) => !permissions.has(key));
  if (missing.length > 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Missing permissions: ${missing.join(", ")}`,
    });
  }
}
