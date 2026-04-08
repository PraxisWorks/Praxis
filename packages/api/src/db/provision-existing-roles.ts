/**
 * Migration script that provisions a Postgres DB role for every existing user.
 *
 * Usage:
 *   tsx packages/api/src/db/provision-existing-roles.ts
 *
 * Idempotent -- safe to run multiple times.
 */
import "dotenv/config";
import postgres from "postgres";
import { provisionDbRole } from "../lib/provisionDbRole.js";

const connectionString = process.env.DATABASE_URL!;
const sql = postgres(connectionString, { max: 1 });

async function main() {
  console.log("Provisioning DB roles for existing users...");

  const rows = await sql`SELECT id FROM users`;
  console.log(`  Found ${rows.length} user(s).`);

  let provisioned = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      await provisionDbRole(sql, row.id as string);
      provisioned++;
      console.log(`  Provisioned role for user ${row.id}`);
    } catch (err) {
      failed++;
      console.error(`  Failed to provision role for user ${row.id}:`, err);
    }
  }

  console.log(`Done. Provisioned: ${provisioned}, Failed: ${failed}`);
  await sql.end();
}

main().catch((err) => {
  console.error("Provisioning script failed:", err);
  process.exit(1);
});
