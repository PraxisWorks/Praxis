import { timeAgo } from "../../lib/timeAgo.js";

type SystemMessageProps = {
  content: string;
  createdAt: string;
};

export function SystemMessage({ content, createdAt }: SystemMessageProps) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <p className="text-xs text-[var(--accent)]">{content}</p>
      <span className="text-[10px] text-[var(--text-faint)] shrink-0">
        {timeAgo(createdAt)}
      </span>
    </div>
  );
}
