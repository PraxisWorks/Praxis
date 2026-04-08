import { useState } from "react";
import { useRepos } from "@praxis2/hooks";
import { useSelectedRepo } from "../contexts/RepoContext.js";
import { Modal } from "./Modal.js";
import { ColorPicker } from "./ColorPicker.js";
import { IconPicker } from "./IconPicker.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { MoveRepoDialog } from "./MoveRepoDialog.js";

type Repo = {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  orgId: string;
};

type EditRepoModalProps = {
  isOpen: boolean;
  onClose: () => void;
  repo: Repo;
};

export function EditRepoModal({ isOpen, onClose, repo }: EditRepoModalProps) {
  const { updateRepo, isUpdating, deleteRepo, isDeleting, buildDevice, isBuilding } = useRepos();
  const { selectedRepoId, setSelectedRepoId } = useSelectedRepo();
  const [color, setColor] = useState(repo.color);
  const [icon, setIcon] = useState<string | null>(repo.icon);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);

  const hasChanges = color !== repo.color || icon !== repo.icon;

  async function handleSave() {
    await updateRepo({ id: repo.id, data: { color, icon } });
    onClose();
  }

  async function handleDelete() {
    await deleteRepo({ id: repo.id });
    if (selectedRepoId === repo.id) {
      setSelectedRepoId(null);
    }
    setConfirmingDelete(false);
    onClose();
  }

  function handleClose() {
    setColor(repo.color);
    setIcon(repo.icon);
    setConfirmingDelete(false);
    setShowMoveDialog(false);
    onClose();
  }

  return (
    <>
      <Modal isOpen={isOpen} onClose={handleClose} title="Edit Repo">
        <p className="text-sm font-medium text-[var(--text-primary)] mb-3">{repo.name}</p>

        <label className="block text-sm text-[var(--text-secondary)] mb-2">Color</label>
        <ColorPicker value={color} onChange={setColor} />

        <label className="block text-sm text-[var(--text-secondary)] mb-2 mt-4">Icon</label>
        <IconPicker value={icon} onChange={setIcon} />

        <button
          onClick={handleSave}
          disabled={!hasChanges || isUpdating}
          className="mt-4 w-full px-4 py-2 text-sm font-medium text-white bg-[var(--accent)] rounded hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {isUpdating ? "Saving..." : "Save"}
        </button>

        <hr className="my-4 border-[var(--border-primary)]" />

        <button
          onClick={() => buildDevice({ id: repo.id })}
          disabled={isBuilding}
          className="w-full px-4 py-2 text-sm font-medium text-[var(--text-secondary)] border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-secondary)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {isBuilding ? "Building..." : "Build for Device"}
        </button>

        <button
          onClick={() => setShowMoveDialog(true)}
          className="mt-2 w-full px-4 py-2 text-sm font-medium text-[var(--text-secondary)] border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-secondary)] cursor-pointer"
        >
          Move to Organization
        </button>

        <button
          onClick={() => setConfirmingDelete(true)}
          className="mt-2 w-full px-4 py-2 text-sm font-medium text-red-600 border border-red-300 rounded hover:bg-red-50 cursor-pointer"
        >
          Delete Repo
        </button>
      </Modal>

      <ConfirmDialog
        open={confirmingDelete}
        title="Delete Repo"
        message={`Are you sure you want to delete "${repo.name}"? All sessions, beads, ideas, and plans will be permanently removed.`}
        confirmLabel={isDeleting ? "Deleting..." : "Delete"}
        confirmVariant="danger"
        onConfirm={handleDelete}
        onCancel={() => setConfirmingDelete(false)}
      />

      <MoveRepoDialog
        isOpen={showMoveDialog}
        onClose={() => setShowMoveDialog(false)}
        repo={repo}
      />
    </>
  );
}
