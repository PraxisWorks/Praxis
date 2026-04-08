-- Make workers.user_id nullable so the central worker can register
-- without needing a corresponding user row.
ALTER TABLE "workers" ALTER COLUMN "user_id" DROP NOT NULL;
