export function Stats() {
  return (
    <article className="doc-content max-w-3xl">
      <h1>Stats</h1>

      <p>
        The <strong>Stats</strong> view is your dashboard for understanding how
        much work is in flight, what's stuck, and how the project is moving
        over time. It rolls up ideas, epics, and tasks across one repo or your
        entire workspace into a small set of charts you can scan in seconds.
      </p>

      <h2>What Stats Shows</h2>

      <p>The view is split into two halves:</p>

      <h3>Summary (right now)</h3>
      <ul>
        <li>
          <strong>Ideas by status</strong> — how many ideas are new, planning,
          planned, in progress, complete, dismissed, or archived.
        </li>
        <li>
          <strong>Epics by status</strong> — same breakdown for epics (parent
          tasks that group related work).
        </li>
        <li>
          <strong>Tasks by status</strong> — leaf-level tasks broken into
          draft, approved, in progress, blocked, complete, and archived.
        </li>
        <li>
          <strong>Totals</strong> — overall counts so you know the size of
          your backlog at a glance.
        </li>
      </ul>

      <h3>Timeline (over time)</h3>
      <p>
        Stacked area charts show how each status has changed over time, so you
        can see whether work is actually moving toward completion or whether
        it's piling up in one stage. The same status colors are used in the
        summary and the timeline so they stay easy to follow.
      </p>

      <h2>Filtering</h2>

      <p>You can narrow what's counted in two ways:</p>
      <ul>
        <li>
          <strong>Repo scope</strong> — leave the sidebar on "All repos" to see
          your entire workspace, or select a single repo to scope the charts
          to just that project.
        </li>
        <li>
          <strong>Status chips</strong> — toggle individual statuses (new,
          planning, in progress, blocked, complete, archived, etc.) to focus
          on a slice of the workflow. Useful when you want to know "how many
          things are blocked right now?" without the noise of the rest.
        </li>
      </ul>

      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] p-4 my-6">
        <p className="text-sm text-[var(--text-secondary)] m-0">
          <strong>Tip:</strong> The blocked count is the most actionable
          number on this page. If it's growing, that's where to focus —
          unblock those tasks before starting new work.
        </p>
      </div>

      <h2>How Counts Are Computed</h2>

      <p>
        Counts are computed live from the database every time you load the
        view (no caching, no batched aggregation). The query is scoped to the
        repos you have access to via your org memberships, so the numbers you
        see are always your numbers — never another team's.
      </p>

      <p>
        Epics and tasks are tracked separately (epics are tasks where{" "}
        <code>isEpic = true</code>) so a complete epic doesn't double-count
        against your task throughput. Idea status reflects the idea lifecycle
        (new → planning → planned → in_progress → complete), while task
        status reflects implementation state (draft → approved → in_progress →
        complete, with blocked as a side branch).
      </p>

      <h2>What Stats Is For</h2>

      <p>
        Stats answers three questions quickly:
      </p>
      <ol>
        <li>
          <strong>How much is happening right now?</strong> Look at the totals
          and the in-progress counts.
        </li>
        <li>
          <strong>What's stuck?</strong> Filter to "blocked" and you'll see it
          immediately.
        </li>
        <li>
          <strong>Are we shipping?</strong> Look at the complete area in the
          timeline — if it's growing, work is moving through.
        </li>
      </ol>

      <p>
        It is intentionally not a project-management tool — there's no
        velocity, burn-down, or estimation. The goal is honest visibility, not
        forecasting.
      </p>
    </article>
  );
}
