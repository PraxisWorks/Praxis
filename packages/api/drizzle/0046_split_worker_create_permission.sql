-- Split worker:create into worker:create:local and worker:create:apikey

-- 1. Insert new permission rows (skip if already exist)
INSERT INTO "permissions" (key, description, category)
VALUES ('worker:create:local', 'Register local workers', 'worker')
ON CONFLICT (key) DO NOTHING;

INSERT INTO "permissions" (key, description, category)
VALUES ('worker:create:apikey', 'Create API key workers', 'worker')
ON CONFLICT (key) DO NOTHING;

-- 2. Copy role_permissions from worker:create to both new keys
INSERT INTO "role_permissions" (role_id, permission_key)
SELECT rp.role_id, 'worker:create:local'
FROM "role_permissions" rp
WHERE rp.permission_key = 'worker:create'
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp2
    WHERE rp2.role_id = rp.role_id AND rp2.permission_key = 'worker:create:local'
  );

INSERT INTO "role_permissions" (role_id, permission_key)
SELECT rp.role_id, 'worker:create:apikey'
FROM "role_permissions" rp
WHERE rp.permission_key = 'worker:create'
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp2
    WHERE rp2.role_id = rp.role_id AND rp2.permission_key = 'worker:create:apikey'
  );

-- 3. Copy user_permission_overrides from worker:create to both new keys
INSERT INTO "user_permission_overrides" (user_id, permission_key, granted)
SELECT upo.user_id, 'worker:create:local', upo.granted
FROM "user_permission_overrides" upo
WHERE upo.permission_key = 'worker:create'
  AND NOT EXISTS (
    SELECT 1 FROM "user_permission_overrides" upo2
    WHERE upo2.user_id = upo.user_id AND upo2.permission_key = 'worker:create:local'
  );

INSERT INTO "user_permission_overrides" (user_id, permission_key, granted)
SELECT upo.user_id, 'worker:create:apikey', upo.granted
FROM "user_permission_overrides" upo
WHERE upo.permission_key = 'worker:create'
  AND NOT EXISTS (
    SELECT 1 FROM "user_permission_overrides" upo2
    WHERE upo2.user_id = upo.user_id AND upo2.permission_key = 'worker:create:apikey'
  );

-- 4. Delete old worker:create rows
DELETE FROM "role_permissions" WHERE permission_key = 'worker:create';
DELETE FROM "user_permission_overrides" WHERE permission_key = 'worker:create';
DELETE FROM "permissions" WHERE key = 'worker:create';
