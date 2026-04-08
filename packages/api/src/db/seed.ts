import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { users, permissions, roles, rolePermissions } from "./schema.js";

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString, { max: 1 });
const db = drizzle(client);

const seedUsers = [
  { name: "Admin User", email: "admin@example.com", role: "admin" as const },
  { name: "Alice", email: "alice@example.com", role: "user" as const },
  { name: "Bob", email: "bob@example.com", role: "user" as const },
];

const seedPermissions = [
  { key: "org:create", description: "Create new organizations", category: "organization" },
  { key: "org:delete", description: "Delete organizations", category: "organization" },
  { key: "org:update", description: "Update organization settings", category: "organization" },
  { key: "org:member:invite", description: "Invite members to organizations", category: "organization" },
  { key: "org:member:remove", description: "Remove members from organizations", category: "organization" },
  { key: "session:create:spec", description: "Create specification sessions", category: "session" },
  { key: "session:create:architecture", description: "Create architecture sessions", category: "session" },
  { key: "session:create:working", description: "Create working sessions", category: "session" },
  { key: "session:create:debug", description: "Create debug sessions", category: "session" },
  { key: "session:create:repo", description: "Create repo sessions", category: "session" },
  { key: "repo:create", description: "Create new repos", category: "repo" },
  { key: "repo:add", description: "Add existing repos", category: "repo" },
  { key: "worker:create:local", description: "Register local workers", category: "worker" },
  { key: "worker:create:apikey", description: "Create API key workers", category: "worker" },
  { key: "worker:delete", description: "Delete workers", category: "worker" },
  { key: "admin:users:manage", description: "Manage user accounts and roles", category: "admin" },
  { key: "admin:roles:manage", description: "Create and modify roles", category: "admin" },
  { key: "admin:permissions:manage", description: "Manage permission assignments", category: "admin" },
  // Instructions
  { key: "session:instructions:edit", description: "Replace default AI system instructions for session types", category: "instructions" },
  { key: "session:instructions:append", description: "Append additional instructions to AI sessions", category: "instructions" },
  { key: "file:upload", description: "Upload files to ideas and sessions", category: "file" },
  // Read
  { key: "idea:read", description: "View ideas and their details", category: "read" },
  { key: "task:read", description: "View tasks and their dependencies", category: "read" },
  { key: "plan:read", description: "View plans and proposals", category: "read" },
  { key: "repo:read", description: "View repos", category: "read" },
  { key: "session:read", description: "View sessions", category: "read" },
  { key: "stats:read", description: "View dashboard statistics", category: "read" },
  { key: "spec:read", description: "View specifications", category: "read" },
];

const seedRoles = [
  { name: "admin", description: "Full system access. Can manage users, roles, permissions, and all resources.", isSystem: true },
  { name: "member", description: "Standard organization member. Can create orgs, start most session types, and manage workers.", isSystem: true },
  { name: "viewer", description: "Read-only access. Can join orgs when invited but cannot create resources.", isSystem: true },
  { name: "restricted", description: "Limited access. Can join orgs when invited, limited session types.", isSystem: true },
];

const allPermissionKeys = seedPermissions.map((p) => p.key);

const rolePermissionMap: Record<string, string[]> = {
  admin: allPermissionKeys,
  member: [
    "org:create",
    "org:update",
    "org:member:invite",
    "repo:create",
    "repo:add",
    "session:create:spec",
    "session:create:architecture",
    "session:create:working",
    "session:create:debug",
    "session:create:repo",
    "worker:create:local",
    "worker:create:apikey",
    "worker:delete",
    "file:upload",
    "idea:read",
    "task:read",
    "plan:read",
    "repo:read",
    "session:read",
    "stats:read",
    "spec:read",
  ],
  viewer: [
    "idea:read",
    "task:read",
    "plan:read",
    "repo:read",
    "session:read",
    "stats:read",
    "spec:read",
  ],
  restricted: [
    "session:create:working",
    "session:create:debug",
    "idea:read",
    "task:read",
    "plan:read",
    "repo:read",
    "session:read",
    "stats:read",
    "spec:read",
  ],
};

async function main() {
  console.log("Seeding database...");

  for (const user of seedUsers) {
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, user.email))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(users).values(user);
      console.log(`  Created: ${user.email} (${user.role})`);
    } else {
      console.log(`  Skipped: ${user.email} (already exists)`);
    }
  }

  // ── Seed permissions ──────────────────────────────────────────────
  console.log("\nSeeding permissions...");
  for (const perm of seedPermissions) {
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

  // ── Seed roles ─────────────────────────────────────────────────────
  console.log("\nSeeding roles...");
  for (const role of seedRoles) {
    const existing = await db
      .select()
      .from(roles)
      .where(eq(roles.name, role.name))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(roles).values(role);
      console.log(`  Created role: ${role.name}`);
    } else {
      console.log(`  Skipped role: ${role.name} (already exists)`);
    }
  }

  // ── Seed role-permission mappings ──────────────────────────────────
  console.log("\nSeeding role-permission mappings...");
  for (const [roleName, permKeys] of Object.entries(rolePermissionMap)) {
    if (permKeys.length === 0) {
      console.log(`  Skipped role: ${roleName} (no permissions to assign)`);
      continue;
    }

    const [role] = await db
      .select()
      .from(roles)
      .where(eq(roles.name, roleName))
      .limit(1);

    if (!role) {
      console.log(`  Warning: role "${roleName}" not found, skipping mappings`);
      continue;
    }

    for (const permKey of permKeys) {
      const existing = await db
        .select()
        .from(rolePermissions)
        .where(
          and(
            eq(rolePermissions.roleId, role.id),
            eq(rolePermissions.permissionKey, permKey),
          ),
        )
        .limit(1);

      if (existing.length === 0) {
        await db.insert(rolePermissions).values({
          roleId: role.id,
          permissionKey: permKey,
        });
        console.log(`  Assigned: ${roleName} <- ${permKey}`);
      } else {
        console.log(`  Skipped: ${roleName} <- ${permKey} (already exists)`);
      }
    }
  }

  console.log("\nSeeding complete.");
  await client.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
