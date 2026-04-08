/**
 * Migration script: inserts read-permission rows and assigns them to roles.
 *
 * Usage:
 *   tsx packages/api/src/db/insert-read-permissions.ts
 *
 * Idempotent — safe to run multiple times.
 */
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { permissions, roles, rolePermissions } from "./schema.js";

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString, { max: 1 });
const db = drizzle(client);

const readPermissions = [
  { key: "idea:read", description: "View ideas and their details", category: "read" },
  { key: "task:read", description: "View tasks and their dependencies", category: "read" },
  { key: "plan:read", description: "View plans and proposals", category: "read" },
  { key: "repo:read", description: "View repos", category: "read" },
  { key: "session:read", description: "View sessions", category: "read" },
  { key: "stats:read", description: "View dashboard statistics", category: "read" },
  { key: "spec:read", description: "View specifications", category: "read" },
];

// All three roles that should have read permissions
const rolesToAssign = ["member", "viewer", "restricted"];

async function main() {
  console.log("Inserting read permissions...");

  // 1. Insert permission rows
  for (const perm of readPermissions) {
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

  // 2. Assign read permissions to roles
  console.log("\nAssigning read permissions to roles...");
  for (const roleName of rolesToAssign) {
    const [role] = await db
      .select()
      .from(roles)
      .where(eq(roles.name, roleName))
      .limit(1);

    if (!role) {
      console.log(`  Warning: role "${roleName}" not found, skipping`);
      continue;
    }

    for (const perm of readPermissions) {
      const existing = await db
        .select()
        .from(rolePermissions)
        .where(
          and(
            eq(rolePermissions.roleId, role.id),
            eq(rolePermissions.permissionKey, perm.key),
          ),
        )
        .limit(1);

      if (existing.length === 0) {
        await db.insert(rolePermissions).values({
          roleId: role.id,
          permissionKey: perm.key,
        });
        console.log(`  Assigned: ${roleName} <- ${perm.key}`);
      } else {
        console.log(`  Skipped: ${roleName} <- ${perm.key} (already exists)`);
      }
    }
  }

  console.log("\nDone.");
  await client.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
