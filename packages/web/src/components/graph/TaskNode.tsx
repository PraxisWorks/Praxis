import { memo, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { TaskActions } from "../TaskActions.js";
import { RepoIcon } from "../RepoIcon.js";
import { STATUS_COLORS } from "../../lib/taskConstants.js";
import { copyToClipboard } from "../../lib/clipboard.js";

type TaskNodeData = {
  label: string;
  status: string;
  priority: string;
  taskId: string | null;
  repoColor?: string;
  repoIcon?: string;
  onClickNode: (id: string) => void;
  onStartWork?: (id: string) => void;
  onStartDebug?: (id: string) => void;
};

export const TaskNode = memo(function TaskNode({
  id,
  data,
}: {
  id: string;
  data: TaskNodeData;
}) {
  const [copied, setCopied] = useState(false);
  const statusColor = STATUS_COLORS[data.status] ?? "#9CA3AF";

  return (
    <div
      className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-sm px-3 py-2 min-w-[160px] max-w-[220px] cursor-pointer hover:border-[var(--border-secondary)] transition-colors"
      style={
        data.repoColor
          ? { borderLeftColor: data.repoColor, borderLeftWidth: 3 }
          : undefined
      }
      onClick={() => data.onClickNode(id)}
    >
      <Handle type="target" position={Position.Top} className="!bg-[var(--text-faint)]" />

      <div className="flex items-center gap-1.5 mb-1">
        {data.repoIcon ? (
          <RepoIcon name={data.repoIcon} color={data.repoColor} size={12} className="shrink-0" />
        ) : (
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: statusColor }}
          />
        )}
        <span className="text-xs font-medium leading-tight line-clamp-2">
          {data.label}
        </span>
      </div>

      {data.taskId && (
        <p
          className={`text-[10px] font-mono cursor-pointer ${copied ? "text-[var(--accent)]" : "text-[var(--text-faint)]"}`}
          onClick={(e) => {
            e.stopPropagation();
            copyToClipboard(data.taskId!);
            setCopied(true);
            setTimeout(() => setCopied(false), 1000);
          }}
        >
          {data.taskId}
        </p>
      )}

      <TaskActions
        taskId={id}
        status={data.status}
        onStartWork={data.onStartWork}
        onStartDebug={data.onStartDebug}
        size="xs"
      />

      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-[var(--text-faint)]"
      />
    </div>
  );
});
