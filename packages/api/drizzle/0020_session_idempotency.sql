-- Add claimedBy column to sessions for idempotent job processing.
-- When a worker picks up a session.start job, it atomically claims the session
-- by setting claimedBy to its worker ID. If already claimed, it skips processing.
ALTER TABLE "sessions" ADD COLUMN "claimed_by" uuid;
