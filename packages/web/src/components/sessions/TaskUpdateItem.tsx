import { timeAgo } from "../../lib/timeAgo.js";
import { StatusBadge } from "./StatusBadge.js";
import { SystemMessage } from "./SystemMessage.js";

type TaskUpdateItemProps = {
  content: string;
  createdAt: string;
};

const TASK_STATUS_RE =
  /^Task\s+(\S+)\s+status changed:\s+(\S+)\s+->\s+(\S+)$/;

export function TaskUpdateItem({ content, createdAt }: TaskUpdateItemProps) {
  const match = TASK_STATUS_RE.exec(content);

  if (!match) {
    return <SystemMessage content={content} createdAt={createdAt} />;
  }

  const [, taskId, fromStatus, toStatus] = match;

  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-[10px] font-mono text-[var(--text-muted)] shrink-0">
        {taskId}
      </span>
      <StatusBadge status={fromStatus} size="xs" />
      <span className="text-[var(--text-faint)] text-xs">&rarr;</span>
      <StatusBadge status={toStatus} size="xs" />
      <span className="text-[10px] text-[var(--text-faint)] ml-auto shrink-0">
        {timeAgo(createdAt)}
      </span>
    </div>
  );
}
