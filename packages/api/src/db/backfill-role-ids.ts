/**
 * Backfill script that sets users.roleId based on their existing role varchar column.
 *
 * Mapping:
 *   role = "admin" → roleId = roles.id WHERE name = "admin"
 *   role = "user"  → roleId = roles.id WHERE name = "member"
 *
 * Usage:
 *   tsx packages/api/src/db/backfill-role-ids.ts
 *
 * Idempotent — safe to run multiple times.
 */
import "dotenv/config";
import { eq, isNull, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { users, roles } from "./schema.js";

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString, { max: 1 });
const db = drizzle(client);

async function main() {
  console.log("Backfilling users.roleId from role column...");

  // Look up role UUIDs
  const [adminRole] = await db.select().from(roles).where(eq(roles.name, "admin")).limit(1);
  const [memberRole] = await db.select().from(roles).where(eq(roles.name, "member")).limit(1);

  if (!adminRole || !memberRole) {
    console.error("Error: Default roles not found. Run db:seed first.");
    process.exit(1);
  }

  // Backfill admin users
  const adminResult = await db
    .update(users)
    .set({ roleId: adminRole.id })
    .where(and(eq(users.role, "admin"), isNull(users.roleId)))
    .returning({ id: users.id });
  console.log(`  Updated ${adminResult.length} admin user(s) → role "${adminRole.name}" (${adminRole.id})`);

  // Backfill regular users
  const memberResult = await db
    .update(users)
    .set({ roleId: memberRole.id })
    .where(and(eq(users.role, "user"), isNull(users.roleId)))
    .returning({ id: users.id });
  console.log(`  Updated ${memberResult.length} regular user(s) → role "${memberRole.name}" (${memberRole.id})`);

  // Report any users still without roleId
  const remaining = await db.select({ id: users.id, role: users.role })
    .from(users)
    .where(isNull(users.roleId));
  if (remaining.length > 0) {
    console.warn(`  Warning: ${remaining.length} user(s) still have no roleId:`, remaining);
  }

  console.log("Backfill complete.");
  await client.end();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
