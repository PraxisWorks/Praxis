-- Clean up stale rig:create permission (may exist if seed ran after 0037 migration)
DELETE FROM "role_permissions" WHERE permission_key = 'rig:create';
DELETE FROM "permissions" WHERE key = 'rig:create';

-- Add repo:add permission for importing existing repos (separate from repo:create which is for new-from-template)
INSERT INTO "permissions" (key, description, category)
VALUES ('repo:add', 'Add existing repos', 'repo')
ON CONFLICT (key) DO NOTHING;

-- Assign repo:add to admin and member roles (same roles that have repo:create)
INSERT INTO "role_permissions" (role_id, permission_key)
SELECT r.id, 'repo:add'
FROM "roles" r
WHERE r.name IN ('admin', 'member')
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    WHERE rp.role_id = r.id AND rp.permission_key = 'repo:add'
  );
