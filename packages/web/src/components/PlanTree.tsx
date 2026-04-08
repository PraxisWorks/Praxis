import { useState, useCallback, useMemo } from "react";
import type { Proposal, ProposalEpic, ProposalTask } from "@praxis2/shared";
import { trpc } from "@praxis2/hooks";

/** Resolve epic tasks, falling back to legacy "beads" key from pre-rename data. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const epicTasks = (epic: ProposalEpic): ProposalTask[] =>
  epic.tasks ?? (epic as any).beads ?? [];

type PlanTreeProps = {
  proposal: Proposal;
  planId: string;
  onAccept: () => void;
  onReject: () => void;
  isAccepting: boolean;
  isRejecting: boolean;
};

const PRIORITY_COLORS: Record<string, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-yellow-100 text-yellow-700",
  low: "bg-green-100 text-green-700",
};

// --- TaskItem ---

function TaskItem({
  task,
  onUpdate,
  allTaskKeys,
}: {
  task: ProposalTask;
  onUpdate: (key: string, updates: Partial<ProposalTask>) => void;
  allTaskKeys: Map<string, string>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editDescription, setEditDescription] = useState(task.description);
  const [editPriority, setEditPriority] = useState(task.priority);

  const handleSave = () => {
    onUpdate(task.key, {
      title: editTitle,
      description: editDescription,
      priority: editPriority,
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditTitle(task.title);
    setEditDescription(task.description);
    setEditPriority(task.priority);
    setIsEditing(false);
  };

  return (
    <div className="ml-6 border-l-2 border-[var(--border-primary)] pl-4 py-2">
      {isEditing ? (
        <div className="space-y-2">
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="w-full px-2 py-1 border border-[var(--border-secondary)] rounded text-sm"
          />
          <textarea
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            className="w-full px-2 py-1 border border-[var(--border-secondary)] rounded text-sm"
            rows={2}
          />
          <select
            value={editPriority}
            onChange={(e) =>
              setEditPriority(e.target.value as "low" | "medium" | "high")
            }
            className="px-2 py-1 border border-[var(--border-secondary)] rounded text-sm"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="text-xs text-[var(--accent)] hover:text-[var(--accent-hover)] cursor-pointer"
            >
              Save
            </button>
            <button
              onClick={handleCancel}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{task.title}</span>
            <span
              className={`px-1.5 py-0.5 rounded text-xs ${PRIORITY_COLORS[task.priority]}`}
            >
              {task.priority}
            </span>
            <button
              onClick={() => setIsEditing(true)}
              className="text-xs text-[var(--text-faint)] hover:text-[var(--text-secondary)] cursor-pointer"
            >
              edit
            </button>
          </div>
          <p className="text-[var(--text-muted)] text-xs mt-0.5">{task.description}</p>
          {task.dependsOn.length > 0 && (
            <div className="flex gap-1 mt-1 flex-wrap">
              <span className="text-xs text-[var(--text-faint)]">depends on:</span>
              {task.dependsOn.map((depKey) => (
                <span
                  key={depKey}
                  className="text-xs bg-[var(--bg-tertiary)] text-[var(--text-secondary)] px-1.5 py-0.5 rounded"
                >
                  {allTaskKeys.get(depKey) ?? depKey}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- EpicItem ---

function EpicItem({
  epic,
  onUpdateEpic,
  onUpdateTask,
  allTaskKeys,
}: {
  epic: ProposalEpic;
  onUpdateEpic: (key: string, updates: Partial<ProposalEpic>) => void;
  onUpdateTask: (key: string, updates: Partial<ProposalTask>) => void;
  allTaskKeys: Map<string, string>;
}) {
  const [expanded, setExpanded] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(epic.title);
  const [editDescription, setEditDescription] = useState(epic.description);

  const handleSave = () => {
    onUpdateEpic(epic.key, {
      title: editTitle,
      description: editDescription,
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditTitle(epic.title);
    setEditDescription(epic.description);
    setIsEditing(false);
  };

  return (
    <div className="border border-[var(--border-primary)] rounded-lg p-4 mb-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer"
        >
          {expanded ? "\u25BC" : "\u25B6"}
        </button>

        {isEditing ? (
          <div className="flex-1 space-y-2">
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full px-2 py-1 border border-[var(--border-secondary)] rounded text-sm font-semibold"
            />
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              className="w-full px-2 py-1 border border-[var(--border-secondary)] rounded text-sm"
              rows={2}
            />
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                className="text-xs text-[var(--accent)] cursor-pointer"
              >
                Save
              </button>
              <button
                onClick={handleCancel}
                className="text-xs text-[var(--text-muted)] cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">{epic.title}</h3>
              <span className="text-xs text-[var(--text-faint)]">
                {epicTasks(epic).length} task{epicTasks(epic).length !== 1 ? "s" : ""}
              </span>
              <button
                onClick={() => setIsEditing(true)}
                className="text-xs text-[var(--text-faint)] hover:text-[var(--text-secondary)] cursor-pointer"
              >
                edit
              </button>
            </div>
            <p className="text-[var(--text-muted)] text-sm mt-0.5">{epic.description}</p>
          </div>
        )}
      </div>

      {expanded && (
        <div className="mt-3">
          {epicTasks(epic).map((task) => (
            <TaskItem
              key={task.key}
              task={task}
              onUpdate={onUpdateTask}
              allTaskKeys={allTaskKeys}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// --- PlanTree ---

export function PlanTree({
  proposal,
  planId,
  onAccept,
  onReject,
  isAccepting,
  isRejecting,
}: PlanTreeProps) {
  const [localProposal, setLocalProposal] = useState<Proposal>(
    proposal ?? { epics: [] },
  );
  const updateMutation = trpc.plan.updateProposal.useMutation();

  // Build a map of all task keys to titles for dependency display
  const allTaskKeys = useMemo(() => {
    const map = new Map<string, string>();
    for (const epic of localProposal.epics ?? []) {
      for (const task of epicTasks(epic)) {
        map.set(task.key, task.title);
      }
    }
    return map;
  }, [localProposal]);

  const persistProposal = useCallback(
    (updated: Proposal) => {
      setLocalProposal(updated);
      updateMutation.mutate({ id: planId, proposal: updated });
    },
    [planId, updateMutation],
  );

  const handleUpdateEpic = useCallback(
    (key: string, updates: Partial<ProposalEpic>) => {
      const updated = {
        ...localProposal,
        epics: (localProposal.epics ?? []).map((e) =>
          e.key === key ? { ...e, ...updates } : e,
        ),
      };
      persistProposal(updated);
    },
    [localProposal, persistProposal],
  );

  const handleUpdateTask = useCallback(
    (key: string, updates: Partial<ProposalTask>) => {
      const updated = {
        ...localProposal,
        epics: (localProposal.epics ?? []).map((epic) => ({
          ...epic,
          tasks: epicTasks(epic).map((b) =>
            b.key === key ? { ...b, ...updates } : b,
          ),
        })),
      };
      persistProposal(updated);
    },
    [localProposal, persistProposal],
  );

  const totalTasks = (localProposal.epics ?? []).reduce(
    (sum, e) => sum + epicTasks(e).length,
    0,
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Proposed Plan</h2>
          <p className="text-sm text-[var(--text-muted)]">
            {(localProposal.epics ?? []).length} epic
            {(localProposal.epics ?? []).length !== 1 ? "s" : ""}, {totalTasks} task
            {totalTasks !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      <div className="mb-6">
        {(localProposal.epics ?? []).map((epic) => (
          <EpicItem
            key={epic.key}
            epic={epic}
            onUpdateEpic={handleUpdateEpic}
            onUpdateTask={handleUpdateTask}
            allTaskKeys={allTaskKeys}
          />
        ))}
      </div>

      <div className="flex gap-3 border-t border-[var(--border-primary)] pt-4">
        <button
          onClick={onAccept}
          disabled={isAccepting || isRejecting}
          className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)] disabled:opacity-50 cursor-pointer"
        >
          {isAccepting ? "Accepting..." : "Accept Plan"}
        </button>
        <button
          onClick={onReject}
          disabled={isAccepting || isRejecting}
          className="px-4 py-2 bg-[var(--bg-primary)] text-[var(--text-secondary)] border border-[var(--border-secondary)] rounded-lg hover:bg-[var(--bg-secondary)] disabled:opacity-50 cursor-pointer"
        >
          {isRejecting ? "Declining..." : "Decline Plan"}
        </button>
      </div>
    </div>
  );
}
