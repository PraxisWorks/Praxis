CREATE TYPE "public"."idea_size" AS ENUM('xs', 's', 'm', 'l', 'xl');--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "size" "idea_size";