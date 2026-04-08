export function IdeasWorkflow() {
  return (
    <article className="doc-content max-w-3xl">
      <h1>Ideas Workflow</h1>

      <p>
        Ideas are the starting point of every feature, bug fix, or improvement in
        Praxis. The Ideas view serves as your lightweight, structured backlog where
        raw thoughts become actionable plans.
      </p>

      <h2>What is an Idea?</h2>

      <p>
        An idea is a work item that captures something you want to build, fix, or
        improve. Ideas are intentionally lightweight — they capture intent, not
        implementation details. The architecture session process handles the detailed
        planning later.
      </p>

      <p>Each idea includes:</p>
      <ul>
        <li><strong>Title</strong> — A short, descriptive name</li>
        <li><strong>Description</strong> — Context, motivation, and any relevant details</li>
        <li><strong>Size</strong> — An estimate of effort: small, medium, or large</li>
        <li><strong>Status</strong> — Where it is in the workflow pipeline</li>
        <li><strong>Repo</strong> — The project workspace it belongs to</li>
      </ul>

      <h2>Idea Lifecycle</h2>

      <p>
        Ideas move through a clear progression:
      </p>

      <div className="my-6 flex flex-wrap gap-2">
        {["new", "planning", "planned", "in_progress", "complete"].map((status, i) => (
          <div key={status} className="flex items-center gap-2">
            <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-[var(--accent-light)] text-[var(--accent)]">
              {status.replace("_", " ")}
            </span>
            {i < 4 && (
              <svg className="w-4 h-4 text-[var(--text-faint)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
          </div>
        ))}
      </div>

      <ol>
        <li>
          <strong>New</strong> — The idea has been created but not yet reviewed. This
          is the default state for all new ideas.
        </li>
        <li>
          <strong>Planning</strong> — An architecture session has been started for this
          idea. The 8-phase planning process is underway.
        </li>
        <li>
          <strong>Planned</strong> — The architecture session is complete. An
          engineering plan with epics and tasks has been generated.
        </li>
        <li>
          <strong>In Progress</strong> — A working session has been started and work is
          actively being done on the generated plan.
        </li>
        <li>
          <strong>Complete</strong> — All work items have been finished, committed, and
          merged.
        </li>
      </ol>

      <h2>Creating an Idea</h2>

      <ol>
        <li>Navigate to the <strong>Ideas</strong> tab in your repo.</li>
        <li>Click the <strong>"+ New Idea"</strong> button.</li>
        <li>
          Fill in the title and description. Be specific about what you want to
          achieve and why — this context feeds into the architecture session.
        </li>
        <li>Set the size estimate (small, medium, or large).</li>
        <li>Click <strong>Create</strong> to add it to your backlog.</li>
      </ol>

      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--accent-light)] p-4 my-6">
        <p className="text-sm font-medium text-[var(--accent)] m-0">
          Good ideas include clear context about the "why" — not just the "what."
          The more context you provide, the better the architecture session output
          will be.
        </p>
      </div>

      <h2>Filtering & Organizing</h2>

      <p>
        The Ideas view provides several ways to find and organize your backlog:
      </p>

      <ul>
        <li>
          <strong>Status filter</strong> — Show only ideas in a specific state (new,
          planning, in progress, etc.)
        </li>
        <li>
          <strong>Size filter</strong> — Filter by estimated effort level
        </li>
        <li>
          <strong>Repo filter</strong> — When viewing across multiple repos, narrow down
          to a specific project
        </li>
        <li>
          <strong>Search</strong> — Free-text search across titles and descriptions
        </li>
      </ul>

      <h2>Promoting to Architecture</h2>

      <p>
        When you're ready to turn an idea into a real plan:
      </p>

      <ol>
        <li>Click on the idea to open its detail view.</li>
        <li>
          Click <strong>"Start Architecture Session"</strong> to launch the 8-phase
          planning workshop.
        </li>
        <li>The idea status automatically moves to <strong>planning</strong>.</li>
        <li>
          Once the session completes, epics and tasks are generated, and the idea
          status moves to <strong>planned</strong>.
        </li>
      </ol>

      <p>
        See the <a href="/documentation/architect-sessions">Architecture Sessions</a>{" "}
        documentation for details on the planning process.
      </p>
    </article>
  );
}
