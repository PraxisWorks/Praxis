export function WorkingSessions() {
  return (
    <article className="doc-content max-w-3xl">
      <h1>Working Sessions</h1>

      <p>
        Working sessions are where plans become code. After an architecture session
        generates epics and tasks, working sessions execute the plan — writing code,
        running tests, committing changes, and tracking progress through task
        completion.
      </p>

      <h2>How Working Sessions Work</h2>

      <p>
        A working session is an AI-powered coding session tied to a specific epic.
        The AI agent:
      </p>

      <ul>
        <li>Reads the epic's tasks and understands the dependency order</li>
        <li>Starts with unblocked tasks (no pending dependencies)</li>
        <li>Writes code, creates tests, and validates the build</li>
        <li>Commits changes with descriptive messages</li>
        <li>Marks tasks as complete and moves to the next one</li>
        <li>Creates a pull request when all tasks in the epic are done</li>
      </ul>

      <h2>Starting a Working Session</h2>

      <ol>
        <li>Navigate to the <strong>Board</strong> or <strong>Ideas</strong> view.</li>
        <li>
          Find an idea with status <strong>"planned"</strong> — this means the
          architecture session has completed and work items are ready.
        </li>
        <li>Click <strong>"Start Working Session"</strong>.</li>
        <li>
          The session opens in the right panel, showing real-time progress as the
          AI works through the tasks.
        </li>
      </ol>

      <h2>Task Tracking</h2>

      <p>
        Tasks follow a simple lifecycle during a working session:
      </p>

      <div className="my-6 flex flex-wrap gap-2">
        {["draft", "in_progress", "complete"].map((status, i) => (
          <div key={status} className="flex items-center gap-2">
            <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-[var(--accent-light)] text-[var(--accent)]">
              {status.replace("_", " ")}
            </span>
            {i < 2 && (
              <svg className="w-4 h-4 text-[var(--text-faint)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
          </div>
        ))}
      </div>

      <ul>
        <li>
          <strong>Draft</strong> — The task exists but work hasn't started. It may be
          blocked by dependencies.
        </li>
        <li>
          <strong>In Progress</strong> — The task has been claimed and is actively
          being worked on.
        </li>
        <li>
          <strong>Complete</strong> — Code has been written, tested, committed, and
          pushed.
        </li>
      </ul>

      <h2>The Epic-First Workflow</h2>

      <p>
        Working sessions follow an epic-first workflow:
      </p>

      <ol>
        <li>
          <strong>Identify ready tasks</strong> — Find tasks with no pending
          dependencies.
        </li>
        <li>
          <strong>Start the task</strong> — Claim it and begin implementation.
        </li>
        <li>
          <strong>Implement</strong> — Write code, following the task description and
          acceptance criteria.
        </li>
        <li>
          <strong>Test</strong> — Run the test suite to verify the implementation.
        </li>
        <li>
          <strong>Commit & push</strong> — Commit with a descriptive message including
          the task ID.
        </li>
        <li>
          <strong>Complete the task</strong> — Mark it done, unblocking dependent tasks.
        </li>
        <li>
          <strong>Repeat</strong> — Move to the next ready task until all are complete.
        </li>
        <li>
          <strong>Complete the epic</strong> — When all tasks are done, finalize the
          epic and create a pull request.
        </li>
      </ol>

      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] p-4 my-6">
        <p className="text-sm text-[var(--text-secondary)] m-0">
          <strong>Commit conventions:</strong> Task IDs are included in commit messages
          so progress can be tracked automatically. Example:{" "}
          <code>feat: add user profile page (PRX-prx-abc12)</code>
        </p>
      </div>

      <h2>Session Progress</h2>

      <p>
        The sessions panel (right side of the UI) shows:
      </p>

      <ul>
        <li>
          <strong>Real-time output</strong> — See what the AI is doing as it works,
          including code diffs, test results, and commit messages.
        </li>
        <li>
          <strong>Task progress</strong> — A summary of how many tasks are complete
          vs. remaining.
        </li>
        <li>
          <strong>Session status</strong> — Whether the session is active, paused, or
          completed.
        </li>
      </ul>

      <p>
        You can have multiple working sessions running for different epics
        simultaneously. Each session operates independently in its own branch.
      </p>
    </article>
  );
}
