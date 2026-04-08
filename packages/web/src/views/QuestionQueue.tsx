import { useState } from "react";
import { useQuestionQueue } from "@praxis2/hooks";
import { StructuredQuestion } from "../components/sessions/StructuredQuestion.js";
import { timeAgo } from "../lib/timeAgo.js";

export function QuestionQueue() {
  const [repoFilter, setRepoFilter] = useState<string>("");
  const [sessionFilter, setSessionFilter] = useState<string>("");

  const filters: Record<string, unknown> = {};
  if (repoFilter) filters.repoId = repoFilter;
  if (sessionFilter) filters.sessionId = sessionFilter;

  const { questions, openCount, isLoading, answerQuestion, isAnswering } =
    useQuestionQueue(filters as any);

  // Extract unique repos and sessions for filter dropdowns
  const repos = Array.from(
    new Map(
      questions.map((q: any) => [
        q.repoId,
        { id: q.repoId, name: q.repoName, color: q.repoColor },
      ]),
    ).values(),
  );
  const sessionsList = Array.from(
    new Map(
      questions.map((q: any) => [
        q.sessionId,
        { id: q.sessionId, title: q.sessionTitle },
      ]),
    ).values(),
  );

  if (isLoading) {
    return (
      <div className="max-w-[800px] mx-auto px-4 py-8">
        <div className="flex items-center gap-2 text-[var(--text-faint)]">
          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Loading questions...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[800px] mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">
            Question Queue
          </h1>
          <p className="text-sm text-[var(--text-faint)] mt-1">
            {openCount} open {openCount === 1 ? "question" : "questions"} across
            sessions
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex gap-3 mb-6">
        <select
          value={repoFilter}
          onChange={(e) => setRepoFilter(e.target.value)}
          className="text-sm rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] text-[var(--text-primary)] px-3 py-1.5"
        >
          <option value="">All repos</option>
          {repos.map((r: any) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>

        <select
          value={sessionFilter}
          onChange={(e) => setSessionFilter(e.target.value)}
          className="text-sm rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] text-[var(--text-primary)] px-3 py-1.5"
        >
          <option value="">All sessions</option>
          {sessionsList.map((s: any) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </div>

      {/* Empty state */}
      {questions.length === 0 && (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">&#x2713;</div>
          <p className="text-lg font-medium text-[var(--text-primary)]">
            All caught up!
          </p>
          <p className="text-sm text-[var(--text-faint)] mt-1">
            No open questions right now.
          </p>
        </div>
      )}

      {/* Question list */}
      <div className="space-y-4">
        {questions.map((q: any) => {
          const metadata = q.metadata as any;
          const questionsData = metadata?.questions ?? [];

          return (
            <div
              key={q.messageId}
              className="rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-primary)] p-4"
            >
              {/* Context bar: repo + session + time */}
              <div className="flex items-center gap-2 mb-3 text-xs text-[var(--text-faint)]">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: q.repoColor ?? "#6b7280" }}
                />
                <span className="font-medium text-[var(--text-secondary)]">
                  {q.repoName}
                </span>
                <span className="text-[var(--border-secondary)]">&middot;</span>
                <span className="truncate">{q.sessionTitle}</span>
                <span className="text-[var(--border-secondary)]">&middot;</span>
                <span>{timeAgo(q.createdAt)}</span>
              </div>

              {/* Structured question component */}
              <StructuredQuestion
                messageId={q.messageId}
                questions={questionsData}
                isAnswered={false}
                onAnswer={(messageId, formattedResponse, selectedOptions) => {
                  answerQuestion(
                    q.sessionId,
                    messageId,
                    formattedResponse,
                    selectedOptions,
                  );
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
