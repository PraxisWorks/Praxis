-- Row-Level Security for per-user worker scoping.
-- Local workers connect with a per-user Postgres role and set
-- app.user_id on each connection. These policies ensure they
-- can only see/modify rows belonging to their user.
-- The central worker's admin role has BYPASSRLS and is unaffected.

-- Helper: safely read app.user_id, returning NULL if unset
CREATE OR REPLACE FUNCTION current_app_user_id() RETURNS uuid AS $$
BEGIN
  RETURN current_setting('app.user_id', true)::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- ── Rigs ──────────────────────────────────────────────────────
ALTER TABLE rigs ENABLE ROW LEVEL SECURITY;
CREATE POLICY rigs_worker_scope ON rigs
  FOR ALL USING (user_id = current_app_user_id());

-- ── Sessions ──────────────────────────────────────────────────
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY sessions_worker_scope ON sessions
  FOR ALL USING (user_id = current_app_user_id());

-- ── Session Messages (via session's user) ─────────────────────
ALTER TABLE session_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY session_messages_worker_scope ON session_messages
  FOR ALL USING (
    session_id IN (SELECT id FROM sessions WHERE user_id = current_app_user_id())
  );

-- ── Session Attachments ───────────────────────────────────────
ALTER TABLE session_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY session_attachments_worker_scope ON session_attachments
  FOR ALL USING (user_id = current_app_user_id());

-- ── Ideas ─────────────────────────────────────────────────────
ALTER TABLE ideas ENABLE ROW LEVEL SECURITY;
CREATE POLICY ideas_worker_scope ON ideas
  FOR ALL USING (user_id = current_app_user_id());

-- ── Idea Attachments ──────────────────────────────────────────
ALTER TABLE idea_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY idea_attachments_worker_scope ON idea_attachments
  FOR ALL USING (user_id = current_app_user_id());

-- ── Idea Phases (via idea's user) ─────────────────────────────
ALTER TABLE idea_phases ENABLE ROW LEVEL SECURITY;
CREATE POLICY idea_phases_worker_scope ON idea_phases
  FOR ALL USING (
    idea_id IN (SELECT id FROM ideas WHERE user_id = current_app_user_id())
  );

-- ── Plans (via idea's user) ──────────────────────────────────
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY plans_worker_scope ON plans
  FOR ALL USING (
    idea_id IN (SELECT id FROM ideas WHERE user_id = current_app_user_id())
  );

-- ── Beads (via rig's user) ───────────────────────────────────
ALTER TABLE beads ENABLE ROW LEVEL SECURITY;
CREATE POLICY beads_worker_scope ON beads
  FOR ALL USING (
    rig_id IN (SELECT id FROM rigs WHERE user_id = current_app_user_id())
  );

-- ── Bead Dependencies (via bead's rig's user) ────────────────
ALTER TABLE bead_dependencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY bead_deps_worker_scope ON bead_dependencies
  FOR ALL USING (
    bead_id IN (
      SELECT b.id FROM beads b
      JOIN rigs r ON b.rig_id = r.id
      WHERE r.user_id = current_app_user_id()
    )
  );

-- ── Specs (via rig's user) ───────────────────────────────────
ALTER TABLE specs ENABLE ROW LEVEL SECURITY;
CREATE POLICY specs_worker_scope ON specs
  FOR ALL USING (
    rig_id IN (SELECT id FROM rigs WHERE user_id = current_app_user_id())
  );

-- ── Workers ──────────────────────────────────────────────────
ALTER TABLE workers ENABLE ROW LEVEL SECURITY;
CREATE POLICY workers_worker_scope ON workers
  FOR ALL USING (user_id = current_app_user_id());

-- ── Worker Tokens ────────────────────────────────────────────
ALTER TABLE worker_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY worker_tokens_worker_scope ON worker_tokens
  FOR ALL USING (user_id = current_app_user_id());

-- ── Notifications ────────────────────────────────────────────
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_worker_scope ON notifications
  FOR ALL USING (user_id = current_app_user_id());

-- ── Push Tokens ──────────────────────────────────────────────
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY push_tokens_worker_scope ON push_tokens
  FOR ALL USING (user_id = current_app_user_id());

-- ── Users (own row only) ─────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_worker_scope ON users
  FOR ALL USING (id = current_app_user_id());

-- ── Deployments (all workers can read/write, no user_id) ─────
ALTER TABLE deployments ENABLE ROW LEVEL SECURITY;
CREATE POLICY deployments_worker_scope ON deployments
  FOR ALL USING (true);

-- Grant BYPASSRLS to the admin role used by the central worker and API.
-- This ensures the central worker and API are unaffected by RLS.
-- On managed Postgres (e.g., DigitalOcean), this may fail due to restricted
-- superuser permissions — that's OK because the admin user already has full access.
DO $$ BEGIN
  EXECUTE format('ALTER ROLE %I BYPASSRLS', current_user);
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'BYPASSRLS not available (managed Postgres) — skipping';
END $$;
