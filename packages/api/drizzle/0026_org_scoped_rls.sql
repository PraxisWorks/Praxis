-- Org-scoped RLS policies.
--
-- The original 0018 policies scope rows by user_id = current_app_user_id().
-- This is too restrictive for org-level worker routing: when an org's worker
-- processes sessions from multiple org members, it can only see its owner's
-- rows.  It also prevents org members from seeing each other's work in the app.
--
-- This migration adds ADDITIONAL policies (Postgres ORs multiple policies on
-- the same table) that grant access to rows belonging to any member of the
-- user's shared org(s).  The existing per-user policies remain as a fast path.

-- ── Helper function ─────────────────────────────────────────────
-- Returns true if check_user_id is the current user OR shares an org.
CREATE OR REPLACE FUNCTION is_org_peer(check_user_id uuid) RETURNS boolean AS $$
BEGIN
  -- Fast path: same user
  IF check_user_id = current_app_user_id() THEN
    RETURN true;
  END IF;
  -- Shared org membership
  RETURN EXISTS (
    SELECT 1 FROM org_members om1
    JOIN org_members om2 ON om1.org_id = om2.org_id
    WHERE om1.user_id = current_app_user_id()
      AND om2.user_id = check_user_id
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- ── Rigs (use org_id directly — more efficient) ────────────────
DROP POLICY IF EXISTS rigs_org_scope ON rigs;
CREATE POLICY rigs_org_scope ON rigs
  FOR ALL USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = current_app_user_id())
  );

-- ── Sessions ────────────────────────────────────────────────────
DROP POLICY IF EXISTS sessions_org_scope ON sessions;
CREATE POLICY sessions_org_scope ON sessions
  FOR ALL USING (is_org_peer(user_id));

-- ── Session Messages ────────────────────────────────────────────
DROP POLICY IF EXISTS session_messages_org_scope ON session_messages;
CREATE POLICY session_messages_org_scope ON session_messages
  FOR ALL USING (
    session_id IN (SELECT id FROM sessions WHERE is_org_peer(user_id))
  );

-- ── Session Attachments ─────────────────────────────────────────
DROP POLICY IF EXISTS session_attachments_org_scope ON session_attachments;
CREATE POLICY session_attachments_org_scope ON session_attachments
  FOR ALL USING (is_org_peer(user_id));

-- ── Ideas ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS ideas_org_scope ON ideas;
CREATE POLICY ideas_org_scope ON ideas
  FOR ALL USING (is_org_peer(user_id));

-- ── Idea Attachments ────────────────────────────────────────────
DROP POLICY IF EXISTS idea_attachments_org_scope ON idea_attachments;
CREATE POLICY idea_attachments_org_scope ON idea_attachments
  FOR ALL USING (is_org_peer(user_id));

-- ── Idea Phases (via idea) ──────────────────────────────────────
DROP POLICY IF EXISTS idea_phases_org_scope ON idea_phases;
CREATE POLICY idea_phases_org_scope ON idea_phases
  FOR ALL USING (
    idea_id IN (SELECT id FROM ideas WHERE is_org_peer(user_id))
  );

-- ── Plans (via idea) ────────────────────────────────────────────
DROP POLICY IF EXISTS plans_org_scope ON plans;
CREATE POLICY plans_org_scope ON plans
  FOR ALL USING (
    idea_id IN (SELECT id FROM ideas WHERE is_org_peer(user_id))
  );

-- ── Beads (via rig's org) ───────────────────────────────────────
DROP POLICY IF EXISTS beads_org_scope ON beads;
CREATE POLICY beads_org_scope ON beads
  FOR ALL USING (
    rig_id IN (
      SELECT id FROM rigs WHERE org_id IN (
        SELECT org_id FROM org_members WHERE user_id = current_app_user_id()
      )
    )
  );

-- ── Bead Dependencies (via bead → rig → org) ───────────────────
DROP POLICY IF EXISTS bead_deps_org_scope ON bead_dependencies;
CREATE POLICY bead_deps_org_scope ON bead_dependencies
  FOR ALL USING (
    bead_id IN (
      SELECT b.id FROM beads b
      JOIN rigs r ON b.rig_id = r.id
      WHERE r.org_id IN (
        SELECT org_id FROM org_members WHERE user_id = current_app_user_id()
      )
    )
  );

-- ── Specs (via rig's org) ───────────────────────────────────────
DROP POLICY IF EXISTS specs_org_scope ON specs;
CREATE POLICY specs_org_scope ON specs
  FOR ALL USING (
    rig_id IN (
      SELECT id FROM rigs WHERE org_id IN (
        SELECT org_id FROM org_members WHERE user_id = current_app_user_id()
      )
    )
  );

-- ── Workers (org members can see each other's workers) ──────────
DROP POLICY IF EXISTS workers_org_scope ON workers;
CREATE POLICY workers_org_scope ON workers
  FOR ALL USING (is_org_peer(user_id));

-- ── Users (org members can see each other's profiles) ───────────
DROP POLICY IF EXISTS users_org_scope ON users;
CREATE POLICY users_org_scope ON users
  FOR ALL USING (is_org_peer(id));
