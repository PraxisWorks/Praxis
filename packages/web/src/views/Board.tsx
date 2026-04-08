import { useState, useMemo } from "react";
import { useTasks, usePermissions, useSessions } from "@praxis2/hooks";
import { BoardColumn } from "../components/BoardColumn.js";
import { TaskEditorModal } from "../components/TaskEditorModal.js";
import { TaskCreatorModal } from "../components/TaskCreatorModal.js";
import { FilterBar } from "../components/FilterBar.js";
import { useTaskFilters, applyTaskFilters } from "../contexts/TaskFilterContext.js";
import { useSessionsPanel } from "../contexts/SessionsPanelContext.js";
import { useToast } from "../contexts/ToastContext.js";

const STATUSES = [
  { key: "draft", label: "Draft" },
  { key: "approved", label: "Approved" },
  { key: "in_progress", label: "In Progress" },
  { key: "blocked", label: "Blocked" },
  { key: "complete", label: "Complete" },
  { key: "archived", label: "Archived" },
] as const;

type BoardProps = {
  repoId: string | null;
};

export function Board({ repoId }: BoardProps) {
  const { tasks, isLoading, error } = useTasks(repoId);
  const filters = useTaskFilters();
  const filteredTasks = useMemo(
    () => applyTaskFilters(tasks, filters),
    [tasks, filters.status, filters.type, filters.epicId, filters.ideaId],
  );
  const { hasPermission } = usePermissions();
  const { startWork } = useSessions();
  const { openSession: openSessionPanel } = useSessionsPanel();
  const { addToast } = useToast();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showCreator, setShowCreator] = useState(false);
  const [creatorIsEpic, setCreatorIsEpic] = useState(false);

  // Build epicId -> title map (from ALL tasks, not filtered)
  const epics = new Map<string, { title: string; taskId: string | null }>();
  for (const task of tasks) {
    if (task.isEpic) {
      epics.set(task.id, { title: task.title, taskId: task.taskId });
    }
  }

  // Build repoId -> repoColor map for all-repos mode
  const repoColors = repoId === null
    ? new Map(tasks.filter((b) => b.repoColor).map((b) => [b.repoId, b.repoColor!]))
    : undefined;

  // Build repoId -> repoIcon map for all-repos mode
  const repoIcons = repoId === null
    ? new Map(tasks.filter((b) => b.repoIcon).map((b) => [b.repoId, b.repoIcon!]))
    : undefined;

  // Group filtered tasks by status
  const byStatus = new Map<string, typeof tasks>();
  for (const status of STATUSES) {
    byStatus.set(status.key, []);
  }
  for (const task of filteredTasks) {
    const group = byStatus.get(task.status);
    if (group) {
      group.push(task);
    } else {
      // Unknown status -- put in draft
      byStatus.get("draft")!.push(task);
    }
  }

  if (error) {
    return (
      <div className="bg-red-50 text-red-600 p-3 rounded m-4">{error}</div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)]">
        <h1 className="text-lg font-bold">Board</h1>
        <div className="flex gap-2">
          <button
            className="px-3 py-1.5 text-xs bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] cursor-pointer disabled:opacity-60"
            disabled={!repoId}
            onClick={() => {
              setCreatorIsEpic(true);
              setShowCreator(true);
            }}
          >
            + Epic
          </button>
          <button
            className="px-3 py-1.5 text-xs border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-secondary)] cursor-pointer disabled:opacity-60"
            disabled={!repoId}
            onClick={() => {
              setCreatorIsEpic(false);
              setShowCreator(true);
            }}
          >
            + Task
          </button>
        </div>
      </div>

      <FilterBar tasks={tasks} />

      {/* Board columns */}
      {isLoading ? (
        <p className="text-[var(--text-faint)] text-center p-8">Loading...</p>
      ) : tasks.length > 0 && filteredTasks.length === 0 ? (
        <p className="text-[var(--text-faint)] text-center p-8">
          No tasks match the current filters.
        </p>
      ) : (
        <div className="flex-1 overflow-x-auto p-4">
          <div className="flex gap-4 min-w-max">
            {STATUSES.map(({ key, label }) => (
              <BoardColumn
                key={key}
                title={label}
                status={key}
                tasks={byStatus.get(key) ?? []}
                epics={epics}
                repoColors={repoColors}
                repoIcons={repoIcons}
                onClickCard={(id) => setSelectedTaskId(id)}
                onStartWork={hasPermission("session:create:working") ? async (id) => {
                  const task = tasks.find((b) => b.id === id);
                  const effectiveRigId = repoId ?? task?.repoId;
                  if (!task || !effectiveRigId) return;
                  try {
                    const result = await startWork({
                      repoId: effectiveRigId,
                      entityType: task.isEpic ? "epic" : "task",
                      entityId: task.id,
                    });
                    if (result?.id) {
                      openSessionPanel(result.id);
                    }
                  } catch (err) {
                    addToast({
                      title: "Session failed",
                      body: err instanceof Error ? err.message : "Something went wrong",
                      variant: "error",
                    });
                  }
                } : undefined}
              />
            ))}
          </div>
        </div>
      )}

      {/* Task editor modal */}
      {selectedTaskId && (
        <TaskEditorModal
          taskId={selectedTaskId}
          repoId={repoId}
          onClose={() => setSelectedTaskId(null)}
        />
      )}

      {/* Task creator modal */}
      {showCreator && repoId && (
        <TaskCreatorModal
          repoId={repoId}
          isEpic={creatorIsEpic}
          onClose={() => setShowCreator(false)}
        />
      )}
    </div>
  );
}
