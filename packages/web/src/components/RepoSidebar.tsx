import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";

import { useNavigate, useLocation } from "react-router-dom";
import { useRepos, useOrganizations, usePermissions, useLimits } from "@praxis2/hooks";
import { useSelectedRepo } from "../contexts/RepoContext.js";
import { useSelectedOrg } from "../contexts/OrgContext.js";
import { OrgSection } from "./OrgSection.js";
import { UserProfileFooter } from "./UserProfileFooter.js";

const STORAGE_KEY_COLLAPSED = "praxis:org-collapsed";
const STORAGE_KEY_ORDER = "praxis:org-order";

function loadCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_COLLAPSED) ?? "{}");
  } catch {
    return {};
  }
}

function loadOrder(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_ORDER) ?? "[]");
  } catch {
    return [];
  }
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

type RepoSidebarProps = {
  onNewRepo: () => void;
  onAddRepo: () => void;
};

export function RepoSidebar({ onNewRepo, onAddRepo }: RepoSidebarProps) {
  const { selectedRepoId } = useSelectedRepo();
  const { organizations, setSelectedOrgId } = useSelectedOrg();
  const { repos, isLoading, error } = useRepos();
  const navigate = useNavigate();
  const location = useLocation();
  const { createOrg, isCreating: isCreatingOrg } = useOrganizations();
  const { hasPermission } = usePermissions();
  const { isAtLimit } = useLimits();
  const orgLimitReached = isAtLimit("orgMemberships");

  // Collapse state per org (persisted to localStorage)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed);
  const toggleCollapse = useCallback((orgId: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [orgId]: !prev[orgId] };
      localStorage.setItem(STORAGE_KEY_COLLAPSED, JSON.stringify(next));
      return next;
    });
  }, []);

  // Org ordering (persisted to localStorage)
  const [orgOrder, setOrgOrder] = useState<string[]>(loadOrder);

  // Sorted orgs — respect saved order, put unknowns at end in original order
  const sortedOrgs = useMemo(() => {
    const orderMap = new Map(orgOrder.map((id, i) => [id, i]));
    return [...organizations].sort((a, b) => {
      const ai = orderMap.get(a.id) ?? Infinity;
      const bi = orderMap.get(b.id) ?? Infinity;
      if (ai === Infinity && bi === Infinity) return 0;
      return ai - bi;
    });
  }, [organizations, orgOrder]);

  // Group repos by orgId
  const reposByOrg = useMemo(() => {
    const map = new Map<string, typeof repos>();
    for (const repo of repos) {
      const list = map.get(repo.orgId) ?? [];
      list.push(repo);
      map.set(repo.orgId, list);
    }
    return map;
  }, [repos]);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = sortedOrgs.findIndex((o) => o.id === active.id);
    const newIndex = sortedOrgs.findIndex((o) => o.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(sortedOrgs.map((o) => o.id), oldIndex, newIndex);
    setOrgOrder(reordered);
    localStorage.setItem(STORAGE_KEY_ORDER, JSON.stringify(reordered));
  }

  // Create org inline
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCreatingNew && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [isCreatingNew]);

  async function handleCreate() {
    if (!newName.trim() || !newSlug.trim()) return;
    setCreateError(null);
    try {
      const org = await createOrg({ name: newName.trim(), slug: newSlug.trim() });
      setSelectedOrgId(org.id);
      setNewName("");
      setNewSlug("");
      setSlugEdited(false);
      setIsCreatingNew(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create organization");
    }
  }

  function resetCreateForm() {
    setIsCreatingNew(false);
    setNewName("");
    setNewSlug("");
    setSlugEdited(false);
    setCreateError(null);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with action buttons */}
      <div className="p-3 border-b border-[var(--border-primary)]">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Repos</h2>
          <div className="flex gap-1">
            {hasPermission("repo:create") && (
              <button
                onClick={onNewRepo}
                className="px-2 py-1 text-xs bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] cursor-pointer"
              >
                + New
              </button>
            )}
            {hasPermission("repo:add") && (
              <button
                onClick={onAddRepo}
                className="px-2 py-1 text-xs border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-secondary)] cursor-pointer"
              >
                + Add
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable org sections + repo list */}
      <nav className="flex-1 overflow-y-auto p-2">
        {/* "All Repos" option */}
        <button
          onClick={() => navigate(location.pathname)}
          className={`w-full text-left px-3 py-2 rounded text-sm flex items-center gap-2 cursor-pointer mb-2 ${
            selectedRepoId === null
              ? "bg-[var(--accent-light)] text-[var(--accent-emphasis)] font-medium"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
          }`}
        >
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--text-faint)] shrink-0" />
          All Repos
        </button>

        {isLoading && (
          <p className="px-3 py-2 text-xs text-[var(--text-faint)]">Loading...</p>
        )}
        {error && (
          <p className="px-3 py-2 text-xs text-red-500">{error}</p>
        )}

        {/* Org sections (draggable) */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={sortedOrgs.map((o) => o.id)}
            strategy={verticalListSortingStrategy}
          >
            {sortedOrgs.map((org) => (
              <OrgSection
                key={org.id}
                org={org}
                repos={reposByOrg.get(org.id) ?? []}
                isCollapsed={!!collapsed[org.id]}
                onToggleCollapse={() => toggleCollapse(org.id)}
              />
            ))}
          </SortableContext>
        </DndContext>

        {!isLoading && repos.length === 0 && organizations.length > 0 && (
          <p className="px-3 py-4 text-xs text-[var(--text-faint)] text-center">
            No repos yet. Create one to get started.
          </p>
        )}

        {/* Create new organization — always at bottom */}
        <div className="mt-2 border-t border-[var(--border-primary)] pt-2">
          {isCreatingNew ? (
            <div className="px-2 space-y-2">
              <input
                ref={nameInputRef}
                type="text"
                placeholder="Organization name"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  if (!slugEdited) setNewSlug(toSlug(e.target.value));
                }}
                className="w-full px-2 py-1.5 text-sm bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded text-[var(--text-primary)] placeholder:text-[var(--text-faint)]"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
              <input
                type="text"
                placeholder="slug"
                value={newSlug}
                onChange={(e) => {
                  setNewSlug(e.target.value);
                  setSlugEdited(true);
                }}
                className="w-full px-2 py-1.5 text-sm bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded text-[var(--text-primary)] placeholder:text-[var(--text-faint)] font-mono"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
              {createError && (
                <p className="text-xs text-red-400">{createError}</p>
              )}
              {orgLimitReached && (
                <p className="text-xs text-red-400">Organization limit reached.</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleCreate}
                  disabled={isCreatingOrg || !newName.trim() || !newSlug.trim() || orgLimitReached}
                  className="flex-1 px-2 py-1.5 text-sm bg-[var(--accent-emphasis)] text-white rounded hover:opacity-90 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  {isCreatingOrg ? "Creating..." : "Create"}
                </button>
                <button
                  onClick={resetCreateForm}
                  className="px-2 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setIsCreatingNew(true)}
              disabled={orgLimitReached}
              className="w-full text-left px-3 py-2 text-sm text-[var(--text-faint)] hover:text-[var(--accent-emphasis)] hover:bg-[var(--bg-tertiary)] rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {orgLimitReached ? "Organization limit reached" : "+ New Organization"}
            </button>
          )}
        </div>
      </nav>

      {/* User profile footer */}
      <UserProfileFooter />
    </div>
  );
}
