ALTER TABLE "roles" ADD COLUMN "max_active_sessions" integer;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "max_org_memberships" integer;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "max_repos_per_org" integer;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "max_ideas_per_repo" integer;