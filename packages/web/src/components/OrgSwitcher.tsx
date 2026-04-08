import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSelectedOrg } from "../contexts/OrgContext.js";
import { useOrganizations, useLimits } from "@praxis2/hooks";

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export function OrgSwitcher() {
  const { selectedOrg, organizations, setSelectedOrgId } = useSelectedOrg();
  const { createOrg, isCreating } = useOrganizations();
  const { isAtLimit } = useLimits();
  const orgLimitReached = isAtLimit("orgMemberships");
  const [isOpen, setIsOpen] = useState(false);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const canManage = selectedOrg?.role === "owner" || selectedOrg?.role === "admin";

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsCreatingNew(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus name input when creating
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
      setIsOpen(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create organization");
    }
  }

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex-1 min-w-0 px-3 py-2 text-sm font-medium text-[var(--text-primary)] flex items-center justify-between hover:bg-[var(--bg-tertiary)] rounded cursor-pointer"
        >
          <span className="truncate">{selectedOrg?.name ?? "Select Org"}</span>
          <svg
          className={`w-4 h-4 ml-1 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
        </button>
        {canManage && (
          <button
            onClick={() => navigate(`/org/settings?org=${selectedOrg.id}`)}
            className="p-2 text-[var(--text-faint)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded cursor-pointer"
            title="Manage members"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        )}
      </div>

      {isOpen && (
        <div className="absolute left-0 right-0 mt-1 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded shadow-lg z-50 max-h-80 overflow-y-auto">
          {organizations.map((org) => (
            <button
              key={org.id}
              onClick={() => {
                setSelectedOrgId(org.id);
                setIsOpen(false);
                setIsCreatingNew(false);
              }}
              className={`w-full text-left px-3 py-2 text-sm cursor-pointer hover:bg-[var(--bg-tertiary)] ${
                org.id === selectedOrg?.id
                  ? "bg-[var(--accent-light)] text-[var(--accent-emphasis)] font-medium"
                  : "text-[var(--text-secondary)]"
              }`}
            >
              <span className="block truncate">{org.name}</span>
              <span className="text-xs text-[var(--text-faint)]">{org.role}</span>
            </button>
          ))}

          <div className="border-t border-[var(--border-primary)]">
            {isCreatingNew ? (
              <div className="p-3 space-y-2">
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
                    disabled={isCreating || !newName.trim() || !newSlug.trim() || orgLimitReached}
                    className="flex-1 px-2 py-1.5 text-sm bg-[var(--accent-emphasis)] text-white rounded hover:opacity-90 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                  >
                    {isCreating ? "Creating..." : "Create"}
                  </button>
                  <button
                    onClick={() => {
                      setIsCreatingNew(false);
                      setNewName("");
                      setNewSlug("");
                      setSlugEdited(false);
                      setCreateError(null);
                    }}
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
                className="w-full text-left px-3 py-2 text-sm text-[var(--accent-emphasis)] hover:bg-[var(--bg-tertiary)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {orgLimitReached ? "Organization limit reached" : "+ New Organization"}
              </button>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
