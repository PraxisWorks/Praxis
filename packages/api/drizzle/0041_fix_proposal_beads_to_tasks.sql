-- Migration: Rename "beads" → "tasks" inside plan proposal JSONB data.
-- The 0033 migration renamed the table/columns but missed the JSONB keys
-- stored inside plans.proposal, where each epic has a "beads" array that
-- should be named "tasks".

UPDATE plans
SET proposal = (
  SELECT jsonb_set(
    proposal,
    '{epics}',
    (
      SELECT jsonb_agg(
        CASE
          WHEN epic ? 'beads' AND NOT (epic ? 'tasks')
          THEN (epic - 'beads') || jsonb_build_object('tasks', epic->'beads')
          ELSE epic
        END
      )
      FROM jsonb_array_elements(proposal->'epics') AS epic
    )
  )
)
WHERE proposal->'epics' IS NOT NULL
  AND proposal::text LIKE '%"beads"%';
