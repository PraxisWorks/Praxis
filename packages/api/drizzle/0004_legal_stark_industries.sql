CREATE TYPE "public"."bead_priority" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."bead_status" AS ENUM('draft', 'approved', 'in_progress', 'blocked', 'complete', 'archived');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('draft', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "bead_dependencies" (
	"bead_id" uuid NOT NULL,
	"depends_on_id" uuid NOT NULL,
	CONSTRAINT "bead_dependencies_bead_id_depends_on_id_pk" PRIMARY KEY("bead_id","depends_on_id")
);
--> statement-breakpoint
CREATE TABLE "beads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rig_id" uuid NOT NULL,
	"parent_id" uuid,
	"idea_id" uuid,
	"title" varchar(500) NOT NULL,
	"description" text NOT NULL,
	"notes" text,
	"status" "bead_status" DEFAULT 'draft' NOT NULL,
	"priority" "bead_priority" DEFAULT 'medium' NOT NULL,
	"is_epic" boolean DEFAULT false NOT NULL,
	"bead_id" varchar(50),
	"status_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "beads_bead_id_unique" UNIQUE("bead_id")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_id" uuid NOT NULL,
	"rig_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"proposal" jsonb NOT NULL,
	"status" "plan_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bead_dependencies" ADD CONSTRAINT "bead_dependencies_bead_id_beads_id_fk" FOREIGN KEY ("bead_id") REFERENCES "public"."beads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bead_dependencies" ADD CONSTRAINT "bead_dependencies_depends_on_id_beads_id_fk" FOREIGN KEY ("depends_on_id") REFERENCES "public"."beads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beads" ADD CONSTRAINT "beads_rig_id_rigs_id_fk" FOREIGN KEY ("rig_id") REFERENCES "public"."rigs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beads" ADD CONSTRAINT "beads_parent_id_beads_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."beads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beads" ADD CONSTRAINT "beads_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_rig_id_rigs_id_fk" FOREIGN KEY ("rig_id") REFERENCES "public"."rigs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plans_idea_id_non_rejected" ON "plans" ("idea_id") WHERE status != 'rejected';