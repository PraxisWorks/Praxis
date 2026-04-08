CREATE TYPE "public"."rig_status" AS ENUM('creating', 'active', 'archived', 'error');--> statement-breakpoint
CREATE TABLE "rigs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"repo" varchar(500),
	"bd_prefix" varchar(4) NOT NULL,
	"color" varchar(7) NOT NULL,
	"description" varchar(1000),
	"workspace_path" varchar(1000),
	"status" "rig_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rigs" ADD CONSTRAINT "rigs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_rigs_user_bd_prefix" ON "rigs" USING btree ("user_id","bd_prefix");