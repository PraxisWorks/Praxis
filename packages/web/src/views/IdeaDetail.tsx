import { useState, useMemo, useCallback, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { trpc, useIdea, usePlan, useAcceptPlan, useRejectPlan, useTasks, useSessions, usePermissions } from "@praxis2/hooks";
import { useIdeaAttachments, uploadIdeaFile, useIdeaPhases } from "@praxis2/hooks";
import { useAuth0 } from "@auth0/auth0-react";
import { useSessionsPanel } from "../contexts/SessionsPanelContext.js";
import { useToast } from "../contexts/ToastContext.js";
import { PlanTree } from "../components/PlanTree.js";
import { TaskNode } from "../components/graph/TaskNode.js";
import { EpicGroupNode } from "../components/graph/EpicGroupNode.js";
import { buildGraphData } from "../components/graph/buildGraphData.js";
import { useGraphLayout } from "../components/graph/useGraphLayout.js";
import { TaskEditorModal } from "../components/TaskEditorModal.js";
import { STATUS_COLORS } from "../lib/taskConstants.js";
import type { Proposal, IdeaSize } from "@praxis2/shared";
import { PHASES, MODE_LABELS, MODE_COLORS, PHASE_MODES } from "../lib/phaseConfig.js";
import type { PhaseMode, PhaseConfig } from "../lib/phaseConfig.js";

const nodeTypes = { task: TaskNode, group: EpicGroupNode };

const SIZE_COLORS: Record<string, string> = {
  xs: "bg-emerald-100 text-emerald-700",
  s: "bg-teal-100 text-teal-700",
  m: "bg-cyan-100 text-cyan-700",
  l: "bg-orange-100 text-orange-700",
  xl: "bg-rose-100 text-rose-700",
};

const SIZE_OPTIONS: { value: IdeaSize; label: string }[] = [
  { value: "xs", label: "XS" },
  { value: "s", label: "S" },
  { value: "m", label: "M" },
  { value: "l", label: "L" },
  { value: "xl", label: "XL" },
];

// -- Shared sub-components --------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    new: "bg-gray-100 text-gray-700",
    planning: "bg-blue-100 text-blue-700",
    planned: "bg-indigo-100 text-indigo-700",
    in_progress: "bg-yellow-100 text-yellow-700",
    complete: "bg-green-100 text-green-700",
    dismissed: "bg-red-100 text-red-700",
    archived: "bg-gray-100 text-gray-500",
  };

  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] ?? "bg-gray-100"}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function IdeaMetadata({
  idea,
  isEditing,
  onToggleEdit,
  editTitle,
  editDescription,
  onTitleChange,
  onDescriptionChange,
  editSize,
  onSizeChange,
}: {
  idea: { title: string; description: string; status: string; tags: string[]; size?: string | null; latestPhaseNumber?: number; latestPhaseName?: string | null };
  isEditing: boolean;
  onToggleEdit: () => void;
  editTitle: string;
  editDescription: string;
  onTitleChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  editSize: IdeaSize | null;
  onSizeChange: (v: IdeaSize | null) => void;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-2">
        {isEditing ? (
          <input
            type="text"
            value={editTitle}
            onChange={(e) => onTitleChange(e.target.value)}
            className="text-2xl font-bold border border-[var(--border-secondary)] rounded px-2 py-1 w-full focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        ) : (
          <h1 className="text-2xl font-bold">{idea.title}</h1>
        )}
        <StatusBadge status={idea.status} />
        {idea.size && (
          <span
            className={`px-2 py-0.5 rounded text-xs font-medium ${SIZE_COLORS[idea.size] ?? "bg-gray-100 text-gray-600"}`}
          >
            {idea.size.toUpperCase()}
          </span>
        )}
        {idea.status === "planning" && (idea.latestPhaseNumber ?? 0) > 0 && (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
            Phase {idea.latestPhaseNumber}/8: {idea.latestPhaseName}
          </span>
        )}
        {idea.status === "new" && !isEditing && (
          <button
            onClick={onToggleEdit}
            className="p-1.5 text-[var(--text-faint)] hover:text-[var(--text-secondary)] rounded hover:bg-[var(--bg-tertiary)] cursor-pointer"
            title="Edit idea"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
            </svg>
          </button>
        )}
      </div>
      {isEditing ? (
        <textarea
          value={editDescription}
          onChange={(e) => onDescriptionChange(e.target.value)}
          rows={4}
          className="w-full text-[var(--text-secondary)] border border-[var(--border-secondary)] rounded px-2 py-1 mb-3 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-vertical"
        />
      ) : (
        <p className="text-[var(--text-secondary)] mb-3">{idea.description}</p>
      )}
      {isEditing && idea.status === "new" && (
        <div className="mb-3">
          <label className="block text-xs text-[var(--text-muted)] mb-1">Size</label>
          <div className="flex gap-2">
            {SIZE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onSizeChange(editSize === opt.value ? null : opt.value)}
                className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer border transition-colors ${
                  editSize === opt.value
                    ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                    : "bg-[var(--bg-primary)] text-[var(--text-secondary)] border-[var(--border-secondary)] hover:border-[var(--border-secondary)]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {idea.tags.length > 0 && (
        <div className="flex gap-1.5">
          {idea.tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 bg-[var(--bg-tertiary)] text-[var(--text-secondary)] rounded text-xs"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentsSection({
  attachments,
  isLoading,
  isEditing,
  onDelete,
  isDeleting,
  onUpload,
  isUploading,
  canUpload,
}: {
  attachments: { id: string; filename: string; sizeBytes: number }[];
  isLoading: boolean;
  isEditing: boolean;
  onDelete: (id: string) => void;
  isDeleting: boolean;
  onUpload: (file: File) => void;
  isUploading: boolean;
  canUpload: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (isLoading) {
    return <p className="text-[var(--text-faint)] text-sm">Loading attachments...</p>;
  }

  if (!isEditing && attachments.length === 0) return null;

  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-2">Attachments</h3>
      {isEditing && canUpload && (
        <div className="mb-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                onUpload(file);
                e.target.value = "";
              }
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="px-3 py-1.5 text-xs text-[var(--accent)] border border-[var(--accent)] rounded hover:bg-[var(--accent-light)] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isUploading ? "Uploading..." : "Add File"}
          </button>
        </div>
      )}
      {attachments.length > 0 && (
        <ul className="space-y-1">
          {attachments.map((att) => (
            <li
              key={att.id}
              className="flex items-center justify-between py-1 px-2 rounded bg-[var(--bg-secondary)] text-sm"
            >
              <span className="text-[var(--text-secondary)] truncate mr-2">{att.filename}</span>
              <span className="flex items-center gap-2 shrink-0">
                <span className="text-[var(--text-faint)] text-xs">{formatFileSize(att.sizeBytes)}</span>
                {isEditing && (
                  <button
                    onClick={() => onDelete(att.id)}
                    disabled={isDeleting}
                    className="text-red-400 hover:text-red-600 cursor-pointer disabled:opacity-60"
                    title="Delete attachment"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PhasesSection({ ideaId }: { ideaId: string }) {
  const { phases, isLoading } = useIdeaPhases(ideaId);
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());

  if (isLoading) return null;
  if (phases.length === 0) return null;

  const togglePhase = (id: string) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-2">
        Architecture Phases
      </h3>
      <div className="space-y-1">
        {phases.map((phase) => {
          const isExpanded = expandedPhases.has(phase.id);
          return (
            <div
              key={phase.id}
              className="border border-[var(--border-primary)] rounded overflow-hidden"
            >
              <button
                onClick={() => togglePhase(phase.id)}
                className="w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-[var(--bg-secondary)] cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <span className="text-[var(--text-faint)] text-xs font-mono">
                    {phase.phaseNumber}
                  </span>
                  <span className="text-[var(--text-primary)] font-medium">
                    {phase.phaseName}
                  </span>
                </span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className={`h-4 w-4 text-[var(--text-faint)] transition-transform ${isExpanded ? "rotate-180" : ""}`}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              {isExpanded && (
                <div className="px-3 py-3 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]">
                  <pre className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap font-sans leading-relaxed">
                    {phase.content}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// -- State-specific panels --------------------------------------------------

function NoPlanState({
  onStart,
  isStarting,
}: {
  onStart: (phaseConfig?: PhaseConfig) => void;
  isStarting: boolean;
}) {
  const [showConfig, setShowConfig] = useState(false);
  const [modes, setModes] = useState<PhaseMode[]>(PHASES.map(() => "ai-assisted"));

  const setAll = (mode: PhaseMode) => setModes(PHASES.map(() => mode));
  const isAllDefault = modes.every((m) => m === "ai-assisted");

  const handleStart = () => {
    if (isAllDefault) {
      onStart();
    } else {
      onStart(PHASES.map((phase, i) => ({ phase, mode: modes[i] })));
    }
  };

  return (
    <div className="border border-dashed border-[var(--border-secondary)] rounded-lg p-6">
      <p className="text-[var(--text-muted)] mb-4 text-center">
        No architecture plan yet. Start an architecture session to break this
        idea into epics and tasks.
      </p>

      {!showConfig ? (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => handleStart()}
            disabled={isStarting}
            className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isStarting ? "Starting..." : "Start Architecture Session"}
          </button>
          <button
            onClick={() => setShowConfig(true)}
            disabled={isStarting}
            className="px-3 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-secondary)] rounded-lg hover:bg-[var(--bg-secondary)] cursor-pointer disabled:opacity-60"
          >
            Configure Phases
          </button>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-[var(--text-secondary)]">Phase Configuration</h3>
            <div className="flex gap-1.5">
              <button onClick={() => setAll("ai-assisted")} className="text-xs px-2 py-0.5 rounded border border-[var(--border-primary)] hover:bg-[var(--bg-secondary)] cursor-pointer">All Interactive</button>
              <button onClick={() => setAll("full-ai")} className="text-xs px-2 py-0.5 rounded border border-[var(--border-primary)] hover:bg-[var(--bg-secondary)] cursor-pointer">All AI</button>
            </div>
          </div>

          <div className="space-y-1.5 mb-4">
            {PHASES.map((phase, i) => (
              <div key={phase} className="flex items-center justify-between py-1 px-2 rounded hover:bg-[var(--bg-secondary)]">
                <span className="text-sm text-[var(--text-secondary)]">
                  <span className="text-[var(--text-faint)] mr-1.5">{i + 1}.</span>
                  {phase}
                </span>
                <div className="flex gap-1">
                  {PHASE_MODES.map((mode) => (
                    <button
                      key={mode}
                      onClick={() => {
                        const next = [...modes];
                        next[i] = mode;
                        setModes(next);
                      }}
                      className={`text-xs px-2 py-0.5 rounded border cursor-pointer transition-colors ${
                        modes[i] === mode
                          ? MODE_COLORS[mode]
                          : "border-transparent text-[var(--text-faint)] hover:text-[var(--text-secondary)]"
                      }`}
                    >
                      {MODE_LABELS[mode]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-center gap-3">
            <button
              onClick={handleStart}
              disabled={isStarting}
              className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isStarting ? "Starting..." : "Start Session"}
            </button>
            <button
              onClick={() => { setShowConfig(false); setAll("ai-assisted"); }}
              disabled={isStarting}
              className="px-3 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PlanningState() {
  return (
    <div className="text-center py-12 border border-dashed border-[var(--border-secondary)] rounded-lg">
      <div className="inline-block w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mb-4" />
      <p className="text-[var(--text-muted)]">
        Architecture session in progress. The AI is analyzing your idea and
        building a plan.
      </p>
    </div>
  );
}

function CompletedNoPlanState({
  onStart,
  isStarting,
  onViewSession,
}: {
  onStart: (phaseConfig?: PhaseConfig) => void;
  isStarting: boolean;
  onViewSession?: () => void;
}) {
  return (
    <div className="border border-dashed border-[var(--border-secondary)] rounded-lg p-6">
      <p className="text-[var(--text-muted)] mb-4 text-center">
        The previous session completed without creating a plan. You can start a
        new architecture session to try again.
      </p>
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={() => onStart()}
          disabled={isStarting}
          className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isStarting ? "Starting..." : "Start New Session"}
        </button>
        {onViewSession && (
          <button
            onClick={onViewSession}
            className="px-3 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-secondary)] rounded-lg hover:bg-[var(--bg-secondary)] cursor-pointer"
          >
            View Previous Session
          </button>
        )}
      </div>
    </div>
  );
}

function ErrorState({ onRetry, isRetrying }: { onRetry: () => void; isRetrying: boolean }) {
  return (
    <div className="text-center py-12 border border-dashed border-red-300 rounded-lg bg-red-50">
      <p className="text-red-600 mb-4">
        The architecture session encountered an error. You can retry to start a
        new session.
      </p>
      <button
        onClick={onRetry}
        disabled={isRetrying}
        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {isRetrying ? "Starting..." : "Retry Architecture Session"}
      </button>
    </div>
  );
}

function AcceptedPlanState({ repoId, ideaId, ideaStatus }: { repoId: string; ideaId: string; ideaStatus: string }) {
  const { tasks, isLoading } = useTasks(repoId, { ideaId });
  const depsQuery = trpc.task.listDependencies.useQuery({ repoId, ideaId });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const { startWork, isStartingWork, startDebug, isStartingDebug } = useSessions();
  const { openSession: openSessionPanel } = useSessionsPanel();
  const { addToast } = useToast();

  const topLevelEpic = useMemo(
    () => tasks.find((b) => b.isEpic && b.parentId === null) ?? null,
    [tasks],
  );

  const progress = useMemo(() => {
    const leafTasks = tasks.filter((b) => !b.isEpic);
    if (leafTasks.length === 0) return null;
    const completed = leafTasks.filter(
      (b) => b.status === "complete" || b.status === "archived",
    ).length;
    const inProgress = leafTasks.filter(
      (b) => b.status === "in_progress",
    ).length;
    const pct = Math.round((completed / leafTasks.length) * 100);
    const inProgressPct = Math.round((inProgress / leafTasks.length) * 100);
    return { completed, inProgress, total: leafTasks.length, pct, inProgressPct };
  }, [tasks]);

  const handleClickNode = useCallback((id: string) => setSelectedTaskId(id), []);

  const { rawNodes, rawEdges } = useMemo(() => {
    const { nodes, edges } = buildGraphData(
      tasks,
      depsQuery.data ?? [],
      { onClickNode: handleClickNode },
    );
    return { rawNodes: nodes, rawEdges: edges };
  }, [tasks, depsQuery.data, handleClickNode]);

  const { nodes, edges } = useGraphLayout(rawNodes, rawEdges);

  return (
    <div className="border border-[var(--border-primary)] rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Plan Accepted</h2>
        <span className="text-green-600 text-sm font-medium">
          Epics and tasks created
        </span>
      </div>

      {progress && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-sm text-[var(--text-secondary)] mb-1">
            <span>
              {progress.completed} of {progress.total} tasks complete ({progress.pct}%)
            </span>
            {progress.inProgress > 0 && (
              <span className="text-amber-600">
                {progress.inProgress} in progress
              </span>
            )}
          </div>
          <div className="w-full h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden flex">
            <div
              className="h-full bg-[var(--accent)] transition-all duration-300"
              style={{ width: `${progress.pct}%` }}
            />
            <div
              className="h-full bg-amber-400 transition-all duration-300"
              style={{ width: `${progress.inProgressPct}%` }}
            />
          </div>
        </div>
      )}

      {topLevelEpic && (topLevelEpic.status === "draft" || topLevelEpic.status === "approved") && (
        <div className="mb-4">
          <button
            className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            disabled={isStartingWork}
            onClick={async () => {
              try {
                const result = await startWork({
                  repoId,
                  entityType: "epic",
                  entityId: topLevelEpic.id,
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
            }}
          >
            {isStartingWork ? "Starting..." : "Start Working Session"}
          </button>
        </div>
      )}

      {topLevelEpic && (ideaStatus === "complete" || ideaStatus === "archived") && (
        <div className="mb-4">
          <button
            className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            disabled={isStartingDebug}
            onClick={async () => {
              try {
                const result = await startDebug({
                  repoId,
                  entityType: "epic",
                  entityId: topLevelEpic.id,
                });
                if (result?.id) {
                  openSessionPanel(result.id);
                }
              } catch (err) {
                addToast({
                  title: "Debug session failed",
                  body: err instanceof Error ? err.message : "Something went wrong",
                  variant: "error",
                });
              }
            }}
          >
            {isStartingDebug ? "Starting..." : "Start Debug Session"}
          </button>
        </div>
      )}

      {isLoading ? (
        <p className="text-[var(--text-faint)] text-center p-8">Loading graph...</p>
      ) : tasks.length === 0 ? (
        <p className="text-[var(--text-faint)] text-center p-8">No tasks found.</p>
      ) : (
        <div className="h-[500px] rounded-lg overflow-hidden border border-[var(--border-primary)]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
            <MiniMap
              nodeColor={(node) => {
                if (node.type === "group") return "#A5B4FC";
                const data = node.data as Record<string, unknown>;
                const status = data?.status;
                return STATUS_COLORS[status as string] ?? "#9CA3AF";
              }}
            />
          </ReactFlow>
        </div>
      )}

      {selectedTaskId && (
        <TaskEditorModal
          taskId={selectedTaskId}
          repoId={repoId}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
    </div>
  );
}

// -- Main view --------------------------------------------------------------

export function IdeaDetail() {
  const { ideaId } = useParams<{ ideaId: string }>();
  const navigate = useNavigate();
  const { idea, isLoading: ideaLoading } = useIdea(ideaId ?? null);
  const { plan, isLoading: planLoading } = usePlan(ideaId ?? null);
  const acceptPlan = useAcceptPlan();
  const rejectPlan = useRejectPlan();
  const { openSession: openSessionPanel } = useSessionsPanel();
  const { getAccessTokenSilently } = useAuth0();
  const { hasPermission } = usePermissions();
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editSize, setEditSize] = useState<IdeaSize | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Attachments
  const {
    attachments,
    isLoading: attachmentsLoading,
    deleteAttachment,
    isDeleting,
  } = useIdeaAttachments(ideaId ?? null);

  const updateMutation = trpc.idea.update.useMutation({
    onSuccess: () => {
      setIsEditing(false);
    },
  });

  const dismissMutation = trpc.idea.update.useMutation({
    onSuccess: () => {
      navigate("/");
    },
  });

  const archiveMutation = trpc.idea.archive.useMutation({
    onSuccess: () => {
      navigate("/");
    },
  });

  const startArchSession = trpc.idea.startArchitectureSession.useMutation({
    onSuccess: (data) => {
      if (data?.id) {
        openSessionPanel(data.id);
      }
    },
  });

  // Query the active session to detect error state
  const sessionQuery = trpc.session.getByEntity.useQuery(
    { entityType: "idea", entityId: ideaId! },
    { enabled: !!ideaId },
  );
  const activeSession = sessionQuery.data;

  const handleToggleEdit = useCallback(() => {
    if (idea) {
      setEditTitle(idea.title);
      setEditDescription(idea.description);
      setEditSize((idea.size as IdeaSize) ?? null);
      setIsEditing(true);
    }
  }, [idea]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!idea) return;
    const data: { title?: string; description?: string; size?: IdeaSize | null } = {};
    if (editTitle !== idea.title) data.title = editTitle;
    if (editDescription !== idea.description) data.description = editDescription;
    const currentSize = (idea.size as IdeaSize) ?? null;
    if (editSize !== currentSize) data.size = editSize;
    if (Object.keys(data).length === 0) {
      setIsEditing(false);
      return;
    }
    updateMutation.mutate({ id: idea.id, data });
  }, [idea, editTitle, editDescription, editSize, updateMutation]);

  const handleUpload = useCallback(
    async (file: File) => {
      if (!ideaId) return;
      setIsUploading(true);
      try {
        const token = await getAccessTokenSilently();
        await uploadIdeaFile(ideaId, file, token, "/api/trpc");
      } catch {
        // Upload errors are visible via the hook's error state
      } finally {
        setIsUploading(false);
      }
    },
    [ideaId, getAccessTokenSilently],
  );

  if (ideaLoading || planLoading) {
    return <p className="text-[var(--text-faint)] text-center p-8">Loading...</p>;
  }

  if (!idea) {
    return (
      <div className="text-center py-12">
        <p className="text-[var(--text-muted)]">Idea not found.</p>
        <Link to="/" className="text-[var(--accent)] text-sm mt-2 inline-block">
          Back to ideas
        </Link>
      </div>
    );
  }

  const handleStartArchSession = (phaseConfig?: PhaseConfig) => {
    startArchSession.mutate({ ideaId: idea.id, phaseConfig });
  };

  const handleAccept = () => {
    if (plan) {
      acceptPlan.mutate({ id: plan.id });
    }
  };

  const handleReject = () => {
    if (plan) {
      rejectPlan.mutate({ id: plan.id });
    }
  };

  // Determine which state to render
  const hasDraftPlan = plan && plan.status === "draft";
  const planAccepted = plan && plan.status === "accepted";
  const hasErrorSession = activeSession?.status === "error";
  const hasCompletedSession = activeSession?.status === "completed";
  const hasPausedSession = activeSession?.status === "paused";
  const sessionEndedWithoutPlan =
    idea.status === "planning" &&
    !hasDraftPlan &&
    !hasErrorSession &&
    (hasCompletedSession || hasPausedSession);
  const hasPlanningSession =
    idea.status === "planning" &&
    !hasDraftPlan &&
    !planAccepted &&
    !hasErrorSession &&
    !sessionEndedWithoutPlan;
  const showNoPlan =
    (idea.status === "new" ||
      (idea.status === "planning" && !plan && !hasErrorSession)) &&
    !hasPlanningSession &&
    !sessionEndedWithoutPlan;

  return (
    <div className="max-w-[700px] mx-auto">
      <Link to="/" className="text-[var(--accent)] text-sm mb-4 inline-block">
        &larr; Back to ideas
      </Link>

      <IdeaMetadata
        idea={idea}
        isEditing={isEditing}
        onToggleEdit={handleToggleEdit}
        editTitle={editTitle}
        editDescription={editDescription}
        onTitleChange={setEditTitle}
        onDescriptionChange={setEditDescription}
        editSize={editSize}
        onSizeChange={setEditSize}
      />

      {/* Save / Cancel bar when editing */}
      {isEditing && (
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={handleSaveEdit}
            disabled={updateMutation.isPending}
            className="px-4 py-1.5 text-sm bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {updateMutation.isPending ? "Saving..." : "Save"}
          </button>
          <button
            onClick={handleCancelEdit}
            disabled={updateMutation.isPending}
            className="px-4 py-1.5 text-sm text-[var(--text-secondary)] border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-secondary)] cursor-pointer"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Attachments section */}
      <AttachmentsSection
        attachments={attachments}
        isLoading={attachmentsLoading}
        isEditing={isEditing}
        onDelete={deleteAttachment}
        isDeleting={isDeleting}
        onUpload={handleUpload}
        isUploading={isUploading}
        canUpload={hasPermission("file:upload")}
      />

      {/* Phases section */}
      {ideaId && <PhasesSection ideaId={ideaId} />}

      {/* Dismiss & Archive actions */}
      {idea.status !== "dismissed" && idea.status !== "archived" && !isEditing && (
        <div className="flex items-center gap-2 mb-4">
          {/* Archive */}
          {!confirmArchive ? (
            <button
              onClick={() => setConfirmArchive(true)}
              disabled={archiveMutation.isPending}
              className="px-3 py-1.5 text-xs text-[var(--text-secondary)] border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-secondary)] cursor-pointer disabled:opacity-60"
            >
              Archive Idea
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => archiveMutation.mutate({ id: idea.id })}
                disabled={archiveMutation.isPending}
                className="px-3 py-1.5 text-xs bg-[var(--text-secondary)] text-white rounded hover:bg-[var(--text-primary)] cursor-pointer disabled:opacity-60"
              >
                {archiveMutation.isPending ? "Archiving..." : "Confirm Archive"}
              </button>
              <button
                onClick={() => setConfirmArchive(false)}
                className="px-3 py-1.5 text-xs text-[var(--text-secondary)] border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-secondary)] cursor-pointer"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Dismiss */}
          {!confirmArchive && (
            <>
              {!confirmDismiss ? (
                <button
                  onClick={() => setConfirmDismiss(true)}
                  disabled={dismissMutation.isPending}
                  className="px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50 cursor-pointer disabled:opacity-60"
                >
                  Dismiss Idea
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => dismissMutation.mutate({ id: idea.id, data: { status: "dismissed" } })}
                    disabled={dismissMutation.isPending}
                    className="px-3 py-1.5 text-xs bg-red-600 text-white rounded hover:bg-red-700 cursor-pointer disabled:opacity-60"
                  >
                    {dismissMutation.isPending ? "Dismissing..." : "Confirm Dismiss"}
                  </button>
                  <button
                    onClick={() => setConfirmDismiss(false)}
                    className="px-3 py-1.5 text-xs text-[var(--text-secondary)] border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-secondary)] cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {showNoPlan && <NoPlanState onStart={handleStartArchSession} isStarting={startArchSession.isPending} />}

      {hasErrorSession && <ErrorState onRetry={() => handleStartArchSession()} isRetrying={startArchSession.isPending} />}

      {sessionEndedWithoutPlan && (
        <CompletedNoPlanState
          onStart={handleStartArchSession}
          isStarting={startArchSession.isPending}
          onViewSession={activeSession?.id ? () => openSessionPanel(activeSession.id) : undefined}
        />
      )}

      {hasPlanningSession && <PlanningState />}

      {hasDraftPlan && (
        <PlanTree
          proposal={plan.proposal as Proposal}
          planId={plan.id}
          onAccept={handleAccept}
          onReject={handleReject}
          isAccepting={acceptPlan.isPending}
          isRejecting={rejectPlan.isPending}
        />
      )}

      {planAccepted && <AcceptedPlanState repoId={idea.repoId} ideaId={idea.id} ideaStatus={idea.status} />}
    </div>
  );
}
