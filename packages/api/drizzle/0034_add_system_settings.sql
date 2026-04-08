CREATE TABLE IF NOT EXISTS "system_settings" (
  "key" varchar(100) PRIMARY KEY NOT NULL,
  "value" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Seed default: allow DB mode for workers
INSERT INTO "system_settings" ("key", "value")
VALUES ('allow_worker_db_mode', 'true')
ON CONFLICT ("key") DO NOTHING;
