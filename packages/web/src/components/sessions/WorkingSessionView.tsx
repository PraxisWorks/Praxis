import { StatusBadge } from "./StatusBadge.js";
import { SystemMessage } from "./SystemMessage.js";
import { TaskUpdateItem } from "./TaskUpdateItem.js";
import { MarkdownContent } from "./MarkdownContent.js";

type Message = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
};

type WorkingSessionViewProps = {
  sessionId: string;
  repoColor: string;
  title: string;
  status: string;
  messages: Message[];
  onStop?: () => void;
  onResume?: () => void;
};

const HEALTH_INDICATORS: Record<string, { label: string; dotClass: string }> = {
  active: { label: "Active", dotClass: "bg-green-500" },
  paused: { label: "Paused", dotClass: "bg-yellow-500" },
};

function renderMessage(msg: Message) {
  if (msg.role === "system") {
    if (msg.content.includes("status changed")) {
      return (
        <TaskUpdateItem
          key={msg.id}
          content={msg.content}
          createdAt={msg.createdAt}
        />
      );
    }
    return (
      <SystemMessage
        key={msg.id}
        content={msg.content}
        createdAt={msg.createdAt}
      />
    );
  }

  if (msg.role === "user") {
    return (
      <div
        key={msg.id}
        className="text-xs bg-[var(--accent-light)] text-[var(--accent-emphasis)] rounded p-2 ml-4"
      >
        <p className="whitespace-pre-wrap">{msg.content}</p>
      </div>
    );
  }

  return (
    <div
      key={msg.id}
      className="text-xs bg-[var(--bg-secondary)] text-[var(--text-primary)] rounded p-2 mr-4"
    >
      <MarkdownContent content={msg.content} />
    </div>
  );
}

export function WorkingSessionView({
  repoColor,
  title,
  status,
  messages,
  onStop,
  onResume,
}: WorkingSessionViewProps) {
  const health = HEALTH_INDICATORS[status];

  return (
    <div className="flex flex-col border border-[var(--border-primary)] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border-primary)] flex items-center gap-2">
        <span
          className="w-3 h-3 rounded-full shrink-0"
          style={{ backgroundColor: repoColor }}
        />
        <h3 className="text-sm font-semibold flex-1 truncate">{title}</h3>
        <StatusBadge status={status} />
      </div>

      {/* Health indicator */}
      <div className="px-4 py-1.5 border-b border-[var(--border-primary)] flex items-center gap-1.5">
        <span
          className={`w-1.5 h-1.5 rounded-full ${health?.dotClass ?? "bg-gray-400"}`}
        />
        <span className="text-[10px] text-[var(--text-muted)]">
          {health?.label ?? "Stopped"}
        </span>
      </div>

      {/* Message feed */}
      <div className="max-h-96 overflow-y-auto px-4 py-2 space-y-1.5">
        {messages.length === 0 ? (
          <p className="text-[var(--text-faint)] text-xs text-center py-4">
            No activity yet.
          </p>
        ) : (
          messages.map(renderMessage)
        )}
      </div>

      {/* Action buttons */}
      {(status === "active" || status === "paused") && (
        <div className="px-4 py-2 border-t border-[var(--border-primary)] flex gap-2">
          {status === "active" && onStop && (
            <button
              onClick={onStop}
              className="px-3 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100 cursor-pointer transition-colors"
            >
              Stop Session
            </button>
          )}
          {status === "paused" && onResume && (
            <button
              onClick={onResume}
              className="px-3 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100 cursor-pointer transition-colors"
            >
              Resume Session
            </button>
          )}
        </div>
      )}
    </div>
  );
}
