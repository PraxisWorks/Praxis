import { useState, useEffect } from "react";
import { useTask, useTasks, useTaskDependencies, usePermissions, useSessions } from "@praxis2/hooks";
import { Modal } from "./Modal.js";
import { SchedulePicker } from "./SchedulePicker.js";
import { useSessionsPanel } from "../contexts/SessionsPanelContext.js";
import { useToast } from "../contexts/ToastContext.js";

type TaskEditorModalProps = {
  taskId: string;
  repoId: string | null;
  onClose: () => void;
};

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "approved", label: "Approved" },
  { value: "in_progress", label: "In Progress" },
  { value: "blocked", label: "Blocked" },
  { value: "complete", label: "Complete" },
  { value: "archived", label: "Archived" },
];

const PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export function TaskEditorModal({
  taskId,
  repoId,
  onClose,
}: TaskEditorModalProps) {
  const { task, isLoading: taskLoading } = useTask(taskId);
  const { tasks: allTasks, updateTask, deleteTask } = useTasks(repoId);
  const { addDependency, removeDependency } = useTaskDependencies();
  const { hasPermission } = usePermissions();
  const { startDebug, isStartingDebug, startWork, isStartingWork } = useSessions();
  const { openSession: openSessionPanel } = useSessionsPanel();
  const { addToast } = useToast();

  // Local form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("draft");
  const [priority, setPriority] = useState("medium");
  const [isEpic, setIsEpic] = useState(false);
  const [parentId, setParentId] = useState<string | null>(null);
  const [depIds, setDepIds] = useState<string[]>([]);

  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);

  // Initialize form from task data
  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description);
    setNotes(task.notes ?? "");
    setStatus(task.status);
    setPriority(task.priority);
    setIsEpic(task.isEpic);
    setParentId(task.parentId);
    setDepIds(
      (task.deps ?? []).map(
        (d: { dependsOnId: string }) => d.dependsOnId,
      ),
    );
  }, [task]);

  const epicOptions = allTasks.filter(
    (b) => b.isEpic && b.id !== taskId,
  );
  const depCandidates = allTasks.filter((b) => b.id !== taskId);

  const handleSave = async () => {
    if (!task) return;
    setSaving(true);
    try {
      // Update core task fields
      await updateTask({
        id: taskId,
        title,
        description,
        notes: notes || null,
        status: status as "draft" | "approved" | "in_progress" | "blocked" | "complete" | "archived",
        priority: priority as "low" | "medium" | "high",
        isEpic,
        parentId: isEpic ? null : parentId,
      });

      // Reconcile dependencies
      const currentDepIds = new Set(
        (task.deps ?? []).map(
          (d: { dependsOnId: string }) => d.dependsOnId,
        ),
      );
      const nextDepIds = new Set(depIds);

      const toAdd = depIds.filter((id) => !currentDepIds.has(id));
      const toRemove = [...currentDepIds].filter(
        (id) => !nextDepIds.has(id),
      );

      await Promise.all([
        ...toAdd.map((dependsOnId) =>
          addDependency({ taskId, dependsOnId }),
        ),
        ...toRemove.map((dependsOnId) =>
          removeDependency({ taskId, dependsOnId }),
        ),
      ]);

      onClose();
    } catch {
      // Error is handled by tRPC/hooks layer
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await deleteTask({ id: taskId });
      onClose();
    } catch {
      // Error is handled by tRPC/hooks layer
    }
  };

  const showWorkSession =
    status !== "draft" && status !== "complete" && status !== "archived";

  const toggleDep = (id: string) => {
    setDepIds((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id],
    );
  };

  return (
    <Modal isOpen onClose={onClose} title={taskLoading ? "Loading..." : "Edit Task"}>
      {taskLoading || !task ? (
        <p className="text-[var(--text-faint)] text-center py-4">Loading task...</p>
      ) : (
        <div className="flex flex-col gap-3 max-h-[70vh] overflow-y-auto">
          {/* Title */}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--text-secondary)]">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="px-3 py-1.5 border border-[var(--border-secondary)] rounded text-sm"
            />
          </label>

          {/* Description */}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--text-secondary)]">
              Description
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="px-3 py-1.5 border border-[var(--border-secondary)] rounded text-sm"
            />
          </label>

          {/* Notes */}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--text-secondary)]">Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="px-3 py-1.5 border border-[var(--border-secondary)] rounded text-sm"
            />
          </label>

          {/* Status + Priority row */}
          <div className="flex gap-3">
            <label className="flex flex-col gap-1 flex-1">
              <span className="text-xs font-medium text-[var(--text-secondary)]">Status</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="px-3 py-1.5 border border-[var(--border-secondary)] rounded text-sm"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 flex-1">
              <span className="text-xs font-medium text-[var(--text-secondary)]">
                Priority
              </span>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="px-3 py-1.5 border border-[var(--border-secondary)] rounded text-sm"
              >
                {PRIORITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Is Epic checkbox */}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isEpic}
              onChange={(e) => setIsEpic(e.target.checked)}
            />
            <span className="text-sm text-[var(--text-secondary)]">This is an Epic</span>
          </label>

          {/* Parent Epic selector (hidden for epics) */}
          {!isEpic && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--text-secondary)]">
                Parent Epic
              </span>
              <select
                value={parentId ?? ""}
                onChange={(e) =>
                  setParentId(e.target.value || null)
                }
                className="px-3 py-1.5 border border-[var(--border-secondary)] rounded text-sm"
              >
                <option value="">None</option>
                {epicOptions.map((epic) => (
                  <option key={epic.id} value={epic.id}>
                    {epic.title}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* Dependencies multi-select */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--text-secondary)]">
              Dependencies ({depIds.length})
            </span>
            <div className="border border-[var(--border-secondary)] rounded max-h-32 overflow-y-auto">
              {depCandidates.length === 0 ? (
                <p className="text-xs text-[var(--text-faint)] p-2">
                  No other tasks available
                </p>
              ) : (
                depCandidates.map((b) => (
                  <label
                    key={b.id}
                    className="flex items-center gap-2 px-2 py-1 hover:bg-[var(--bg-secondary)] cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={depIds.includes(b.id)}
                      onChange={() => toggleDep(b.id)}
                    />
                    <span className="truncate">{b.title}</span>
                    {b.taskId && (
                      <span className="text-[10px] text-[var(--text-faint)] font-mono shrink-0">
                        {b.taskId}
                      </span>
                    )}
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Footer actions */}
          <div className="flex items-center justify-between pt-3 border-t border-[var(--border-primary)]">
            <div className="flex gap-2">
              {showWorkSession && hasPermission("session:create:working") && (
                <div className="relative flex items-center gap-1">
                  <button
                    className="px-3 py-1.5 text-xs bg-[var(--accent-light)] text-[var(--accent)] rounded-l hover:bg-[var(--accent-light)] cursor-pointer disabled:opacity-60"
                    disabled={isStartingWork}
                    onClick={async () => {
                      const effectiveRigId = repoId ?? task?.repoId;
                      if (!task || !effectiveRigId) return;
                      try {
                        const result = await startWork({
                          repoId: effectiveRigId,
                          entityType: task.isEpic ? "epic" : "task",
                          entityId: task.id,
                        });
                        if (result?.id) {
                          openSessionPanel(result.id);
                        }
                        onClose();
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
                  <button
                    className="px-1.5 py-1.5 text-xs bg-[var(--accent-light)] text-[var(--accent)] rounded-r hover:bg-[var(--accent-light)] cursor-pointer disabled:opacity-60 border-l border-[var(--accent)]/20"
                    disabled={isStartingWork}
                    onClick={() => setShowScheduler((v) => !v)}
                    title="Schedule session"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                      <path fillRule="evenodd" d="M4 1.75a.75.75 0 0 1 1.5 0V3h5V1.75a.75.75 0 0 1 1.5 0V3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2V1.75ZM4.5 7a.5.5 0 0 0 0 1h7a.5.5 0 0 0 0-1h-7Zm0 2.5a.5.5 0 0 0 0 1h4a.5.5 0 0 0 0-1h-4Z" clipRule="evenodd" />
                    </svg>
                  </button>
                  {showScheduler && (
                    <SchedulePicker
                      onSchedule={async (scheduledFor) => {
                        const effectiveRigId = repoId ?? task?.repoId;
                        if (!task || !effectiveRigId) return;
                        try {
                          const result = await startWork({
                            repoId: effectiveRigId,
                            entityType: task.isEpic ? "epic" : "task",
                            entityId: task.id,
                            scheduledFor,
                          });
                          if (result?.id) {
                            openSessionPanel(result.id);
                            addToast({
                              title: scheduledFor ? "Session scheduled" : "Working session started",
                              body: scheduledFor
                                ? `Scheduled for ${new Date(scheduledFor).toLocaleString()}`
                                : "Session is now active",
                              variant: "info",
                            });
                          }
                          onClose();
                        } catch {
                          addToast({
                            title: "Failed to start working session",
                            body: "Something went wrong",
                            variant: "error",
                          });
                        }
                        setShowScheduler(false);
                      }}
                      onClose={() => setShowScheduler(false)}
                      isStarting={isStartingWork}
                    />
                  )}
                </div>
              )}
              {hasPermission("session:create:debug") && (
                <button
                  className="px-3 py-1.5 text-xs bg-[var(--bg-secondary)] text-[var(--text-secondary)] rounded hover:bg-[var(--bg-tertiary)] cursor-pointer disabled:opacity-60"
                  disabled={isStartingDebug}
                  onClick={async () => {
                    const effectiveRigId = repoId ?? task?.repoId;
                    if (!task || !effectiveRigId) return;
                    try {
                      const result = await startDebug({
                        repoId: effectiveRigId,
                        entityType: task.isEpic ? "epic" : "task",
                        entityId: task.id,
                      });
                      if (result?.id) {
                        openSessionPanel(result.id);
                      }
                      onClose();
                    } catch (err) {
                      addToast({
                        title: "Debug session failed",
                        body: err instanceof Error ? err.message : "Something went wrong",
                        variant: "error",
                      });
                    }
                  }}
                >
                  {isStartingDebug ? "Starting..." : "Debug Session"}
                </button>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleDelete}
                className={`px-3 py-1.5 text-xs rounded cursor-pointer ${
                  confirmDelete
                    ? "bg-red-600 text-white hover:bg-red-700"
                    : "text-red-600 hover:bg-red-50"
                }`}
              >
                {confirmDelete ? "Confirm Delete" : "Delete"}
              </button>
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-secondary)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !title.trim()}
                className="px-3 py-1.5 text-xs bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] disabled:opacity-60 cursor-pointer"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
