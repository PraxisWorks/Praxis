import { useState } from "react";
import { useTasks } from "@praxis2/hooks";
import { Modal } from "./Modal.js";

const PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

type TaskCreatorModalProps = {
  repoId: string;
  isEpic?: boolean;
  onClose: () => void;
};

export function TaskCreatorModal({ repoId, isEpic: initialIsEpic = false, onClose }: TaskCreatorModalProps) {
  const { tasks, createTask, isCreating } = useTasks(repoId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [isEpic, setIsEpic] = useState(initialIsEpic);
  const [parentId, setParentId] = useState<string | null>(null);

  const epicOptions = tasks.filter((b) => b.isEpic);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;
    try {
      await createTask({
        repoId,
        title: title.trim(),
        description: description.trim(),
        priority: priority as "low" | "medium" | "high",
        isEpic,
        parentId: isEpic ? null : parentId,
      });
      onClose();
    } catch {
      // Error handled by tRPC/hooks layer
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={isEpic ? "New Epic" : "New Task"}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {/* Title */}
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--text-secondary)]">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={isEpic ? "Epic title" : "Task title"}
            required
            className="px-3 py-1.5 border border-[var(--border-secondary)] rounded text-sm"
          />
        </label>

        {/* Description */}
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--text-secondary)]">Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what needs to be done..."
            required
            rows={3}
            className="px-3 py-1.5 border border-[var(--border-secondary)] rounded text-sm"
          />
        </label>

        {/* Priority */}
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--text-secondary)]">Priority</span>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="px-3 py-1.5 border border-[var(--border-secondary)] rounded text-sm"
          >
            {PRIORITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>

        {/* Is Epic toggle */}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isEpic}
            onChange={(e) => setIsEpic(e.target.checked)}
          />
          <span className="text-sm text-[var(--text-secondary)]">This is an Epic</span>
        </label>

        {/* Parent Epic selector (hidden for epics) */}
        {!isEpic && epicOptions.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--text-secondary)]">Parent Epic</span>
            <select
              value={parentId ?? ""}
              onChange={(e) => setParentId(e.target.value || null)}
              className="px-3 py-1.5 border border-[var(--border-secondary)] rounded text-sm"
            >
              <option value="">None</option>
              {epicOptions.map((epic) => (
                <option key={epic.id} value={epic.id}>{epic.title}</option>
              ))}
            </select>
          </label>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-primary)]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-secondary)] cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isCreating || !title.trim() || !description.trim()}
            className="px-3 py-1.5 text-xs bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] disabled:opacity-60 cursor-pointer"
          >
            {isCreating ? "Creating..." : "Create"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
