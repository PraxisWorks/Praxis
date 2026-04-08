/**
 * Migration script: splits worker:create permission into worker:create:local
 * and worker:create:apikey.
 *
 * Usage:
 *   tsx packages/api/src/db/split-worker-create-permission.ts
 *
 * Idempotent — safe to run multiple times.
 * Run BEFORE deploying the new code.
 */
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { permissions, rolePermissions, userPermissionOverrides } from "./schema.js";

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString, { max: 1 });
const db = drizzle(client);

const OLD_KEY = "worker:create";

const newPermissions = [
  { key: "worker:create:local", description: "Register local workers", category: "worker" },
  { key: "worker:create:apikey", description: "Create API key workers", category: "worker" },
];

async function main() {
  console.log("Splitting worker:create permission...");

  // 1. Insert new permission rows
  for (const perm of newPermissions) {
    const existing = await db
      .select()
      .from(permissions)
      .where(eq(permissions.key, perm.key))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(permissions).values(perm);
      console.log(`  Created permission: ${perm.key}`);
    } else {
      console.log(`  Skipped permission: ${perm.key} (already exists)`);
    }
  }

  // 2. Copy role_permissions from worker:create to both new keys
  console.log("\nCopying role_permissions...");
  const oldRolePerms = await db
    .select()
    .from(rolePermissions)
    .where(eq(rolePermissions.permissionKey, OLD_KEY));

  for (const rp of oldRolePerms) {
    for (const perm of newPermissions) {
      const existing = await db
        .select()
        .from(rolePermissions)
        .where(
          and(
            eq(rolePermissions.roleId, rp.roleId),
            eq(rolePermissions.permissionKey, perm.key),
          ),
        )
        .limit(1);

      if (existing.length === 0) {
        await db.insert(rolePermissions).values({
          roleId: rp.roleId,
          permissionKey: perm.key,
        });
        console.log(`  Copied role_permission: role ${rp.roleId} <- ${perm.key}`);
      } else {
        console.log(`  Skipped role_permission: role ${rp.roleId} <- ${perm.key} (already exists)`);
      }
    }
  }

  // 3. Copy user_permission_overrides from worker:create to both new keys
  console.log("\nCopying user_permission_overrides...");
  const oldOverrides = await db
    .select()
    .from(userPermissionOverrides)
    .where(eq(userPermissionOverrides.permissionKey, OLD_KEY));

  for (const ov of oldOverrides) {
    for (const perm of newPermissions) {
      const existing = await db
        .select()
        .from(userPermissionOverrides)
        .where(
          and(
            eq(userPermissionOverrides.userId, ov.userId),
            eq(userPermissionOverrides.permissionKey, perm.key),
          ),
        )
        .limit(1);

      if (existing.length === 0) {
        await db.insert(userPermissionOverrides).values({
          userId: ov.userId,
          permissionKey: perm.key,
          granted: ov.granted,
        });
        console.log(`  Copied override: user ${ov.userId} <- ${perm.key} (granted=${ov.granted})`);
      } else {
        console.log(`  Skipped override: user ${ov.userId} <- ${perm.key} (already exists)`);
      }
    }
  }

  // 4. Delete old worker:create rows
  console.log("\nDeleting old worker:create rows...");

  await db
    .delete(rolePermissions)
    .where(eq(rolePermissions.permissionKey, OLD_KEY));
  console.log(`  Deleted role_permissions for ${OLD_KEY}`);

  await db
    .delete(userPermissionOverrides)
    .where(eq(userPermissionOverrides.permissionKey, OLD_KEY));
  console.log(`  Deleted user_permission_overrides for ${OLD_KEY}`);

  await db
    .delete(permissions)
    .where(eq(permissions.key, OLD_KEY));
  console.log(`  Deleted permission ${OLD_KEY}`);

  console.log("\nDone.");
  await client.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
