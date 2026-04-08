CREATE TYPE "public"."idea_source" AS ENUM('human', 'ai');--> statement-breakpoint
CREATE TYPE "public"."idea_status" AS ENUM('new', 'planning', 'planned', 'in_progress', 'complete', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TYPE "public"."session_entity_type" AS ENUM('rig', 'idea', 'epic', 'bead');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('active', 'paused', 'completed', 'error');--> statement-breakpoint
CREATE TYPE "public"."session_type" AS ENUM('spec', 'architecture', 'working', 'debug');--> statement-breakpoint
CREATE TABLE "ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rig_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"status" "idea_status" DEFAULT 'new' NOT NULL,
	"source" "idea_source" DEFAULT 'human' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rig_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "session_type" NOT NULL,
	"entity_type" "session_entity_type",
	"entity_id" uuid,
	"title" varchar(255) NOT NULL,
	"prompt" text,
	"status" "session_status" DEFAULT 'active' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "specs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rig_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "specs_rig_id_unique" UNIQUE("rig_id")
);
--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_rig_id_rigs_id_fk" FOREIGN KEY ("rig_id") REFERENCES "public"."rigs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_messages" ADD CONSTRAINT "session_messages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_rig_id_rigs_id_fk" FOREIGN KEY ("rig_id") REFERENCES "public"."rigs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specs" ADD CONSTRAINT "specs_rig_id_rigs_id_fk" FOREIGN KEY ("rig_id") REFERENCES "public"."rigs"("id") ON DELETE cascade ON UPDATE no action;