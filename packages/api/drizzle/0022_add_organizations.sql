-- Create org_role enum
DO $$ BEGIN
  CREATE TYPE "org_role" AS ENUM('owner', 'admin', 'member');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create organizations table
CREATE TABLE IF NOT EXISTS "organizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(100) NOT NULL,
  "slug" varchar(50) NOT NULL UNIQUE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Create org_members join table
CREATE TABLE IF NOT EXISTS "org_members" (
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" "org_role" NOT NULL DEFAULT 'member',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("org_id", "user_id")
);

-- Add org_id to rigs table (nullable initially for migration)
ALTER TABLE "rigs" ADD COLUMN IF NOT EXISTS "org_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;

-- Migrate existing rigs: create a personal org for each user who has rigs,
-- then assign their rigs to that org.
DO $$
DECLARE
  r RECORD;
  new_org_id uuid;
BEGIN
  FOR r IN
    SELECT DISTINCT u.id AS user_id, u.name AS user_name, u.email
    FROM rigs
    JOIN users u ON u.id = rigs.user_id
    WHERE rigs.org_id IS NULL
  LOOP
    -- Create a personal org for this user
    INSERT INTO organizations (name, slug)
    VALUES (
      r.user_name || '''s Org',
      'personal-' || replace(r.user_id::text, '-', '')
    )
    ON CONFLICT (slug) DO NOTHING
    RETURNING id INTO new_org_id;

    -- If org already existed, fetch it
    IF new_org_id IS NULL THEN
      SELECT id INTO new_org_id
      FROM organizations
      WHERE slug = 'personal-' || replace(r.user_id::text, '-', '');
    END IF;

    -- Add user as owner
    INSERT INTO org_members (org_id, user_id, role)
    VALUES (new_org_id, r.user_id, 'owner')
    ON CONFLICT DO NOTHING;

    -- Assign all user's rigs to their personal org
    UPDATE rigs SET org_id = new_org_id WHERE user_id = r.user_id AND org_id IS NULL;
  END LOOP;
END $$;

-- Now make org_id NOT NULL
ALTER TABLE "rigs" ALTER COLUMN "org_id" SET NOT NULL;

-- Replace user-scoped unique index with org-scoped
DROP INDEX IF EXISTS "uq_rigs_user_bd_prefix";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_rigs_org_bd_prefix" ON "rigs" ("org_id", "bd_prefix");
