import { useState, type FormEvent } from "react";
import { useRepos, useLimits } from "@praxis2/hooks";
import { useSelectedRepo } from "../contexts/RepoContext.js";
import { useSelectedOrg } from "../contexts/OrgContext.js";
import { Modal } from "./Modal.js";
import { ColorPicker } from "./ColorPicker.js";
import { IconPicker } from "./IconPicker.js";
import { UsageBadge } from "./UsageBadge.js";
import { COLOR_OPTIONS } from "../lib/constants.js";

type AddRepoModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

/**
 * Modal for adding an existing GitHub repo as a repo.
 * Less strict name validation than AppCreatorModal since
 * existing repos may have varied naming conventions.
 */
export function AddRepoModal({ isOpen, onClose }: AddRepoModalProps) {
  const { createRepo, isCreating, repos } = useRepos();
  const { setSelectedRepoId } = useSelectedRepo();
  const { selectedOrgId, organizations } = useSelectedOrg();
  const { limits } = useLimits();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
  const [bdPrefix, setBdPrefix] = useState("");

  const effectiveOrgId = orgId ?? selectedOrgId ?? organizations[0]?.id ?? null;
  const repoCount = effectiveOrgId ? repos.filter((r) => r.orgId === effectiveOrgId).length : 0;
  const repoLimitReached = limits?.maxReposPerOrg != null && repoCount >= limits.maxReposPerOrg;
  const [color, setColor] = useState<string>(COLOR_OPTIONS[0]);
  const [icon, setIcon] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Validate repo format if provided: "owner/repo" or full GitHub URL
  const repoError =
    repo.length > 0 &&
    !/^(https?:\/\/github\.com\/)?[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+\/?$/.test(repo)
      ? "Enter a valid GitHub repo (e.g., owner/repo or https://github.com/owner/repo)"
      : null;

  const handlePrefixChange = (value: string) => {
    setBdPrefix(value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4));
  };

  const resetForm = () => {
    setOrgId(null);
    setName("");
    setRepo("");
    setBdPrefix("");
    setColor(COLOR_OPTIONS[0]);
    setIcon(null);
    setDescription("");
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name || bdPrefix.length < 2) return;
    if (repoError) return;

    try {
      const newRepo = await createRepo({
        orgId: effectiveOrgId!,
        name,
        repo: repo || null,
        bdPrefix,
        color,
        icon,
        description: description || null,
      });
      resetForm();
      setSelectedRepoId(newRepo.id);
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to add repo";
      setError(message);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Add Existing Repo">
      <div className="flex items-center justify-between mb-2">
        <UsageBadge current={repoCount} max={limits?.maxReposPerOrg ?? null} label="rigs" />
      </div>
      {repoLimitReached && (
        <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">
          Rig limit reached.
        </div>
      )}
      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Organization */}
        {organizations.length > 1 && (
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
              Organization
            </label>
            <select
              value={effectiveOrgId ?? ""}
              onChange={(e) => setOrgId(e.target.value || null)}
              className="w-full px-3 py-2 border border-[var(--border-secondary)] rounded text-sm bg-[var(--bg-primary)] text-[var(--text-primary)]"
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Project name */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
            Project name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-existing-project"
            required
            className="w-full px-3 py-2 border border-[var(--border-secondary)] rounded text-sm"
          />
        </div>

        {/* GitHub repo */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
            GitHub repo (optional)
          </label>
          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/repo or https://github.com/owner/repo"
            className="w-full px-3 py-2 border border-[var(--border-secondary)] rounded text-sm"
          />
          {repoError && (
            <p className="text-red-500 text-xs mt-1">{repoError}</p>
          )}
        </div>

        {/* Task prefix */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
            Task prefix (2-4 letters)
          </label>
          <input
            value={bdPrefix}
            onChange={(e) => handlePrefixChange(e.target.value)}
            placeholder="MP"
            required
            maxLength={4}
            className="w-full px-3 py-2 border border-[var(--border-secondary)] rounded text-sm uppercase"
          />
          <p className="text-[var(--text-faint)] text-xs mt-1">
            Used to namespace task IDs (e.g., {bdPrefix || "MP"}-001)
          </p>
        </div>

        {/* Color picker */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
            Color
          </label>
          <ColorPicker value={color} onChange={setColor} />
        </div>

        {/* Icon picker */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
            Icon (optional)
          </label>
          <IconPicker value={icon} onChange={setIcon} />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
            Description (optional)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={1000}
            className="w-full px-3 py-2 border border-[var(--border-secondary)] rounded text-sm resize-none"
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 text-sm border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-secondary)] cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isCreating || !name || bdPrefix.length < 2 || !!repoError || !effectiveOrgId || repoLimitReached}
            className="px-4 py-2 text-sm bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isCreating ? "Adding..." : "Add Repo"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
