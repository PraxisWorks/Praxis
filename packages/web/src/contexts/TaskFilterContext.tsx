import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
import type { TaskStatus } from "@praxis2/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const TASK_STATUSES: ReadonlySet<string> = new Set<TaskStatus>([
  "draft",
  "approved",
  "in_progress",
  "blocked",
  "complete",
  "archived",
]);

export type TaskTypeFilter = "all" | "epics" | "tasks";

export type TaskFilters = {
  status: TaskStatus | undefined;
  type: TaskTypeFilter;
  epicId: string | undefined;
  ideaId: string | undefined;
};

type TaskFilterContextValue = TaskFilters & {
  setStatus: (status: TaskStatus | undefined) => void;
  setType: (type: TaskTypeFilter) => void;
  setEpicId: (epicId: string | undefined) => void;
  setIdeaId: (ideaId: string | undefined) => void;
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const TaskFilterContext = createContext<TaskFilterContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function TaskFilterProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();

  // --- read current values from URL params ---
  const rawStatus = searchParams.get("status");
  const status: TaskStatus | undefined =
    rawStatus && TASK_STATUSES.has(rawStatus)
      ? (rawStatus as TaskStatus)
      : undefined;

  const rawType = searchParams.get("type");
  const type: TaskTypeFilter =
    rawType === "epics" || rawType === "tasks" ? rawType : "all";

  const epicId = searchParams.get("epicId") ?? undefined;
  const ideaId = searchParams.get("ideaId") ?? undefined;

  // --- setters (preserve all existing params) ---

  const setStatus = useCallback(
    (next: TaskStatus | undefined) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next) {
            p.set("status", next);
          } else {
            p.delete("status");
          }
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setType = useCallback(
    (next: TaskTypeFilter) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next && next !== "all") {
            p.set("type", next);
          } else {
            p.delete("type");
          }
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setEpicId = useCallback(
    (next: string | undefined) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next) {
            p.set("epicId", next);
          } else {
            p.delete("epicId");
          }
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setIdeaId = useCallback(
    (next: string | undefined) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next) {
            p.set("ideaId", next);
          } else {
            p.delete("ideaId");
          }
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const value = useMemo<TaskFilterContextValue>(
    () => ({ status, type, epicId, ideaId, setStatus, setType, setEpicId, setIdeaId }),
    [status, type, epicId, ideaId, setStatus, setType, setEpicId, setIdeaId],
  );

  return (
    <TaskFilterContext.Provider value={value}>
      {children}
    </TaskFilterContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTaskFilters(): TaskFilterContextValue {
  const ctx = useContext(TaskFilterContext);
  if (!ctx) {
    throw new Error("useTaskFilters must be used within a TaskFilterProvider");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Pure filter helper
// ---------------------------------------------------------------------------

/** Minimal shape required by applyTaskFilters so it works with any task-like object. */
interface FilterableTask {
  id: string;
  status: string;
  isEpic: boolean;
  parentId?: string | null;
  ideaId?: string | null;
}

export function applyTaskFilters<T extends FilterableTask>(
  tasks: T[],
  filters: TaskFilters,
): T[] {
  return tasks.filter((task) => {
    if (filters.status && task.status !== filters.status) return false;
    if (filters.type === "epics" && !task.isEpic) return false;
    if (filters.type === "tasks" && task.isEpic) return false;
    if (
      filters.epicId &&
      task.parentId !== filters.epicId &&
      task.id !== filters.epicId
    )
      return false;
    if (filters.ideaId && task.ideaId !== filters.ideaId) return false;
    return true;
  });
}
