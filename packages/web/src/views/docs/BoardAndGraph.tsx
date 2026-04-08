export function BoardAndGraph() {
  return (
    <article className="doc-content max-w-3xl">
      <h1>Board, Graph & Views</h1>

      <p>
        Praxis provides several visualization tools to help you understand the state
        of your project at a glance. Each view serves a different purpose — use them
        together for a complete picture.
      </p>

      <h2>Board View</h2>

      <p>
        The Board view presents your work items as a kanban board with columns for
        each status:
      </p>

      <div className="my-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Draft", desc: "Not started yet" },
          { label: "In Progress", desc: "Actively being worked on" },
          { label: "Review", desc: "Awaiting review or merge" },
          { label: "Complete", desc: "Done and merged" },
        ].map((col) => (
          <div
            key={col.label}
            className="p-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]"
          >
            <h4 className="text-sm font-semibold m-0 mb-1">{col.label}</h4>
            <p className="text-xs text-[var(--text-muted)] m-0">{col.desc}</p>
          </div>
        ))}
      </div>

      <p>Key features of the Board view:</p>

      <ul>
        <li>
          <strong>Drag and drop</strong> — Move tasks between columns to update their
          status manually.
        </li>
        <li>
          <strong>Grouping</strong> — Tasks are grouped by their parent epic, making
          it easy to see progress within each feature.
        </li>
        <li>
          <strong>Filtering</strong> — Use the filter bar to show only specific
          priorities, assignees, or epics.
        </li>
        <li>
          <strong>Quick actions</strong> — Click a task card to view details, edit, or
          start a working session.
        </li>
      </ul>

      <h2>Graph View</h2>

      <p>
        The Graph view shows your work items as a dependency graph — a visual network
        where nodes are tasks and edges represent dependencies.
      </p>

      <ul>
        <li>
          <strong>Dependency visualization</strong> — See which tasks block others.
          Arrows flow from dependencies to dependents.
        </li>
        <li>
          <strong>Critical path</strong> — The longest chain of dependencies is
          highlighted, showing the sequence that determines your project's minimum
          completion time.
        </li>
        <li>
          <strong>Status coloring</strong> — Nodes are colored by status so you can
          quickly identify bottlenecks.
        </li>
        <li>
          <strong>Interactive</strong> — Pan, zoom, and click nodes to see details.
          The layout is automatically computed for readability.
        </li>
      </ul>

      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--accent-light)] p-4 my-6">
        <p className="text-sm font-medium text-[var(--accent)] m-0">
          The Graph view is especially useful after an architecture session generates
          a complex plan with many interdependent tasks.
        </p>
      </div>

      <h2>Stats View</h2>

      <p>
        The Stats view provides metrics and analytics for your project:
      </p>

      <ul>
        <li>
          <strong>Completion rate</strong> — Percentage of tasks completed over time.
        </li>
        <li>
          <strong>Velocity</strong> — How many tasks are being completed per day or
          week.
        </li>
        <li>
          <strong>Status distribution</strong> — A breakdown of all tasks by current
          status.
        </li>
        <li>
          <strong>Session activity</strong> — How many working and architecture
          sessions have been run.
        </li>
      </ul>

      <h2>Deployments View</h2>

      <p>
        The Deployments view tracks the lifecycle of your code from merge to
        production:
      </p>

      <ul>
        <li>
          <strong>PR status</strong> — See open pull requests and their CI check
          results.
        </li>
        <li>
          <strong>Deployment history</strong> — A timeline of deployments with status
          (success, failed, rolling back).
        </li>
        <li>
          <strong>Environment tracking</strong> — Monitor which version of your code
          is running in each environment (dev, staging, production).
        </li>
      </ul>

      <h2>Notifications</h2>

      <p>
        The Notifications view aggregates events across your repo:
      </p>

      <ul>
        <li>Session completions and failures</li>
        <li>Task status changes</li>
        <li>PR merge events</li>
        <li>Deployment status updates</li>
      </ul>

      <p>
        Notifications also appear as toasts in the bottom-right corner of the UI for
        important events.
      </p>

      <h2>Questions Queue</h2>

      <p>
        When an AI session needs human input — choosing between approaches, clarifying
        requirements, or confirming scope — it posts a question to the Questions queue.
        This is a centralized place to answer pending questions so sessions can
        continue.
      </p>

      <ul>
        <li>
          Questions appear as interactive cards with discrete options.
        </li>
        <li>
          Answering a question immediately unblocks the waiting session.
        </li>
        <li>
          You can access the queue from the <strong>Questions</strong> tab or through
          notification badges.
        </li>
      </ul>
    </article>
  );
}
