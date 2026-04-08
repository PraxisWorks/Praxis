CREATE TYPE "public"."worker_policy" AS ENUM('user_default', 'require_local', 'central_worker');--> statement-breakpoint
CREATE TABLE "org_member_workers" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"worker_id" uuid,
	CONSTRAINT "org_member_workers_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "worker_policy" "worker_policy" DEFAULT 'user_default' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "central_worker_id" uuid;--> statement-breakpoint
ALTER TABLE "org_member_workers" ADD CONSTRAINT "org_member_workers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_member_workers" ADD CONSTRAINT "org_member_workers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_member_workers" ADD CONSTRAINT "org_member_workers_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_central_worker_id_workers_id_fk" FOREIGN KEY ("central_worker_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;
