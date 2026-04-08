import { useState, useEffect, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useRoles } from "@praxis2/hooks";
import { AdminNav } from "../components/AdminNav.js";

/** Group permission keys by their prefix (org, session, worker, admin). */
function groupPermissions(
  permissions: Array<{ key: string; category: string; description: string | null }>,
): Record<string, Array<{ key: string; category: string; description: string | null }>> {
  const groups: Record<string, Array<{ key: string; category: string; description: string | null }>> = {};
  for (const perm of permissions) {
    const prefix = perm.category || perm.key.split(":")[0];
    if (!groups[prefix]) groups[prefix] = [];
    groups[prefix].push(perm);
  }
  return groups;
}

type Role = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  maxActiveSessions: number | null;
  maxOrgMemberships: number | null;
  maxReposPerOrg: number | null;
  maxIdeasPerRepo: number | null;
  maxWorkers: number | null;
};

export function RolesAdmin() {
  const navigate = useNavigate();
  const {
    roles,
    allPermissions,
    isLoading,
    error,
    createRole,
    updateRole,
    deleteRole,
    setRolePermissions,
    isCreating,
    isUpdating,
    isDeleting,
    defaultRole,
    setDefaultRole,
    isSettingDefault,
  } = useRoles();

  // Selected role
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);

  // Edit form state
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPermissions, setEditPermissions] = useState<Set<string>>(new Set());
  const [editMaxActiveSessions, setEditMaxActiveSessions] = useState<number | null>(null);
  const [editMaxOrgMemberships, setEditMaxOrgMemberships] = useState<number | null>(null);
  const [editMaxReposPerOrg, setEditMaxReposPerOrg] = useState<number | null>(null);
  const [editMaxIdeasPerRepo, setEditMaxIdeasPerRepo] = useState<number | null>(null);
  const [editMaxWorkers, setEditMaxWorkers] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Create form state
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const selectedRole = roles.find((r: Role) => r.id === selectedRoleId) ?? null;

  // Sync edit form when selected role changes
  useEffect(() => {
    if (selectedRole) {
      setEditName(selectedRole.name);
      setEditDescription(selectedRole.description ?? "");
      setEditPermissions(new Set(selectedRole.permissions));
      setEditMaxActiveSessions(selectedRole.maxActiveSessions ?? null);
      setEditMaxOrgMemberships(selectedRole.maxOrgMemberships ?? null);
      setEditMaxReposPerOrg(selectedRole.maxReposPerOrg ?? null);
      setEditMaxIdeasPerRepo(selectedRole.maxIdeasPerRepo ?? null);
      setEditMaxWorkers(selectedRole.maxWorkers ?? null);
      setSaveError(null);
      setSaveSuccess(false);
    }
  }, [selectedRoleId, selectedRole?.name, selectedRole?.description, selectedRole?.permissions?.join(",")]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreateError(null);
    try {
      const created = await createRole({
        name: newName.trim(),
        description: newDescription.trim() || undefined,
      });
      setNewName("");
      setNewDescription("");
      setShowCreate(false);
      setSelectedRoleId(created.id);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Failed to create role");
    }
  };

  const handleSave = async () => {
    if (!selectedRole) return;
    setSaveError(null);
    setSaveSuccess(false);
    setIsSaving(true);
    try {
      // Update name/description/limits if changed (name/desc skip for system roles)
      {
        const nameChanged = !selectedRole.isSystem && editName.trim() !== selectedRole.name;
        const descChanged = !selectedRole.isSystem && (editDescription.trim() || null) !== (selectedRole.description ?? null);
        const limitsChanged =
          editMaxActiveSessions !== (selectedRole.maxActiveSessions ?? null) ||
          editMaxOrgMemberships !== (selectedRole.maxOrgMemberships ?? null) ||
          editMaxReposPerOrg !== (selectedRole.maxReposPerOrg ?? null) ||
          editMaxIdeasPerRepo !== (selectedRole.maxIdeasPerRepo ?? null) ||
          editMaxWorkers !== (selectedRole.maxWorkers ?? null);

        if (nameChanged || descChanged || limitsChanged) {
          await updateRole({
            id: selectedRole.id,
            ...(!selectedRole.isSystem && { name: editName.trim() }),
            ...(!selectedRole.isSystem && { description: editDescription.trim() || undefined }),
            maxActiveSessions: editMaxActiveSessions,
            maxOrgMemberships: editMaxOrgMemberships,
            maxReposPerOrg: editMaxReposPerOrg,
            maxIdeasPerRepo: editMaxIdeasPerRepo,
            maxWorkers: editMaxWorkers,
          });
        }
      }

      // Update permissions
      const currentPerms = new Set(selectedRole.permissions);
      const permsChanged =
        editPermissions.size !== currentPerms.size ||
        [...editPermissions].some((k) => !currentPerms.has(k));

      if (permsChanged) {
        await setRolePermissions({
          roleId: selectedRole.id,
          permissionKeys: [...editPermissions] as Parameters<typeof setRolePermissions>[0]["permissionKeys"],
        });
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedRole || selectedRole.isSystem) return;
    if (!confirm(`Delete role "${selectedRole.name}"? This cannot be undone.`)) return;
    try {
      await deleteRole({ id: selectedRole.id });
      setSelectedRoleId(null);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Failed to delete role");
    }
  };

  const togglePermission = (key: string) => {
    setEditPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const permissionGroups = groupPermissions(allPermissions);

  if (isLoading) {
    return (
      <div className="max-w-[900px] mx-auto py-8">
        <p className="text-sm text-[var(--text-faint)]">Loading roles...</p>
      </div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="text-[var(--text-faint)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-xl font-bold">Roles &amp; Permissions</h1>
      </div>

      <AdminNav />

      {error && (
        <div className="bg-red-900/20 text-red-400 p-3 rounded mb-4 text-sm">{error}</div>
      )}

      <div className="flex gap-6">
        {/* Roles list (left column) */}
        <div className="w-[260px] shrink-0">
          <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg">
            <div className="flex items-center justify-between p-3 border-b border-[var(--border-primary)]">
              <h2 className="text-sm font-semibold">Roles</h2>
              <button
                onClick={() => { setShowCreate(true); setCreateError(null); }}
                className="text-xs text-[var(--accent-emphasis)] hover:underline cursor-pointer"
              >
                + New
              </button>
            </div>
            <div className="max-h-[500px] overflow-y-auto">
              {roles.map((role: Role) => (
                <button
                  key={role.id}
                  onClick={() => setSelectedRoleId(role.id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-[var(--border-primary)] last:border-b-0 cursor-pointer transition-colors ${
                    selectedRoleId === role.id
                      ? "bg-[var(--accent-emphasis)]/10"
                      : "hover:bg-[var(--bg-secondary)]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      {role.name}
                    </span>
                    {role.isSystem && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-emphasis)]/20 text-[var(--accent-emphasis)] font-medium leading-none">
                        system
                      </span>
                    )}
                    {role.id === defaultRole?.id && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 font-medium leading-none">
                        default
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-faint)] mt-0.5">
                    {role.permissions.length} permission{role.permissions.length !== 1 ? "s" : ""}
                  </p>
                </button>
              ))}
              {roles.length === 0 && (
                <p className="text-sm text-[var(--text-faint)] p-3">No roles found.</p>
              )}
            </div>
          </div>
        </div>

        {/* Role detail (right column) */}
        <div className="flex-1 min-w-0">
          {/* Create role form */}
          {showCreate && (
            <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-6 mb-6">
              <h2 className="text-lg font-semibold mb-4">Create Role</h2>
              {createError && (
                <div className="bg-red-900/20 text-red-400 p-2 rounded mb-3 text-sm">
                  {createError}
                </div>
              )}
              <form onSubmit={handleCreate} className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1">
                    Name
                  </label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Viewer"
                    required
                    className="w-full px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded text-[var(--text-primary)]"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="Optional description"
                    className="w-full px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded text-[var(--text-primary)]"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={isCreating || !newName.trim()}
                    className="px-4 py-2 text-sm bg-[var(--accent-emphasis)] text-white rounded hover:opacity-90 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                  >
                    {isCreating ? "Creating..." : "Create"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowCreate(false); setNewName(""); setNewDescription(""); }}
                    className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Selected role detail */}
          {selectedRole ? (
            <>
              {/* Name & Description */}
              <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-6 mb-6">
                <h2 className="text-lg font-semibold mb-4">Role Details</h2>

                {saveError && (
                  <div className="bg-red-900/20 text-red-400 p-2 rounded mb-3 text-sm">
                    {saveError}
                  </div>
                )}
                {saveSuccess && (
                  <div className="bg-green-900/20 text-green-400 p-2 rounded mb-3 text-sm">
                    Changes saved successfully.
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1">
                      Name
                    </label>
                    {selectedRole.isSystem ? (
                      <span className="text-sm text-[var(--text-primary)]">{selectedRole.name}</span>
                    ) : (
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded text-[var(--text-primary)]"
                      />
                    )}
                  </div>
                  <div>
                    <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1">
                      Description
                    </label>
                    {selectedRole.isSystem ? (
                      <span className="text-sm text-[var(--text-faint)]">
                        {selectedRole.description || "No description"}
                      </span>
                    ) : (
                      <input
                        type="text"
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        placeholder="Optional description"
                        className="w-full px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded text-[var(--text-primary)]"
                      />
                    )}
                  </div>
                  {selectedRole.isSystem && (
                    <p className="text-xs text-[var(--text-faint)] italic">
                      System roles cannot be renamed or deleted.
                    </p>
                  )}
                </div>
              </div>

              {/* Permissions */}
              <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-6 mb-6">
                <h2 className="text-lg font-semibold mb-4">Permissions</h2>

                {Object.keys(permissionGroups).length === 0 ? (
                  <p className="text-sm text-[var(--text-faint)]">No permissions defined.</p>
                ) : (
                  <div className="space-y-5">
                    {Object.entries(permissionGroups).map(([category, perms]) => (
                      <div key={category}>
                        <h3 className="text-sm font-medium text-[var(--text-secondary)] capitalize mb-2">
                          {category}
                        </h3>
                        <div className="space-y-1.5">
                          {perms.map((perm) => (
                            <label
                              key={perm.key}
                              className="flex items-start gap-2.5 p-2 rounded hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors"
                            >
                              <input
                                type="checkbox"
                                checked={editPermissions.has(perm.key)}
                                onChange={() => togglePermission(perm.key)}
                                className="mt-0.5 accent-[var(--accent-emphasis)]"
                              />
                              <div>
                                <span className="text-sm text-[var(--text-primary)] font-mono">
                                  {perm.key}
                                </span>
                                {perm.description && (
                                  <p className="text-xs text-[var(--text-faint)] mt-0.5">
                                    {perm.description}
                                  </p>
                                )}
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-5 pt-4 border-t border-[var(--border-primary)]">
                  <div className="flex gap-2">
                    <button
                      onClick={handleSave}
                      disabled={isSaving || isUpdating}
                      className="px-4 py-2 text-sm bg-[var(--accent-emphasis)] text-white rounded hover:opacity-90 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                    >
                      {isSaving ? "Saving..." : "Save Changes"}
                    </button>
                    {selectedRole && selectedRole.id !== defaultRole?.id && (
                      <button
                        onClick={() => setDefaultRole({ roleId: selectedRole.id })}
                        disabled={isSettingDefault}
                        className="px-4 py-2 text-sm border border-green-500 text-green-500 rounded hover:bg-green-500/10 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                      >
                        {isSettingDefault ? "Setting..." : "Set as Default"}
                      </button>
                    )}
                    {selectedRole && selectedRole.id === defaultRole?.id && (
                      <button
                        onClick={() => setDefaultRole({ roleId: null })}
                        disabled={isSettingDefault}
                        className="px-4 py-2 text-sm border border-[var(--border-primary)] text-[var(--text-secondary)] rounded hover:bg-[var(--bg-tertiary)] disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                      >
                        {isSettingDefault ? "Removing..." : "Remove Default"}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Limits */}
              <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-6 mb-6">
                <h3 className="text-lg font-semibold mb-4 text-[var(--text-primary)]">Limits</h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1">
                      Max Active Sessions
                    </label>
                    <input
                      type="number"
                      min={0}
                      placeholder="Unlimited"
                      value={editMaxActiveSessions ?? ""}
                      onChange={(e) => setEditMaxActiveSessions(e.target.value === "" ? null : Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)]"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1">
                      Max Org Memberships
                    </label>
                    <input
                      type="number"
                      min={0}
                      placeholder="Unlimited"
                      value={editMaxOrgMemberships ?? ""}
                      onChange={(e) => setEditMaxOrgMemberships(e.target.value === "" ? null : Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)]"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1">
                      Max Repos Per Org
                    </label>
                    <input
                      type="number"
                      min={0}
                      placeholder="Unlimited"
                      value={editMaxReposPerOrg ?? ""}
                      onChange={(e) => setEditMaxReposPerOrg(e.target.value === "" ? null : Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)]"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1">
                      Max Ideas Per Repo
                    </label>
                    <input
                      type="number"
                      min={0}
                      placeholder="Unlimited"
                      value={editMaxIdeasPerRepo ?? ""}
                      onChange={(e) => setEditMaxIdeasPerRepo(e.target.value === "" ? null : Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)]"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1">
                      Max Workers
                    </label>
                    <input
                      type="number"
                      min={0}
                      placeholder="Unlimited"
                      value={editMaxWorkers ?? ""}
                      onChange={(e) => setEditMaxWorkers(e.target.value === "" ? null : Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)]"
                    />
                  </div>
                </div>
              </div>

              {/* Danger zone — non-system only */}
              {!selectedRole.isSystem && (
                <div className="bg-[var(--bg-primary)] border border-red-500/30 rounded-lg p-6">
                  <h2 className="text-lg font-semibold text-red-400 mb-2">Danger Zone</h2>
                  <p className="text-sm text-[var(--text-muted)] mb-4">
                    Deleting this role will unassign it from any users who have it. This action cannot be undone.
                  </p>
                  <button
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className="px-4 py-2 text-sm border border-red-500 text-red-500 rounded hover:bg-red-500/10 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                  >
                    {isDeleting ? "Deleting..." : "Delete Role"}
                  </button>
                </div>
              )}
            </>
          ) : (
            !showCreate && (
              <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-6 text-center">
                <p className="text-sm text-[var(--text-faint)]">
                  Select a role from the list to view and edit its permissions.
                </p>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
