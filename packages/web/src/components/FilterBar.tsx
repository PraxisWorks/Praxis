import { useMemo } from "react";
import type { TaskStatus } from "@praxis2/shared";
import {
  useTaskFilters,
  type TaskTypeFilter,
} from "../contexts/TaskFilterContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FilterBarProps = {
  tasks: Array<{
    id: string;
    title: string;
    isEpic: boolean;
    ideaId?: string | null;
  }>;
  ideas?: Array<{ id: string; title: string }>;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_OPTIONS: Array<{ value: TaskStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "approved", label: "Approved" },
  { value: "in_progress", label: "In Progress" },
  { value: "blocked", label: "Blocked" },
  { value: "complete", label: "Complete" },
  { value: "archived", label: "Archived" },
];

const TYPE_OPTIONS: Array<{ value: TaskTypeFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "epics", label: "Epics" },
  { value: "tasks", label: "Tasks" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function chipClassName(isActive: boolean): string {
  return `px-3 py-1 rounded-full text-xs font-medium cursor-pointer border transition-colors ${
    isActive
      ? "bg-[var(--accent)] text-white border-[var(--accent)]"
      : "bg-[var(--bg-primary)] text-[var(--text-secondary)] border-[var(--border-secondary)] hover:border-[var(--border-secondary)]"
  }`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FilterBar({ tasks, ideas }: FilterBarProps) {
  const { status, type, epicId, ideaId, setStatus, setType, setEpicId, setIdeaId } =
    useTaskFilters();

  const sortedEpics = useMemo(
    () =>
      tasks
        .filter((b) => b.isEpic)
        .sort((a, b) => a.title.localeCompare(b.title)),
    [tasks],
  );

  return (
    <div className="flex items-center gap-4 px-4 py-2 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]/50 flex-wrap">
      {/* Section 1: Status Chips */}
      <div className="flex items-center gap-1.5">
        {STATUS_OPTIONS.map((opt) => {
          const isActive =
            opt.value === "all" ? status === undefined : status === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() =>
                setStatus(opt.value === "all" ? undefined : opt.value)
              }
              className={chipClassName(isActive)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <div className="w-px h-5 bg-[var(--border-primary)]" />

      {/* Section 2: Type Chips */}
      <div className="flex items-center gap-1.5">
        {TYPE_OPTIONS.map((opt) => {
          const isActive = type === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setType(opt.value)}
              className={chipClassName(isActive)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <div className="w-px h-5 bg-[var(--border-primary)]" />

      {/* Section 3: Epic Dropdown */}
      <select
        value={epicId ?? ""}
        onChange={(e) => setEpicId(e.target.value || undefined)}
        className="text-xs border border-[var(--border-secondary)] rounded px-2 py-1 bg-[var(--bg-primary)] focus:outline-none focus:ring-1 focus:ring-indigo-500"
        aria-label="Filter by epic"
      >
        <option value="">All Epics</option>
        {sortedEpics.map((epic) => (
          <option key={epic.id} value={epic.id}>
            {epic.title}
          </option>
        ))}
      </select>

      {/* Section 4: Idea Dropdown (only when ideas are provided) */}
      {ideas && ideas.length > 0 && (
        <select
          value={ideaId ?? ""}
          onChange={(e) => setIdeaId(e.target.value || undefined)}
          className="text-xs border border-[var(--border-secondary)] rounded px-2 py-1 bg-[var(--bg-primary)] focus:outline-none focus:ring-1 focus:ring-indigo-500"
          aria-label="Filter by idea"
        >
          <option value="">All Ideas</option>
          {ideas.map((idea) => (
            <option key={idea.id} value={idea.id}>
              {idea.title}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
