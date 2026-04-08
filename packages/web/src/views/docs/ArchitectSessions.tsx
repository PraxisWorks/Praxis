export function ArchitectSessions() {
  return (
    <article className="doc-content max-w-3xl">
      <h1>Architecture Sessions</h1>

      <p>
        Architecture sessions are Praxis's structured planning process that turns a
        raw idea into a detailed engineering plan. Each session walks through 8
        specialized phases, producing epics and tasks (tasks) that can be executed in
        working sessions.
      </p>

      <h2>What is an Architect Session?</h2>

      <p>
        An architect session is an AI-assisted planning workshop that evaluates your
        idea from multiple perspectives — business value, user experience,
        requirements, architecture, security, DevOps, and engineering — before
        generating a structured plan.
      </p>

      <p>
        Think of it as running your idea through a review board of specialists, each
        contributing their expertise to create a comprehensive plan.
      </p>

      <h2>The 8 Phases</h2>

      <p>
        Each phase focuses on a different aspect of planning:
      </p>

      <div className="space-y-4 my-6">
        {[
          {
            num: 1,
            title: "Business Value",
            desc: "Evaluates the business impact and strategic alignment of the idea. Identifies key value propositions, target users, and success metrics.",
          },
          {
            num: 2,
            title: "User Benefits",
            desc: "Focuses on the end-user experience. Defines user stories, expected workflows, and the tangible improvements users will see.",
          },
          {
            num: 3,
            title: "Must-Have Requirements",
            desc: "Identifies the non-negotiable requirements — what must be true for this feature to ship. Includes functional requirements, constraints, and dependencies.",
          },
          {
            num: 4,
            title: "Product Review",
            desc: "A holistic product review that considers scope, timeline, trade-offs, and prioritization. Ensures the feature fits within the broader product vision.",
          },
          {
            num: 5,
            title: "Architecture Review",
            desc: "Designs the technical architecture — data models, API contracts, component structure, and integration points. Identifies technical risks and mitigation strategies.",
          },
          {
            num: 6,
            title: "DevOps Review",
            desc: "Plans deployment, infrastructure, monitoring, and CI/CD considerations. Ensures the feature can be reliably shipped and maintained.",
          },
          {
            num: 7,
            title: "Security Review",
            desc: "Identifies security implications — authentication, authorization, data privacy, input validation, and potential attack vectors.",
          },
          {
            num: 8,
            title: "Engineering Plan",
            desc: "Synthesizes all previous phases into an actionable engineering plan with epics, tasks (tasks), dependencies, and priority ordering.",
          },
        ].map((phase) => (
          <div
            key={phase.num}
            className="flex gap-4 p-4 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]"
          >
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[var(--accent)] text-white flex items-center justify-center text-sm font-bold">
              {phase.num}
            </div>
            <div>
              <h3 className="text-base font-semibold m-0 mb-1">{phase.title}</h3>
              <p className="text-sm m-0">{phase.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <h2>Phase Configuration Modes</h2>

      <p>
        Each phase can be configured with one of three modes:
      </p>

      <ul>
        <li>
          <strong>Full AI</strong> — The AI handles the entire phase autonomously.
          Best for standard features where you trust the AI's judgment.
        </li>
        <li>
          <strong>AI-Assisted</strong> — The AI generates a draft, then pauses for
          your review and edits before moving to the next phase. Best for critical
          decisions where you want human oversight.
        </li>
        <li>
          <strong>Skip</strong> — Skip the phase entirely. Use when a phase isn't
          relevant (e.g., skip Security Review for a UI-only change).
        </li>
      </ul>

      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--accent-light)] p-4 my-6">
        <p className="text-sm font-medium text-[var(--accent)] m-0">
          For your first few sessions, we recommend using "AI-Assisted" mode for all
          phases so you can see the output and learn how each phase works.
        </p>
      </div>

      <h2>Starting a Session</h2>

      <ol>
        <li>Open an idea from the <strong>Ideas</strong> view.</li>
        <li>Click <strong>"Start Architecture Session"</strong>.</li>
        <li>
          Configure each phase's mode (Full AI, AI-Assisted, or Skip) using the
          phase configuration panel.
        </li>
        <li>Click <strong>Start</strong> to begin the planning process.</li>
        <li>
          For AI-Assisted phases, review the output and make edits before approving
          to continue.
        </li>
      </ol>

      <h2>Plan Output</h2>

      <p>
        When the session completes, Praxis generates:
      </p>

      <ul>
        <li>
          <strong>Epics</strong> — High-level groupings of related work. Each epic
          represents a major deliverable or feature area.
        </li>
        <li>
          <strong>Tasks</strong> — Individual tasks within an epic. Each task has a
          title, description, priority, and dependency information.
        </li>
        <li>
          <strong>Dependency graph</strong> — The relationships between tasks,
          showing which tasks must be completed before others can start.
        </li>
      </ul>

      <p>
        These work items appear in the <strong>Board</strong> and{" "}
        <strong>Graph</strong> views, ready for execution through{" "}
        <a href="/documentation/working-sessions">working sessions</a>.
      </p>
    </article>
  );
}
