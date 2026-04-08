ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "template_repo" varchar(500);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "init_scripts" jsonb;
