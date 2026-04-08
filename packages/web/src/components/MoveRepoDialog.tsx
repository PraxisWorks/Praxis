import { useState } from "react";
import { useRepoMove } from "@praxis2/hooks";
import { Modal } from "./Modal.js";

type MoveRepoDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  repo: {
    id: string;
    name: string;
    orgId: string;
  };
};

export function MoveRepoDialog({ isOpen, onClose, repo }: MoveRepoDialogProps) {
  const { moveRepo, isMoving, moveError, adminOrgs, isLoadingOrgs } = useRepoMove();
  const [targetOrgId, setTargetOrgId] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Filter out the current org from the dropdown
  const availableOrgs = adminOrgs.filter((org) => org.id !== repo.orgId);

  async function handleMove() {
    if (!targetOrgId) return;
    setError(null);

    try {
      await moveRepo({ repoId: repo.id, targetOrgId });
      handleClose();
    } catch (err: any) {
      // Show specific error messages for known error codes
      const code = err?.data?.code;
      if (code === "CONFLICT") {
        setError("A repo with the same prefix already exists in the target organization.");
      } else if (code === "PRECONDITION_FAILED") {
        setError("This repo has active sessions. Stop all sessions before moving.");
      } else {
        setError(err?.message ?? "Failed to move repo");
      }
    }
  }

  function handleClose() {
    setTargetOrgId("");
    setError(null);
    onClose();
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Move Repo">
      <p className="text-sm text-[var(--text-primary)] mb-1 font-medium">{repo.name}</p>

      <p className="text-sm text-[var(--text-tertiary)] mb-4">
        Moving this repo will transfer all ideas, plans, and work items to the
        selected organization. Members of the source org who are not members of
        the target org will lose access.
      </p>

      <label className="block text-sm text-[var(--text-secondary)] mb-2">
        Target Organization
      </label>

      {isLoadingOrgs ? (
        <p className="text-sm text-[var(--text-tertiary)]">Loading organizations...</p>
      ) : availableOrgs.length === 0 ? (
        <p className="text-sm text-[var(--text-tertiary)]">
          No other organizations available. You need admin access in at least one other organization.
        </p>
      ) : (
        <select
          value={targetOrgId}
          onChange={(e) => {
            setTargetOrgId(e.target.value);
            setError(null);
          }}
          className="w-full px-3 py-2 text-sm border border-[var(--border-primary)] rounded bg-[var(--bg-primary)] text-[var(--text-primary)]"
        >
          <option value="">Select an organization...</option>
          {availableOrgs.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
      )}

      {error && (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      )}

      <div className="flex justify-end gap-3 mt-6">
        <button
          onClick={handleClose}
          className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded hover:bg-[var(--border-primary)] cursor-pointer"
        >
          Cancel
        </button>
        <button
          onClick={handleMove}
          disabled={!targetOrgId || isMoving || availableOrgs.length === 0}
          className="px-4 py-2 text-sm font-medium text-white bg-[var(--accent)] rounded hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {isMoving ? "Moving..." : "Move Repo"}
        </button>
      </div>
    </Modal>
  );
}
