export function GettingStarted() {
  const flowSteps = [
    { label: "Worker", hint: "Connect a machine" },
    { label: "Org", hint: "Group projects" },
    { label: "Repo", hint: "Add a project" },
    { label: "Idea", hint: "Capture work" },
    { label: "Architect", hint: "Plan it" },
    { label: "Working", hint: "Build it" },
    { label: "Debug", hint: "Fix it" },
    { label: "Archive", hint: "Done" },
  ];

  return (
    <article className="doc-content max-w-3xl">
      <h1>Getting Started with Praxis</h1>

      <p>
        This guide walks you through everything you need to go from zero to a
        working development loop in Praxis. Follow these eight steps in order
        and you will have a fully connected workspace with AI-powered planning
        and execution.
      </p>

      {/* ── Flow diagram ── */}
      <div className="my-8 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] m-0 mb-4">
          The Praxis loop
        </p>
        <div className="flex flex-wrap items-center gap-y-3">
          {flowSteps.map((step, i) => (
            <div key={step.label} className="flex items-center">
              <div className="flex flex-col items-center">
                <div className="px-3 py-1.5 rounded-full text-xs font-semibold bg-[var(--accent-light)] text-[var(--accent)] whitespace-nowrap">
                  {i + 1}. {step.label}
                </div>
                <div className="mt-1 text-[10px] text-[var(--text-faint)] whitespace-nowrap">
                  {step.hint}
                </div>
              </div>
              {i < flowSteps.length - 1 && (
                <svg
                  className="w-4 h-4 mx-1 text-[var(--text-faint)] shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-[var(--text-faint)] mt-4 m-0">
          Steps 1–3 are one-time setup. Steps 4–8 repeat for every feature, fix,
          or experiment.
        </p>
      </div>

      {/* ── Step 1 ── */}
      <h2>1. Create a Local Worker Through Profile</h2>

      <p>
        A <strong>worker</strong> is the process that runs AI sessions on your
        machine. It connects to the Praxis server, picks up work, and executes
        it locally using your code and your environment.
      </p>

      <p>
        To set one up, go to your <strong>Profile</strong> page and follow the
        instructions there. The short version:
      </p>

      <pre><code>{`npm install -g @praxwork/cli
praxis login --token <token> --name 'My Laptop' --url https://prax.work
praxis start`}</code></pre>

      <p>
        The <code>praxis login</code> command registers your machine as a worker
        with the server. The <code>praxis start</code> command launches the
        worker process and begins listening for sessions.
      </p>

      <p>
        Once your worker is running, return to the <strong>Profile</strong> page
        and select it from the <strong>Active Worker</strong> dropdown. This
        tells Praxis which machine should run your sessions.
      </p>

      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] p-4 my-6">
        <p className="text-sm text-[var(--text-secondary)] m-0">
          <strong>Tip:</strong> You can register multiple workers (e.g. a laptop
          and a desktop) and switch between them from the Profile page at any
          time.
        </p>
      </div>

      <h3>Worker configuration (optional)</h3>

      <p>
        Workers are configured via environment variables on the machine that
        runs <code>praxis start</code>. The defaults are designed so you don't
        need to set anything to get started — a fresh worker runs your
        sessions, manages workspaces, and stays out of the way. The knobs
        below are all opt-in.
      </p>

      <h4>Where the worker reads env vars from</h4>

      <p>When <code>praxis start</code> launches, it merges env vars from three places, in this order of precedence:</p>

      <ol>
        <li>
          <strong>Shell environment</strong> — anything exported in your
          shell profile (<code>.bashrc</code>, <code>.zshrc</code>), set
          inline (<code>RIG_INIT_CLAUDE_FLOW=true praxis start</code>), or
          injected by a process supervisor (pm2, systemd, launchd).
        </li>
        <li>
          <strong><code>~/.praxis/.env</code></strong> — the canonical
          per-user config file. Create it if you want persistent tunables
          without editing your shell profile. Values here are overridden
          by shell env, but take precedence over the per-project file.
        </li>
        <li>
          <strong><code>.env</code> in the directory you ran{" "}
          <code>praxis start</code> from</strong> — useful for per-project
          overrides. Only fills in vars that neither the shell nor{" "}
          <code>~/.praxis/.env</code> has already set.
        </li>
      </ol>

      <p>
        There are a handful of runtime settings the worker sets for you
        during <code>praxis login</code> (<code>WORKER_ID</code>,{" "}
        <code>WORKER_NAME</code>, <code>WORKER_USER_ID</code>,{" "}
        <code>DATABASE_URL</code>) — those live in{" "}
        <code>~/.praxis/config.json</code> and you should not hand-edit them.
      </p>

      <h4>Rig initialization</h4>

      <table className="text-sm my-4">
        <thead>
          <tr>
            <th className="text-left pr-6 pb-2">Env var</th>
            <th className="text-left pr-6 pb-2">Default</th>
            <th className="text-left pb-2">What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-[var(--border-secondary)]">
            <td className="pr-6 py-2"><code>RIG_INIT_CLAUDE_FLOW</code></td>
            <td className="pr-6 py-2"><code>false</code></td>
            <td className="py-2">
              Set to <code>true</code> to enable the{" "}
              <a href="https://github.com/ruvnet/ruflo" target="_blank" rel="noopener noreferrer">Ruflo</a>{" "}
              orchestrator (formerly claude-flow) on session start. Off by
              default — Praxis itself doesn't require it.
            </td>
          </tr>
          <tr className="border-t border-[var(--border-secondary)]">
            <td className="pr-6 py-2"><code>RIG_INIT_SCRIPTS</code></td>
            <td className="pr-6 py-2"><code>[]</code></td>
            <td className="py-2">
              JSON array of absolute script paths to run once per repo on
              session start. Failures are non-fatal and logged as warnings.
            </td>
          </tr>
        </tbody>
      </table>

      <h4>Claude subprocess</h4>

      <table className="text-sm my-4">
        <thead>
          <tr>
            <th className="text-left pr-6 pb-2">Env var</th>
            <th className="text-left pr-6 pb-2">Default</th>
            <th className="text-left pb-2">What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-[var(--border-secondary)]">
            <td className="pr-6 py-2"><code>CLAUDE_MODEL</code></td>
            <td className="pr-6 py-2"><code>opus</code></td>
            <td className="py-2">Model passed to <code>claude --model</code>.</td>
          </tr>
          <tr className="border-t border-[var(--border-secondary)]">
            <td className="pr-6 py-2"><code>CLAUDE_COMMAND</code></td>
            <td className="pr-6 py-2"><code>claude</code></td>
            <td className="py-2">
              Binary name. Set to a wrapper script if you need custom
              behavior (e.g. a logging wrapper or an alt client).
            </td>
          </tr>
          <tr className="border-t border-[var(--border-secondary)]">
            <td className="pr-6 py-2"><code>CLAUDE_BIN_DIR</code></td>
            <td className="pr-6 py-2">(unset)</td>
            <td className="py-2">
              Directory containing the <code>claude</code> binary. Prepended
              to <code>PATH</code> for spawned subprocesses.
            </td>
          </tr>
          <tr className="border-t border-[var(--border-secondary)]">
            <td className="pr-6 py-2"><code>ANTHROPIC_API_KEY</code></td>
            <td className="pr-6 py-2">(unset)</td>
            <td className="py-2">
              BYOK key — when set, sessions authenticate with this key
              instead of the shared default.
            </td>
          </tr>
        </tbody>
      </table>

      <h4>Workspace and storage</h4>

      <table className="text-sm my-4">
        <thead>
          <tr>
            <th className="text-left pr-6 pb-2">Env var</th>
            <th className="text-left pr-6 pb-2">Default</th>
            <th className="text-left pb-2">What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-[var(--border-secondary)]">
            <td className="pr-6 py-2"><code>WORKSPACE_ROOT</code></td>
            <td className="pr-6 py-2"><code>~/.praxis/workspaces</code></td>
            <td className="py-2">Where repos are cloned on disk.</td>
          </tr>
          <tr className="border-t border-[var(--border-secondary)]">
            <td className="pr-6 py-2"><code>STORAGE_PROVIDER</code></td>
            <td className="pr-6 py-2">(console)</td>
            <td className="py-2">
              <code>"local"</code> or <code>"s3"</code>. Controls where
              session attachments are stored. Unset logs attachment metadata
              to the console only.
            </td>
          </tr>
          <tr className="border-t border-[var(--border-secondary)]">
            <td className="pr-6 py-2"><code>STORAGE_LOCAL_DIR</code></td>
            <td className="pr-6 py-2"><code>./uploads</code></td>
            <td className="py-2">
              Local storage directory. Only used when{" "}
              <code>STORAGE_PROVIDER=local</code>.
            </td>
          </tr>
          <tr className="border-t border-[var(--border-secondary)]">
            <td className="pr-6 py-2">
              <code>S3_BUCKET</code> / <code>S3_REGION</code> /{" "}
              <code>S3_ENDPOINT</code>
            </td>
            <td className="pr-6 py-2">(unset)</td>
            <td className="py-2">
              S3 storage config. <code>S3_ENDPOINT</code> lets you point at
              Minio, R2, or any S3-compatible service.
            </td>
          </tr>
          <tr className="border-t border-[var(--border-secondary)]">
            <td className="pr-6 py-2">
              <code>AWS_ACCESS_KEY_ID</code> / <code>AWS_SECRET_ACCESS_KEY</code>
            </td>
            <td className="pr-6 py-2">(unset)</td>
            <td className="py-2">
              S3 credentials. Omit if you use instance profiles or IAM roles.
            </td>
          </tr>
        </tbody>
      </table>

      <h4>Template fallback for +New</h4>

      <table className="text-sm my-4">
        <thead>
          <tr>
            <th className="text-left pr-6 pb-2">Env var</th>
            <th className="text-left pr-6 pb-2">Default</th>
            <th className="text-left pb-2">What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-[var(--border-secondary)]">
            <td className="pr-6 py-2">
              <code>GH_ORG</code> / <code>TEMPLATE_REPO</code>
            </td>
            <td className="pr-6 py-2">(unset)</td>
            <td className="py-2">
              Fallback template for <strong>+ New</strong> when the org has
              no template configured. If both are unset and the org has
              none, <strong>+ New</strong> is blocked with a clear error
              message — set the template in Org Settings, or use{" "}
              <strong>+ Add</strong> to connect an existing repo.
            </td>
          </tr>
        </tbody>
      </table>

      <h4>Observability</h4>

      <table className="text-sm my-4">
        <thead>
          <tr>
            <th className="text-left pr-6 pb-2">Env var</th>
            <th className="text-left pr-6 pb-2">Default</th>
            <th className="text-left pb-2">What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-[var(--border-secondary)]">
            <td className="pr-6 py-2"><code>LOG_LEVEL</code></td>
            <td className="pr-6 py-2"><code>info</code></td>
            <td className="py-2">
              <code>trace</code> | <code>debug</code> | <code>info</code> |{" "}
              <code>warn</code> | <code>error</code> | <code>fatal</code>.
              The main knob for worker log verbosity.
            </td>
          </tr>
          <tr className="border-t border-[var(--border-secondary)]">
            <td className="pr-6 py-2"><code>NODE_ENV</code></td>
            <td className="pr-6 py-2"><code>production</code></td>
            <td className="py-2">
              Forced to <code>production</code> by the CLI unless already
              set. Mainly affects log formatting.
            </td>
          </tr>
          <tr className="border-t border-[var(--border-secondary)]">
            <td className="pr-6 py-2">
              <code>GIT_SHA</code> / <code>DEPLOY_TIMESTAMP</code>
            </td>
            <td className="pr-6 py-2">(unset)</td>
            <td className="py-2">
              When set, the worker registers itself in the deployments
              table on startup. Normally set by deploy workflows.
            </td>
          </tr>
        </tbody>
      </table>

      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] p-4 my-6">
        <p className="text-sm text-[var(--text-secondary)] m-0 mb-2">
          <strong>Heads up — Ruflo is opt-in.</strong> Earlier versions of
          Praxis ran Ruflo automatically on every session start. As of the
          template-agnostic refactor, Ruflo is off by default and becomes an
          orchestrator you can plug in when you want it. If you want the old
          behavior, set <code>RIG_INIT_CLAUDE_FLOW=true</code> in your
          shell or in <code>~/.praxis/.env</code>.
        </p>
        <p className="text-xs text-[var(--text-faint)] m-0">
          Also: the per-worker <em>Rig Init Settings</em> panel in the UI is
          hidden for now. Rig init is currently driven exclusively by the
          env vars above. A future update will let you configure this per
          worker from the UI.
        </p>
      </div>

      {/* ── Step 2 ── */}
      <h2>2. Create an Organization</h2>

      <p>
        Organizations group people and projects together. Every repo lives
        inside an organization, and every member of the organization can see
        the repos it contains.
      </p>

      <p>
        Use the <strong>org switcher</strong> in the top-left corner of the UI
        to create a new organization or switch between existing ones. Give your
        org a name that reflects your team or company.
      </p>

      {/* ── Step 3 ── */}
      <h2>3. Add a Repo</h2>

      <p>
        A <strong>repo</strong> is a project workspace in Praxis. It ties
        together a repository, its ideas, architecture plans, working sessions,
        and views. Each repo operates independently so you can manage multiple
        projects side by side.
      </p>

      <p>
        Click the <strong>"Add Repo"</strong> button in the left sidebar to
        create a new repo. You will be prompted to provide a repository URL or
        select from your connected GitHub organizations. Praxis clones the repo
        to your worker and sets up the workspace.
      </p>

      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] p-4 my-6">
        <p className="text-sm text-[var(--text-secondary)] m-0">
          <strong>Tip:</strong> You can add as many repositories as you want.
          Each repo operates independently with its own ideas, plans, and
          sessions.
        </p>
      </div>

      {/* ── Step 4 ── */}
      <h2>4. Create an Idea</h2>

      <p>
        Ideas are lightweight backlog items — features, bugs, improvements, or
        experiments. Click the <strong>"+ New Idea"</strong> button inside your
        repo to create one.
      </p>

      <p>
        A good idea description is specific enough for the AI to plan around.
        Include what the feature should do, why it matters, and any acceptance
        criteria you care about. The more context you provide, the better the
        architecture session will be.
      </p>

      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--accent-light)] p-4 my-6">
        <p className="text-sm font-medium text-[var(--accent)] m-0">
          Write ideas the way you would write a ticket for a senior engineer —
          clear goal, known constraints, and measurable done criteria.
        </p>
      </div>

      {/* ── Step 5 ── */}
      <h2>5. Start an Architecture Session</h2>

      <p>
        An architecture session is an 8-phase planning workshop that turns your
        idea into a detailed engineering plan complete with epics and tasks. To
        start one, open an idea and click <strong>"Architecture"</strong>.
      </p>

      <p>Here is what to expect during the phases:</p>

      <ol>
        <li>
          <strong>Context Gathering</strong> — The AI reads your codebase and
          understands the current state of the project.
        </li>
        <li>
          <strong>Requirements Analysis</strong> — It extracts functional and
          non-functional requirements from your idea description.
        </li>
        <li>
          <strong>Design Exploration</strong> — Multiple approaches are
          considered and trade-offs are evaluated.
        </li>
        <li>
          <strong>Architecture Decision</strong> — A concrete technical approach
          is selected and documented.
        </li>
        <li>
          <strong>Task Decomposition</strong> — The work is broken into epics
          and individual tasks.
        </li>
        <li>
          <strong>Dependency Mapping</strong> — Task ordering and dependencies
          are identified.
        </li>
        <li>
          <strong>Risk Assessment</strong> — Potential blockers and risks are
          called out.
        </li>
        <li>
          <strong>Plan Finalization</strong> — Everything is assembled into a
          reviewable plan.
        </li>
      </ol>

      <p>
        When the session completes, you will have a structured plan with clearly
        defined epics and tasks ready for review.
      </p>

      {/* ── Step 6 ── */}
      <h2>6. Approve the Plan and Start a Working Session</h2>

      <p>
        After the architecture session finishes, review the generated epics and
        tasks. You can edit titles, descriptions, and acceptance criteria before
        approving.
      </p>

      <p>
        Once you are satisfied, click <strong>"Approve"</strong> to lock in the
        plan. Then start a <strong>working session</strong> to begin execution.
        The AI picks up tasks from the plan, writes code, runs tests, and
        commits changes — all on your local worker.
      </p>

      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] p-4 my-6">
        <p className="text-sm text-[var(--text-secondary)] m-0">
          <strong>Tip:</strong> You can watch the session in real time from the
          sessions panel on the right side of the UI. Each task shows its
          current status as the AI works through the plan.
        </p>
      </div>

      {/* ── Step 7 ── */}
      <h2>7. Debug Through a Debug Session</h2>

      <p>
        Sometimes things break — a test fails, behavior is unexpected, or an
        error surfaces after a working session. When that happens, start a{' '}
        <strong>debug session</strong>.
      </p>

      <p>
        Debug sessions are purpose-built for investigation. Describe the
        problem you are seeing (error messages, failing tests, unexpected
        behavior) and the AI will trace through the code, identify the root
        cause, and apply a fix.
      </p>

      <p>
        You can start a debug session from the idea or directly from the
        sessions panel. Use them whenever you need targeted fixes rather than
        full-plan execution.
      </p>

      {/* ── Step 8 ── */}
      <h2>8. Archive the Idea and Complete All Sessions</h2>

      <p>
        When all sessions for an idea are finished and the work is merged, mark
        the idea as done. This moves it to the <strong>archived</strong> state,
        keeping your backlog clean while preserving the full history of plans,
        sessions, and commits.
      </p>

      <p>
        Make sure all associated sessions (architecture, working, debug) are
        completed before archiving. Praxis will warn you if any sessions are
        still active.
      </p>

      {/* ── Iterative Loop Callout ── */}
      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--accent-light)] p-4 my-6">
        <p className="text-sm font-medium text-[var(--accent)] m-0">
          <strong>Repeat Steps 4–8</strong> for every new feature, improvement,
          or bug fix. Each cycle follows the same loop: create an idea, plan it
          with an architecture session, execute it with a working session, debug
          if needed, and archive when done. This iterative workflow keeps your
          project moving forward with a clear, repeatable process.
        </p>
      </div>
    </article>
  );
}
