import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useRepos, useLimits, trpc } from "@praxis2/hooks";
import { useSelectedRepo } from "../contexts/RepoContext.js";
import { useSelectedOrg } from "../contexts/OrgContext.js";
import { Modal } from "./Modal.js";
import { ColorPicker } from "./ColorPicker.js";
import { IconPicker } from "./IconPicker.js";
import { UsageBadge } from "./UsageBadge.js";
import { COLOR_OPTIONS } from "../lib/constants.js";

type AppCreatorModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

/**
 * Modal for creating a brand-new repo (project from scratch).
 * Validates project name (lowercase, hyphens, numbers only) and auto-derives
 * the task prefix from the name.
 */
export function AppCreatorModal({ isOpen, onClose }: AppCreatorModalProps) {
  const { createRepo, isCreating, repos } = useRepos();
  const { setSelectedRepoId } = useSelectedRepo();
  const { selectedOrgId, organizations } = useSelectedOrg();
  const { limits } = useLimits();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [bdPrefix, setBdPrefix] = useState("");
  const [color, setColor] = useState<string>(COLOR_OPTIONS[0]);
  const [icon, setIcon] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [prefixManuallyEdited, setPrefixManuallyEdited] = useState(false);

  // Initialize orgId from context when modal opens
  const effectiveOrgId = orgId ?? selectedOrgId ?? organizations[0]?.id ?? null;
  const repoCount = effectiveOrgId ? repos.filter((r) => r.orgId === effectiveOrgId).length : 0;
  const repoLimitReached = limits?.maxReposPerOrg != null && repoCount >= limits.maxReposPerOrg;

  // Fetch the org's template config. +New requires a template — without
  // one, Praxis has nothing to clone, so we block submission and show a
  // clear path to Org Settings instead of letting the repo-create job
  // fail on the worker.
  const templateQuery = trpc.organization.getRigTemplate.useQuery(
    { orgId: effectiveOrgId! },
    { enabled: !!effectiveOrgId && isOpen },
  );
  const hasTemplate = !!templateQuery.data?.templateRepo;
  const templateLoading = templateQuery.isLoading;

  // Validate project name: lowercase letters, numbers, hyphens only, must start with a letter.
  const nameRegex = /^[a-z][a-z0-9-]*$/;
  const nameError =
    name.length > 0 && !nameRegex.test(name)
      ? "Must be lowercase, start with a letter, and use only letters, numbers, and hyphens"
      : null;

  const handleNameChange = (value: string) => {
    setName(value);
    if (!prefixManuallyEdited) {
      const parts = value.split("-").filter(Boolean);
      const auto = parts
        .map((p) => p[0]?.toUpperCase() ?? "")
        .join("")
        .slice(0, 4);
      setBdPrefix(auto.length >= 2 ? auto : "");
    }
  };

  const handlePrefixChange = (value: string) => {
    setPrefixManuallyEdited(true);
    setBdPrefix(value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4));
  };

  const resetForm = () => {
    setOrgId(null);
    setName("");
    setBdPrefix("");
    setColor(COLOR_OPTIONS[0]);
    setIcon(null);
    setDescription("");
    setError(null);
    setPrefixManuallyEdited(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name || nameError) return;
    if (bdPrefix.length < 2 || bdPrefix.length > 4) return;

    try {
      const repo = await createRepo({
        orgId: effectiveOrgId!,
        name,
        bdPrefix,
        color,
        icon,
        description: description || null,
        repo: null,
      });
      resetForm();
      setSelectedRepoId(repo.id);
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create repo";
      setError(message);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Create New Repo">
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

      {!templateLoading && !hasTemplate && effectiveOrgId && (
        <div className="border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] rounded p-3 mb-4 text-sm text-[var(--text-secondary)]">
          <p className="font-medium text-[var(--text-primary)] m-0 mb-1">
            No template configured
          </p>
          <p className="m-0 mb-2 text-xs text-[var(--text-faint)]">
            Creating a new repo from scratch requires a template repo. Set
            one in Org Settings, or use{" "}
            <strong>+ Add</strong> to connect an existing GitHub repo
            instead.
          </p>
          <Link
            to="/org/settings"
            onClick={handleClose}
            className="inline-block text-xs text-[var(--accent)] underline"
          >
            Open Org Settings →
          </Link>
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
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="my-project"
            required
            className="w-full px-3 py-2 border border-[var(--border-secondary)] rounded text-sm"
          />
          {nameError && (
            <p className="text-red-500 text-xs mt-1">{nameError}</p>
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

        {/* Info text */}
        <p className="text-xs text-[var(--text-faint)]">
          This will create a new repo that you can use to organize tasks and sessions.
        </p>

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
            disabled={isCreating || !!nameError || !name || bdPrefix.length < 2 || !effectiveOrgId || repoLimitReached || !hasTemplate}
            className="px-4 py-2 text-sm bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isCreating ? "Creating..." : "Create Repo"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
