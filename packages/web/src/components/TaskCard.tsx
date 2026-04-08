import { useState } from "react";
import { PRIORITY_COLORS } from "../lib/taskConstants.js";
import { copyToClipboard } from "../lib/clipboard.js";
import { TaskActions } from "./TaskActions.js";
import { RepoIcon } from "./RepoIcon.js";

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

type TaskCardProps = {
  task: SerializedTask;
  epicName?: string;
  repoColor?: string;
  repoIcon?: string | null;
  onClickCard: (id: string) => void;
  onStartWork?: (id: string) => void;
  onStartDebug?: (id: string) => void;
};

export function TaskCard({
  task,
  epicName,
  repoColor,
  repoIcon,
  onClickCard,
  onStartWork,
  onStartDebug,
}: TaskCardProps) {
  const [copied, setCopied] = useState(false);
  const priorityClass =
    PRIORITY_COLORS[task.priority] ?? "bg-gray-100 text-gray-600";

  return (
    <div
      className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-3 cursor-pointer hover:border-[var(--border-secondary)] transition-colors"
      style={repoColor ? { borderLeftColor: repoColor, borderLeftWidth: 3 } : undefined}
      onClick={() => onClickCard(task.id)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-1.5 flex-1 min-w-0">
          {repoIcon && (
            <RepoIcon name={repoIcon} color={repoColor} size={12} className="shrink-0 mt-0.5" />
          )}
          <h4 className="text-sm font-medium leading-tight line-clamp-2">
            {task.isEpic && (
              <span className="text-[var(--accent)] font-semibold mr-1">[Epic]</span>
            )}
            {task.title}
          </h4>
        </div>
        <span
          className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${priorityClass}`}
        >
          {task.priority}
        </span>
      </div>

      {epicName && (
        <p className="text-[11px] text-[var(--text-faint)] mt-1 truncate">{epicName}</p>
      )}

      {task.taskId && (
        <p
          className={`text-[10px] mt-0.5 font-mono cursor-pointer ${copied ? "text-[var(--accent)]" : "text-[var(--text-faint)]"}`}
          onClick={(e) => {
            e.stopPropagation();
            copyToClipboard(task.taskId!);
            setCopied(true);
            setTimeout(() => setCopied(false), 1000);
          }}
        >
          {task.taskId}
        </p>
      )}

      <TaskActions
        taskId={task.id}
        status={task.status}
        onStartWork={onStartWork}
        onStartDebug={onStartDebug}
        size="xs"
      />
    </div>
  );
}
