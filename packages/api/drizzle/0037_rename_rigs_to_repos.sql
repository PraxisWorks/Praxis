-- Rename rigs → repos. Skip entirely if rigs table doesn't exist
-- (e.g., fresh database where migration 0041 already created repos directly).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'rigs') THEN
    ALTER TABLE "rigs" RENAME TO "repos";
    ALTER TYPE "rig_status" RENAME TO "repo_status";
    ALTER TABLE "notifications" RENAME COLUMN "rig_id" TO "repo_id";
    ALTER TABLE "specs" RENAME COLUMN "rig_id" TO "repo_id";
    ALTER TABLE "ideas" RENAME COLUMN "rig_id" TO "repo_id";
    ALTER TABLE "sessions" RENAME COLUMN "rig_id" TO "repo_id";
    ALTER TABLE "plans" RENAME COLUMN "rig_id" TO "repo_id";
    ALTER TABLE "tasks" RENAME COLUMN "rig_id" TO "repo_id";
    ALTER TABLE "gh_webhook_configs" RENAME COLUMN "rig_id" TO "repo_id";
    ALTER TABLE "gh_deployments" RENAME COLUMN "rig_id" TO "repo_id";
    ALTER TYPE "session_type" RENAME VALUE 'rig' TO 'repo';
    ALTER TYPE "session_entity_type" RENAME VALUE 'rig' TO 'repo';
    ALTER INDEX "uq_rigs_org_bd_prefix" RENAME TO "uq_repos_org_bd_prefix";
    ALTER INDEX "uq_gh_deployments_rig_deployment" RENAME TO "uq_gh_deployments_repo_deployment";
    ALTER TABLE "organizations" RENAME COLUMN "ai_instructions_rig" TO "ai_instructions_repo";
    ALTER TABLE "organizations" RENAME COLUMN "system_instructions_rig" TO "system_instructions_repo";
    ALTER TABLE "workers" RENAME COLUMN "rig_init_settings" TO "repo_init_settings";
    UPDATE "permissions" SET key = 'repo:read', description = 'View repos' WHERE key = 'rig:read';
    UPDATE "permissions" SET key = 'repo:create', description = 'Create new repos' WHERE key = 'rig:create';
    UPDATE "permissions" SET key = 'session:create:repo', description = 'Create repo sessions' WHERE key = 'session:create:rig';
    UPDATE "role_permissions" SET permission_key = 'repo:read' WHERE permission_key = 'rig:read';
    UPDATE "role_permissions" SET permission_key = 'repo:create' WHERE permission_key = 'rig:create';
    UPDATE "role_permissions" SET permission_key = 'session:create:repo' WHERE permission_key = 'session:create:rig';
    RAISE NOTICE 'Renamed rigs → repos';
  ELSE
    RAISE NOTICE 'Table rigs does not exist — skipping rename (already repos)';
  END IF;
END $$;

-- pgboss schema is created at runtime, not during migrations.
-- On a fresh database this table won't exist yet — skip safely.
DO $$ BEGIN
  UPDATE "pgboss"."job" SET name = REPLACE(name, 'rig.', 'repo.') WHERE name LIKE 'rig.%' AND state IN ('created', 'retry', 'active');
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'pgboss.job does not exist yet — skipping rename';
END $$;
