CREATE TABLE "gh_deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rig_id" uuid NOT NULL,
	"github_deployment_id" varchar(50) NOT NULL,
	"environment" varchar(100) NOT NULL,
	"status" varchar(50) NOT NULL,
	"ref" varchar(255) NOT NULL,
	"description" varchar(1000),
	"url" varchar(2000),
	"creator_login" varchar(255),
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gh_webhook_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rig_id" uuid NOT NULL,
	"github_webhook_id" integer NOT NULL,
	"webhook_secret" varchar(255) NOT NULL,
	"repo_owner" varchar(255) NOT NULL,
	"repo_name" varchar(255) NOT NULL,
	"last_etag" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gh_webhook_configs_rig_id_unique" UNIQUE("rig_id")
);
--> statement-breakpoint
ALTER TABLE "gh_deployments" ADD CONSTRAINT "gh_deployments_rig_id_rigs_id_fk" FOREIGN KEY ("rig_id") REFERENCES "public"."rigs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gh_webhook_configs" ADD CONSTRAINT "gh_webhook_configs_rig_id_rigs_id_fk" FOREIGN KEY ("rig_id") REFERENCES "public"."rigs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_gh_deployments_rig_deployment" ON "gh_deployments" USING btree ("rig_id","github_deployment_id");