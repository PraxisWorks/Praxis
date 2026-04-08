export function Questions() {
  return (
    <article className="doc-content max-w-3xl">
      <h1>Question Queue</h1>

      <p>
        While the AI is working on a session — planning an architecture,
        building a feature, or debugging an issue — it sometimes needs
        information from you before it can move forward. Rather than blocking
        the session or guessing, Praxis posts a structured question to the
        <strong> Question Queue</strong>, lets the session pause, and waits for
        your answer.
      </p>

      <h2>When the AI Asks a Question</h2>

      <p>
        Sessions raise questions for things only you can answer. Common
        examples:
      </p>
      <ul>
        <li>
          <strong>Disambiguating intent</strong> — multiple valid approaches
          exist and the AI wants you to pick one (e.g. "Should this be
          server-rendered or client-rendered?").
        </li>
        <li>
          <strong>Confirming scope</strong> — a feature could be implemented
          minimally or expanded; the AI wants to know how far to go.
        </li>
        <li>
          <strong>Filling in unknowns</strong> — credentials, environment names,
          third-party service choices, or product decisions the codebase can't
          tell it.
        </li>
        <li>
          <strong>Approving destructive operations</strong> — schema migrations,
          file deletions, or anything irreversible.
        </li>
      </ul>

      <h2>How Questions Appear</h2>

      <p>
        Open questions surface in two places:
      </p>
      <ul>
        <li>
          <strong>Inline</strong> in the session panel where they were raised,
          so you can answer them in context.
        </li>
        <li>
          <strong>The Question Queue view</strong> at <code>/questions</code>,
          which is a single inbox of every open question across every repo and
          session you have access to.
        </li>
      </ul>

      <p>
        Questions come in a structured format. Most are multiple-choice with
        clearly labeled options and short descriptions of each — pick the one
        you want and the session continues. A few are free-text when there's no
        meaningful enumeration.
      </p>

      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] p-4 my-6">
        <p className="text-sm text-[var(--text-secondary)] m-0">
          <strong>Tip:</strong> Use the Question Queue view as your daily "what
          needs me" check. Filter by repo or session if you're working across
          many projects.
        </p>
      </div>

      <h2>Answering a Question</h2>

      <p>
        Click an option (or type a free-text answer) and submit. Praxis records
        your response, marks the question as answered, and the paused session
        immediately resumes with your input baked in. You don't need to
        manually nudge the session — it picks up where it left off.
      </p>

      <h2>Why Questions Matter</h2>

      <p>
        The alternative to a question is the AI guessing. Guessing is fast but
        often wrong, and the cost of a wrong guess is rework — sometimes a lot
        of it. The Question Queue is the trade-off: a small interruption now
        for a much higher chance the work is what you actually wanted.
      </p>

      <p>
        If you find a session asking too many trivial questions, that's
        usually a signal that the original idea description was too thin — try
        adding more context up front and the AI will need to ask less.
      </p>
    </article>
  );
}
