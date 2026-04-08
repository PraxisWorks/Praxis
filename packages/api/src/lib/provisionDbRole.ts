import type { Sql } from "postgres";

/**
 * List of application tables that provisioned user roles receive
 * SELECT, INSERT, UPDATE, DELETE privileges on.
 */
const APPLICATION_TABLES = [
  "users",
  "notifications",
  "push_tokens",
  "repos",
  "specs",
  "ideas",
  "sessions",
  "session_messages",
  "session_attachments",
  "idea_attachments",
  "idea_phases",
  "plans",
  "tasks",
  "task_dependencies",
  "deployments",
  "workers",
  "worker_tokens",
] as const;

/**
 * Derives a Postgres role name from a user ID.
 *
 * The role name is `praxis_user_<userId-without-dashes>` which ensures it is a
 * valid Postgres identifier (no hyphens).
 */
export function deriveRoleName(userId: string): string {
  return `praxis_user_${userId.replace(/-/g, "")}`;
}

/**
 * Provisions a Postgres database role for a given user.
 *
 * This function is idempotent -- it is safe to call multiple times for the
 * same user. If the role already exists it will not be recreated, and GRANT
 * statements are inherently idempotent in Postgres.
 *
 * @param sql - A raw postgres.js `Sql` connection instance.
 * @param userId - The UUID of the user to provision a role for.
 */
export async function provisionDbRole(sql: Sql, userId: string): Promise<void> {
  const roleName = deriveRoleName(userId);

  // Create the role if it does not already exist.
  // We use a DO block because CREATE ROLE has no IF NOT EXISTS syntax.
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${roleName}') THEN
        CREATE ROLE "${roleName}" WITH LOGIN PASSWORD '${roleName}';
      END IF;
    END
    $$;
  `);

  // Grant DML privileges on all application tables.
  // GRANT is idempotent -- re-granting existing privileges is a no-op.
  const tableList = APPLICATION_TABLES.join(", ");
  await sql.unsafe(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON ${tableList} TO "${roleName}";
  `);
}
