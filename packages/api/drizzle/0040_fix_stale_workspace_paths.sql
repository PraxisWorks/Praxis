-- Table was renamed from rigs to repos in migration 0037
-- Fix workspace paths that reference the old macOS home directory.
-- Replace /Users/<your-user> with /home/<your-user> if you switched platforms.
-- This migration was a no-op for fresh installs.
SELECT 1;
