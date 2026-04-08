-- Back-fill idea statuses that were missed due to propagation bug
-- (propagation only fired when idea was in 'planned', missing 'new' and 'planning')

-- Step 1: Move ideas to in_progress where any child bead has started work
UPDATE ideas SET status = 'in_progress', updated_at = NOW()
WHERE status IN ('new', 'planning', 'planned')
AND id IN (
  SELECT DISTINCT idea_id FROM beads
  WHERE idea_id IS NOT NULL
  AND status IN ('in_progress', 'complete', 'archived')
);
--> statement-breakpoint
-- Step 2: Move ideas to complete where ALL child beads are terminal
UPDATE ideas SET status = 'complete', updated_at = NOW()
WHERE status = 'in_progress'
AND id IN (
  SELECT idea_id FROM beads
  WHERE idea_id IS NOT NULL
  GROUP BY idea_id
  HAVING COUNT(*) = COUNT(*) FILTER (WHERE status IN ('complete', 'archived'))
);
