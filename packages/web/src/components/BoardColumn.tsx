import { useState } from "react";
import { COLUMN_HEADER_COLORS } from "../lib/taskConstants.js";
import { copyToClipboard } from "../lib/clipboard.js";
import { TaskCard } from "./TaskCard.js";

type SerializedTask = {
  id: string;
  repoId: string;
  parentId: string | null;
  ideaId: string | null;
  title: string;
  description: string;
  notes: string | null;
  status: string;
  priority: string;
  isEpic: boolean;
  taskId: string | null;
  statusChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type BoardColumnProps = {
  title: string;
  status: string;
  tasks: SerializedTask[];
  epics: Map<string, { title: string; taskId: string | null }>;
  repoColors?: Map<string, string>;
  repoIcons?: Map<string, string>;
  onClickCard: (id: string) => void;
  onStartWork?: (id: string) => void;
  onStartDebug?: (id: string) => void;
};

export function BoardColumn({
  title,
  status,
  tasks,
  epics,
  repoColors,
  repoIcons,
  onClickCard,
  onStartWork,
  onStartDebug,
}: BoardColumnProps) {
  const [copiedEpicId, setCopiedEpicId] = useState<string | null>(null);
  const headerClass =
    COLUMN_HEADER_COLORS[status] ?? "bg-gray-50 text-gray-700";

  // Group tasks by parent epic; orphans have no parentId
  const epicGroups = new Map<string, SerializedTask[]>();
  const orphans: SerializedTask[] = [];

  for (const task of tasks) {
    if (task.parentId && epics.has(task.parentId)) {
      const group = epicGroups.get(task.parentId);
      if (group) {
        group.push(task);
      } else {
        epicGroups.set(task.parentId, [task]);
      }
    } else {
      orphans.push(task);
    }
  }

  return (
    <div className="flex flex-col min-w-[240px] max-w-[280px] shrink-0">
      <div
        className={`px-3 py-2 rounded-t-lg font-semibold text-sm ${headerClass}`}
      >
        {title}{" "}
        <span className="font-normal text-xs opacity-70">({tasks.length})</span>
      </div>

      <div className="flex-1 bg-[var(--bg-secondary)]/50 border border-t-0 border-[var(--border-primary)] rounded-b-lg p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-200px)]">
        {/* Epic groups */}
        {Array.from(epicGroups.entries()).map(([epicId, groupTasks]) => (
          <details key={epicId} open>
            <summary className="text-xs font-medium text-[var(--text-muted)] cursor-pointer mb-1 select-none">
              {epics.get(epicId)?.title ?? "Epic"}
              {epics.get(epicId)?.taskId && (
                <span
                  className={`ml-2 font-mono ${copiedEpicId === epicId ? "text-[var(--accent)]" : "text-[var(--text-faint)]"}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    copyToClipboard(epics.get(epicId)!.taskId!);
                    setCopiedEpicId(epicId);
                    setTimeout(() => setCopiedEpicId(null), 1000);
                  }}
                >
                  {epics.get(epicId)!.taskId}
                </span>
              )}
            </summary>
            <div className="space-y-1.5 ml-1">
              {groupTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  epicName={epics.get(task.parentId!)?.title ?? undefined}
                  repoColor={repoColors?.get(task.repoId)}
                  repoIcon={repoIcons?.get(task.repoId)}
                  onClickCard={onClickCard}
                  onStartWork={onStartWork}
                  onStartDebug={onStartDebug}
                />
              ))}
            </div>
          </details>
        ))}

        {/* Orphan tasks */}
        {orphans.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            repoColor={repoColors?.get(task.repoId)}
            repoIcon={repoIcons?.get(task.repoId)}
            onClickCard={onClickCard}
            onStartWork={onStartWork}
            onStartDebug={onStartDebug}
          />
        ))}

        {tasks.length === 0 && (
          <p className="text-xs text-[var(--text-faint)] text-center py-4">No tasks</p>
        )}
      </div>
    </div>
  );
}
