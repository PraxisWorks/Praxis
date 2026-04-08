-- Add "scheduled" to session_status enum
ALTER TYPE "session_status" ADD VALUE IF NOT EXISTS 'scheduled';

-- Add scheduled_for and job_id columns to sessions
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "scheduled_for" timestamp with time zone;
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "job_id" text;
