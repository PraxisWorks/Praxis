import { memo, useState } from "react";
import { copyToClipboard } from "../../lib/clipboard.js";

type EpicGroupNodeData = {
  label: string;
  taskId: string | null;
  isTopLevel: boolean;
  onClickNode: (id: string) => void;
};

export const EpicGroupNode = memo(function EpicGroupNode({
  id,
  data,
}: {
  id: string;
  data: EpicGroupNodeData;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div
      className={`w-full h-full rounded-xl bg-[var(--accent-light)]/40 cursor-pointer transition-colors ${
        data.isTopLevel
          ? "border-2 border-[var(--accent)] hover:border-[var(--accent-hover)]"
          : "border-2 border-dashed border-[var(--accent)] hover:border-[var(--accent-hover)]"
      }`}
      onClick={() => data.onClickNode(id)}
    >
      <div className="px-3 py-2">
        <span className="text-sm font-bold text-[var(--accent-emphasis)]">{data.label}</span>
        {data.taskId && (
          <span
            className={`ml-2 text-xs font-mono cursor-pointer ${copied ? "text-[var(--accent)]" : "text-[var(--text-faint)]"}`}
            onClick={(e) => {
              e.stopPropagation();
              copyToClipboard(data.taskId!);
              setCopied(true);
              setTimeout(() => setCopied(false), 1000);
            }}
          >
            {data.taskId}
          </span>
        )}
      </div>
    </div>
  );
});
