-- Migration: Rename beads → tasks
-- Skip entirely if beads table doesn't exist (e.g., fresh database
-- where migration 0041 already created tasks directly).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'beads') THEN
    RAISE NOTICE 'Table beads does not exist — skipping rename (already tasks)';
    RETURN;
  END IF;

  -- 1. Rename enums
  ALTER TYPE bead_status   RENAME TO task_status;
  ALTER TYPE bead_priority RENAME TO task_priority;

  -- 2. Update session_entity_type enum value
  ALTER TYPE session_entity_type RENAME VALUE 'bead' TO 'task';

  -- 3. Drop RLS policies that reference old table names
  DROP POLICY IF EXISTS beads_worker_scope    ON beads;
  DROP POLICY IF EXISTS bead_deps_worker_scope ON bead_dependencies;
  DROP POLICY IF EXISTS beads_org_scope       ON beads;
  DROP POLICY IF EXISTS bead_deps_org_scope   ON bead_dependencies;

  -- 4. Drop foreign keys on bead_dependencies (old names)
  ALTER TABLE bead_dependencies DROP CONSTRAINT IF EXISTS bead_dependencies_bead_id_beads_id_fk;
  ALTER TABLE bead_dependencies DROP CONSTRAINT IF EXISTS bead_dependencies_depends_on_id_beads_id_fk;

  -- 5. Drop composite PK on bead_dependencies
  ALTER TABLE bead_dependencies DROP CONSTRAINT IF EXISTS bead_dependencies_bead_id_depends_on_id_pk;

  -- 6. Drop foreign keys on beads (old names)
  ALTER TABLE beads DROP CONSTRAINT IF EXISTS beads_rig_id_rigs_id_fk;
  ALTER TABLE beads DROP CONSTRAINT IF EXISTS beads_parent_id_beads_id_fk;
  ALTER TABLE beads DROP CONSTRAINT IF EXISTS beads_idea_id_ideas_id_fk;

  -- 7. Drop unique constraint on bead_id column
  ALTER TABLE beads DROP CONSTRAINT IF EXISTS beads_bead_id_unique;

  -- 8. Rename tables
  ALTER TABLE beads            RENAME TO tasks;
  ALTER TABLE bead_dependencies RENAME TO task_dependencies;

  -- 9. Rename columns
  ALTER TABLE tasks             RENAME COLUMN bead_id TO task_id;
  ALTER TABLE task_dependencies RENAME COLUMN bead_id TO task_id;

  -- 10. Recreate constraints with new names
  ALTER TABLE tasks ADD CONSTRAINT tasks_rig_id_rigs_id_fk
    FOREIGN KEY (rig_id) REFERENCES rigs(id) ON DELETE CASCADE;
  ALTER TABLE tasks ADD CONSTRAINT tasks_parent_id_tasks_id_fk
    FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE SET NULL;
  ALTER TABLE tasks ADD CONSTRAINT tasks_idea_id_ideas_id_fk
    FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE SET NULL;
  ALTER TABLE tasks ADD CONSTRAINT tasks_task_id_unique UNIQUE (task_id);

  ALTER TABLE task_dependencies ADD CONSTRAINT task_dependencies_task_id_tasks_id_fk
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
  ALTER TABLE task_dependencies ADD CONSTRAINT task_dependencies_depends_on_id_tasks_id_fk
    FOREIGN KEY (depends_on_id) REFERENCES tasks(id) ON DELETE CASCADE;
  ALTER TABLE task_dependencies ADD CONSTRAINT task_dependencies_task_id_depends_on_id_pk
    PRIMARY KEY (task_id, depends_on_id);

  -- 11. Recreate RLS policies with new names on new tables
  CREATE POLICY tasks_worker_scope ON tasks
    FOR ALL USING (
      rig_id IN (SELECT id FROM rigs WHERE user_id = current_app_user_id())
    );

  CREATE POLICY task_deps_worker_scope ON task_dependencies
    FOR ALL USING (
      task_id IN (
        SELECT t.id FROM tasks t
        JOIN rigs r ON t.rig_id = r.id
        WHERE r.user_id = current_app_user_id()
      )
    );

  CREATE POLICY tasks_org_scope ON tasks
    FOR ALL USING (
      rig_id IN (
        SELECT id FROM rigs WHERE org_id IN (
          SELECT org_id FROM org_members WHERE user_id = current_app_user_id()
        )
      )
    );

  CREATE POLICY task_deps_org_scope ON task_dependencies
    FOR ALL USING (
      task_id IN (
        SELECT t.id FROM tasks t
        JOIN rigs r ON t.rig_id = r.id
        WHERE r.org_id IN (
          SELECT org_id FROM org_members WHERE user_id = current_app_user_id()
        )
      )
    );

  -- 12. Update permission data
  UPDATE permissions
     SET key = 'task:read',
         description = 'View tasks and their dependencies'
   WHERE key = 'bead:read';

  UPDATE role_permissions
     SET permission_key = 'task:read'
   WHERE permission_key = 'bead:read';

  RAISE NOTICE 'Renamed beads → tasks';
END $$;
