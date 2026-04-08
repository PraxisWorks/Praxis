import type { ReactNode } from "react";
import { RepoIcon } from "./RepoIcon";
import { SessionTypeIcon } from "./SessionTypeIcon";

import { timeAgo } from "../lib/timeAgo";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  scheduled: "bg-blue-100 text-blue-800",
  paused: "bg-yellow-100 text-yellow-800",
  completed: "bg-gray-100 text-gray-600",
  error: "bg-red-100 text-red-800",
};

function entityContextLabel(
  type: string,
  repoName: string | null,
): string | null {
  if (!repoName) return null;
  switch (type) {
    case "spec":
      return `Spec for ${repoName}`;
    case "architecture":
      return `Planning in ${repoName}`;
    case "working":
      return `Working in ${repoName}`;
    case "debug":
      return `Debugging in ${repoName}`;
    default:
      return repoName;
  }
}

interface SessionEntryProps {
  session: {
    id: string;
    type: string;
    status: string;
    title: string;
    repoColor: string | null;
    repoIcon: string | null;
    repoName: string | null;
    lastMessageAt: string | Date;
    metadata?: Record<string, unknown> | null;
    workerName?: string | null;
    workerStatus?: string | null;
    scheduledFor?: string | null;
    lastMessageContent?: string | null;
    lastMessageRole?: string | null;
    taskTotal?: number | null;
    taskCompleted?: number | null;
    taskInProgress?: number | null;
    phaseCompleted?: number | null;
    latestPhaseName?: string | null;
  };
  isUnread: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onMarkViewed: () => void;
  onRetry?: (sessionId: string) => void;
  onCancelScheduled?: (sessionId: string) => void;
  children?: ReactNode;
}

export function SessionEntry({
  session,
  isUnread,
  isExpanded,
  onToggle,
  onMarkViewed,
  onRetry,
  onCancelScheduled,
  children,
}: SessionEntryProps) {
  const contextLabel = entityContextLabel(session.type, session.repoName);
  const timestamp =
    typeof session.lastMessageAt === "string"
      ? session.lastMessageAt
      : session.lastMessageAt.toISOString();

  const handleToggle = () => {
    if (!isExpanded && isUnread) {
      onMarkViewed();
    }
    onToggle();
  };

  return (
    <div
      className="border-b border-[var(--border-primary)]"
      style={{
        borderLeft: session.repoColor
          ? `3px solid ${session.repoColor}`
          : undefined,
      }}
    >
      <button
        onClick={handleToggle}
        className="w-full text-left px-4 py-3 hover:bg-[var(--bg-secondary)] transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          {/* Unread indicator */}
          {isUnread && (
            <span
              className="w-2 h-2 rounded-full bg-blue-500 shrink-0"
              aria-label="Unread"
            />
          )}

          {/* Repo icon (always shown when available) */}
          {session.repoIcon && (
            <RepoIcon name={session.repoIcon} color={session.repoColor ?? undefined} size={14} className="shrink-0" />
          )}

          {/* Type icon */}
          <SessionTypeIcon type={session.type} className="text-sm shrink-0" />

          {/* Title */}
          <span className="text-sm font-medium flex-1 truncate">
            {session.title}
          </span>

          {/* Worker badge */}
          {session.workerName && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 bg-blue-50 text-blue-700 flex items-center gap-1">
              {session.status === "active" && session.workerStatus === "online" && (
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              )}
              {session.workerName}
            </span>
          )}

          {/* Status badge */}
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
              STATUS_COLORS[session.status] ?? "bg-gray-100 text-gray-600"
            }`}
          >
            {session.status}
          </span>
        </div>

        {/* Context label and timestamp */}
        <div className="flex items-center justify-between mt-1 gap-2">
          {contextLabel && (
            <span className="text-[var(--text-faint)] text-xs truncate">
              {contextLabel}
            </span>
          )}
          <span className="text-[var(--text-faint)] text-xs shrink-0 ml-auto">
            {timeAgo(timestamp)}
          </span>
        </div>

        {/* Task progress (for working sessions) */}
        {session.taskTotal != null && session.taskTotal > 0 && (() => {
          const completed = session.taskCompleted ?? 0;
          const inProgress = session.taskInProgress ?? 0;
          const pct = Math.round((completed / session.taskTotal) * 100);
          const inProgressPct = Math.round((inProgress / session.taskTotal) * 100);
          return (
            <div className="mt-1">
              <div className="flex items-center justify-between text-[10px] text-[var(--text-faint)] mb-0.5">
                <span>{completed}/{session.taskTotal} tasks ({pct}%)</span>
                {inProgress > 0 && (
                  <span className="text-amber-600">{inProgress} in progress</span>
                )}
              </div>
              <div className="w-full h-1 bg-[var(--bg-tertiary)] rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-[var(--accent)] transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
                <div
                  className="h-full bg-amber-400 transition-all duration-300"
                  style={{ width: `${inProgressPct}%` }}
                />
              </div>
            </div>
          );
        })()}
        {/* Phase progress (for architecture sessions) */}
        {session.phaseCompleted != null && session.phaseCompleted > 0 && (() => {
          const pct = Math.round((session.phaseCompleted / 8) * 100);
          return (
            <div className="mt-1">
              <div className="flex items-center justify-between text-[10px] text-[var(--text-faint)] mb-0.5">
                <span>Phase {session.phaseCompleted}/8: {session.latestPhaseName}</span>
                <span>{pct}%</span>
              </div>
              <div className="w-full h-1 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--accent-arch)] transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })()}
        {/* Current activity indicator */}
        {session.status === "active" && typeof session.metadata?.currentActivity === "string" && (
          <div className="flex items-center gap-1.5 mt-1">
            <span className="inline-flex gap-0.5">
              <span className="w-1 h-1 bg-green-500 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-1 h-1 bg-green-500 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-1 h-1 bg-green-500 rounded-full animate-bounce [animation-delay:300ms]" />
            </span>
            <span className="text-green-600 text-[10px]">
              {session.metadata.currentActivity}
            </span>
          </div>
        )}

        {/* Waiting for user input indicator */}
        {session.status === "active" && session.metadata?.needsInput === true && !session.metadata?.currentActivity && (
          <div className="flex items-center gap-1.5 mt-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
            <span className="text-amber-600 text-[10px]">Waiting for you</span>
          </div>
        )}

        {/* Last message preview (shown when no current activity) */}
        {session.lastMessageContent && !(session.status === "active" && typeof session.metadata?.currentActivity === "string") && (
          <span className="text-[var(--text-faint)] text-xs truncate block mt-0.5">
            {session.lastMessageRole === 'assistant' ? 'AI: ' : 'System: '}
            {session.lastMessageContent}
          </span>
        )}

        {/* Scheduled time indicator */}
        {session.status === "scheduled" && session.scheduledFor && (
          <div className="flex items-center gap-1.5 mt-1">
            <svg className="w-3 h-3 text-[var(--text-faint)] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-[var(--text-faint)] text-xs">
              Scheduled for {new Date(session.scheduledFor).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </span>
          </div>
        )}
      </button>

      {/* Cancel scheduled button */}
      {session.status === "scheduled" && onCancelScheduled && (
        <div className="px-4 pb-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCancelScheduled(session.id);
            }}
            className="text-[10px] px-1.5 py-0.5 text-red-500 hover:text-red-700 cursor-pointer"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Worker disconnect / paused banner */}
      {session.status === "paused" && session.metadata?.reason === "worker_disconnected" && (
        <div className="mx-4 mb-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm">
          <p className="text-yellow-700 font-medium">Worker went offline</p>
          <p className="text-yellow-600 text-xs mt-1">
            Session will auto-resume when worker reconnects
          </p>
        </div>
      )}

      {/* Error banner */}
      {session.status === "error" && (
        <div className="mx-4 mb-2 p-2 bg-red-50 border border-red-200 rounded text-sm">
          <p className="text-red-700 font-medium">Session failed</p>
          {session.metadata?.error != null && (
            <p className="text-red-600 text-xs mt-1">
              {String(session.metadata.error)}
            </p>
          )}
          {onRetry && (
            <button
              onClick={() => onRetry(session.id)}
              className="mt-2 px-3 py-1 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700 cursor-pointer"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Smooth expand/collapse animation via CSS grid */}
      <div
        style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}
        className="grid transition-[grid-template-rows] duration-300"
      >
        <div className="overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
