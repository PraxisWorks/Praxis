export function Deployments() {
  return (
    <article className="doc-content max-w-3xl">
      <h1>Deployments</h1>

      <p>
        The <strong>Deployments</strong> view gives you a single, real-time
        place to see where every commit on every repo has actually shipped to.
        It pulls deployment status directly from GitHub so what you see in
        Praxis matches what you'd see on the GitHub deployments tab — without
        having to leave the app.
      </p>

      <h2>What Gets Tracked</h2>

      <p>
        Praxis listens for GitHub deployment events on every repo you've
        connected. For each repo it shows:
      </p>
      <ul>
        <li>
          <strong>Environment</strong> — production, staging, preview, or any
          custom environment your CI/CD configures (sorted with production
          first).
        </li>
        <li>
          <strong>Status</strong> — success, in_progress, queued, pending,
          failure, error, inactive, or waiting. Each status is color-coded so
          you can scan a list at a glance.
        </li>
        <li>
          <strong>Commit</strong> — the SHA that was deployed, with a link
          back to GitHub.
        </li>
        <li>
          <strong>When</strong> — relative time since the deployment changed
          state ("just now", "12m ago", "3h ago", "2d ago").
        </li>
      </ul>

      <h2>How It Works</h2>

      <p>
        When you add a repo to Praxis, it registers a GitHub webhook on that
        repository. From then on, whenever GitHub fires a{" "}
        <code>deployment</code> or <code>deployment_status</code> event,
        Praxis records it and pushes the update to any open Deployments view in
        real time. There's no polling — the page is live.
      </p>

      <p>The flow looks like this:</p>
      <ol>
        <li>Your CI (GitHub Actions, etc.) creates a GitHub deployment.</li>
        <li>GitHub fires the webhook → Praxis API receives it.</li>
        <li>
          Praxis upserts the deployment row and publishes a sync event over
          pubsub.
        </li>
        <li>The Deployments view in your browser updates instantly.</li>
      </ol>

      <h2>Filtering by Repo</h2>

      <p>
        The Deployments view respects whatever repo you have selected in the
        sidebar. Select a single repo to see only its environments, or
        deselect (go to "All repos") to see every deployment across every repo
        in your accessible orgs.
      </p>

      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] p-4 my-6">
        <p className="text-sm text-[var(--text-secondary)] m-0">
          <strong>Heads up:</strong> Deployments only show up after Praxis has
          successfully registered the webhook on the repo. If you're seeing an
          empty state, the empty-state diagnostics on the page will tell you
          which step is missing — usually either GitHub isn't configured at
          the server level, or the webhook hasn't been registered yet for
          that specific repo.
        </p>
      </div>

      <h2>Why Bring Deployments Into Praxis?</h2>

      <p>
        Praxis already knows what work is in flight for each repo (ideas,
        tasks, sessions). Pulling deployment status into the same UI closes
        the loop: you can see the task you just merged actually land in
        production without context-switching. It's also the first place to
        check when a session reports a build or deploy failure — the failing
        deployment row will be right there with a link to the GitHub run.
      </p>
    </article>
  );
}
