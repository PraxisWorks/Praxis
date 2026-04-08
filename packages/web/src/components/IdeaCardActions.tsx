import { useState } from "react";
import { PhaseConfigPopover } from "./PhaseConfigPopover.js";
import { SchedulePicker } from "./SchedulePicker.js";
import type { PhaseConfig } from "../lib/phaseConfig.js";
import { useToast } from "../contexts/ToastContext.js";

type IdeaCardActionsProps = {
  idea: {
    id: string;
    repoId: string;
    status: string;
    planId: string | null;
    planStatus: string | null;
    topEpicId: string | null;
    completedTaskCount: number;
    totalTaskCount: number;
  };
  startAutoSession: (ideaId: string, scheduledFor?: string) => Promise<unknown>;
  startConfiguredSession: (ideaId: string, phaseConfig: PhaseConfig, scheduledFor?: string) => Promise<unknown>;
  acceptPlan: (planId: string) => Promise<unknown>;
  startWork: (params: {
    repoId: string;
    entityType: "epic";
    entityId: string;
  }) => Promise<unknown>;
  archiveIdea: (ideaId: string) => Promise<unknown>;
  startDebug: (params: { repoId: string; entityType: "epic"; entityId: string }) => Promise<unknown>;
  isStartingAutoSession: boolean;
  isAcceptingPlan: boolean;
  isStartingWork: boolean;
  isArchiving: boolean;
  isStartingDebug: boolean;
};

const spinnerStyle = `
@keyframes idea-card-spin {
  to { transform: rotate(360deg); }
}
`;

export function IdeaCardActions({
  idea,
  startAutoSession,
  startConfiguredSession,
  acceptPlan,
  startWork,
  archiveIdea,
  startDebug,
  isStartingAutoSession,
  isAcceptingPlan,
  isStartingWork,
  isArchiving,
  isStartingDebug,
}: IdeaCardActionsProps) {
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);
  const { addToast } = useToast();

  if (idea.status === "dismissed") {
    return null;
  }

  if (idea.status === "archived") {
    if (!idea.topEpicId) return null;
    return (
      <div onClick={(e) => e.stopPropagation()}>
        <button
          disabled={isStartingDebug}
          onClick={(e) => {
            e.stopPropagation();
            startDebug({
              repoId: idea.repoId,
              entityType: "epic",
              entityId: idea.topEpicId!,
            });
          }}
          className="px-3 py-1.5 rounded text-xs font-medium cursor-pointer bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isStartingDebug ? "Starting..." : "Debug"}
        </button>
      </div>
    );
  }

  // --- status: new ---
  if (idea.status === "new") {
    return (
      <div onClick={(e) => e.stopPropagation()} className="relative flex items-center gap-1">
        <button
          disabled={isStartingAutoSession}
          onClick={(e) => {
            e.stopPropagation();
            startAutoSession(idea.id);
          }}
          className="px-3 py-1.5 rounded text-xs font-medium cursor-pointer bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isStartingAutoSession ? "Starting..." : "Auto AI Session"}
        </button>
        <button
          disabled={isStartingAutoSession}
          onClick={(e) => {
            e.stopPropagation();
            setShowScheduler(!showScheduler);
            setShowConfig(false);
          }}
          title="Schedule session"
          className="p-1.5 rounded text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
          </svg>
        </button>
        <button
          disabled={isStartingAutoSession}
          onClick={(e) => {
            e.stopPropagation();
            setShowConfig(!showConfig);
            setShowScheduler(false);
          }}
          title="Configure AI session phases"
          className="p-1.5 rounded text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
          </svg>
        </button>
        {showScheduler && (
          <SchedulePicker
            onSchedule={(scheduledFor) => {
              setShowScheduler(false);
              if (scheduledFor) {
                startAutoSession(idea.id, scheduledFor);
                addToast({ title: "Session scheduled", body: "Your session has been scheduled.", variant: "info" });
              } else {
                startAutoSession(idea.id);
              }
            }}
            onClose={() => setShowScheduler(false)}
            isStarting={isStartingAutoSession}
          />
        )}
        {showConfig && (
          <PhaseConfigPopover
            onStart={(phaseConfig) => {
              setShowConfig(false);
              startConfiguredSession(idea.id, phaseConfig);
            }}
            onClose={() => setShowConfig(false)}
            isStarting={isStartingAutoSession}
          />
        )}
      </div>
    );
  }

  // --- status: planning ---
  if (idea.status === "planning") {
    if (idea.planStatus === "draft") {
      return (
        <div onClick={(e) => e.stopPropagation()}>
          <button
            disabled={isAcceptingPlan}
            onClick={(e) => {
              e.stopPropagation();
              if (idea.planId) acceptPlan(idea.planId);
            }}
            className="px-3 py-1.5 rounded text-xs font-medium cursor-pointer bg-green-500 text-white hover:bg-green-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isAcceptingPlan ? "Approving..." : "Approve Plan"}
          </button>
        </div>
      );
    }

    // No draft plan -- show spinner indicator
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-1.5"
      >
        <style>{spinnerStyle}</style>
        <span
          style={{
            display: "inline-block",
            width: 12,
            height: 12,
            border: "2px solid var(--bg-tertiary)",
            borderTopColor: "var(--accent)",
            borderRadius: "50%",
            animation: "idea-card-spin 0.6s linear infinite",
          }}
        />
        <span className="text-xs text-[var(--text-muted)]">
          AI Planning...
        </span>
      </div>
    );
  }

  // --- status: planned ---
  if (idea.status === "planned") {
    return (
      <div onClick={(e) => e.stopPropagation()}>
        <button
          disabled={isStartingWork}
          onClick={(e) => {
            e.stopPropagation();
            if (idea.topEpicId) {
              startWork({
                repoId: idea.repoId,
                entityType: "epic",
                entityId: idea.topEpicId,
              }).catch((err: unknown) => {
                addToast({
                  title: "Session failed",
                  body: err instanceof Error ? err.message : "Something went wrong",
                  variant: "error",
                });
              });
            }
          }}
          className="px-3 py-1.5 rounded text-xs font-medium cursor-pointer bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isStartingWork ? "Starting..." : "Begin Work"}
        </button>
      </div>
    );
  }

  // --- status: in_progress ---
  if (idea.status === "in_progress") {
    const total = idea.totalTaskCount || 0;
    const completed = idea.completedTaskCount || 0;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    return (
      <div onClick={(e) => e.stopPropagation()} className="w-full">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 11,
            color: "var(--text-muted)",
            marginBottom: 2,
          }}
        >
          <span>
            {completed}/{total} tasks
          </span>
          <span>{pct}%</span>
        </div>
        <div
          style={{
            height: 6,
            background: "var(--bg-tertiary)",
            borderRadius: 3,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              background: "var(--accent)",
              borderRadius: 3,
              transition: "width 0.3s",
            }}
          />
        </div>
      </div>
    );
  }

  // --- status: complete ---
  if (idea.status === "complete") {
    if (confirmArchive) {
      return (
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-2"
        >
          <button
            disabled={isArchiving}
            onClick={(e) => {
              e.stopPropagation();
              archiveIdea(idea.id);
            }}
            className="px-3 py-1.5 rounded text-xs font-medium cursor-pointer bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isArchiving ? "Archiving..." : "Confirm?"}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setConfirmArchive(false);
            }}
            className="px-3 py-1.5 rounded text-xs font-medium cursor-pointer bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-gray-300 transition-colors"
          >
            Cancel
          </button>
        </div>
      );
    }

    return (
      <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-2">
        {idea.topEpicId && (
          <button
            disabled={isStartingDebug}
            onClick={(e) => {
              e.stopPropagation();
              startDebug({
                repoId: idea.repoId,
                entityType: "epic",
                entityId: idea.topEpicId!,
              });
            }}
            className="px-3 py-1.5 rounded text-xs font-medium cursor-pointer bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isStartingDebug ? "Starting..." : "Debug"}
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setConfirmArchive(true);
          }}
          className="px-3 py-1.5 rounded text-xs font-medium cursor-pointer bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors"
        >
          Archive
        </button>
      </div>
    );
  }

  return null;
}
