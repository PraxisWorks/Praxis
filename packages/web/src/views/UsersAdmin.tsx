import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { trpc, useRoles, useUserPermissions } from "@praxis2/hooks";
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

type OverrideState = "inherit" | "grant" | "deny";

type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl: string | null;
  roleId: string | null;
  lastLoginAt: string | null;
  createdAt: string;
};

/** Convert a date to a relative time string (e.g., '3 days ago'). */
function timeAgo(date: Date | string | null): string {
  if (!date) return "Never";
  const now = new Date();
  const then = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

export function UsersAdmin() {
  const navigate = useNavigate();

  // Fetch all users
  const usersQuery = trpc.admin.listUsers.useQuery();
  const usersList = (usersQuery.data ?? []) as User[];

  // Fetch roles and permissions
  const { roles, allPermissions, isLoading: rolesLoading } = useRoles();

  // Selected user
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const selectedUser = usersList.find((u) => u.id === selectedUserId) ?? null;

  // User permissions hook
  const {
    overrides,
    isLoading: overridesLoading,
    error: overridesError,
    assignRole,
    setOverride,
    removeOverride,
    isAssigning,
  } = useUserPermissions(selectedUserId);

  // User stats
  const statsQuery = trpc.admin.getUserStats.useQuery(
    { userId: selectedUserId! },
    { enabled: !!selectedUserId },
  );

  // Local edit state for role assignment
  const [editRoleId, setEditRoleId] = useState<string | null>(null);

  // Local edit state for overrides: permissionKey -> OverrideState
  const [editOverrides, setEditOverrides] = useState<Record<string, OverrideState>>({});

  // Feedback
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Search filter
  const [searchQuery, setSearchQuery] = useState("");

  // Sync local state when user selection or data changes
  useEffect(() => {
    if (selectedUser) {
      setEditRoleId(selectedUser.roleId);
      setSaveError(null);
      setSaveSuccess(false);
    }
  }, [selectedUserId, selectedUser?.roleId]);

  useEffect(() => {
    if (!selectedUserId) return;
    const overrideMap: Record<string, OverrideState> = {};
    for (const perm of allPermissions) {
      const existing = overrides.find(
        (o: { permissionKey: string; granted: boolean }) => o.permissionKey === perm.key,
      );
      if (existing) {
        overrideMap[perm.key] = existing.granted ? "grant" : "deny";
      } else {
        overrideMap[perm.key] = "inherit";
      }
    }
    setEditOverrides(overrideMap);
  }, [selectedUserId, overrides, allPermissions]);

  // Derive the selected role's base permissions
  const selectedRole = roles.find(
    (r: { id: string; permissions: string[] }) => r.id === editRoleId,
  );
  const rolePermissionSet = new Set(selectedRole?.permissions ?? []);

  // Compute effective permissions
  const effectivePermissions = new Set<string>();
  for (const perm of allPermissions) {
    const overrideState = editOverrides[perm.key] ?? "inherit";
    if (overrideState === "grant") {
      effectivePermissions.add(perm.key);
    } else if (overrideState === "deny") {
      // explicitly denied, do not add
    } else {
      // inherit from role
      if (rolePermissionSet.has(perm.key)) {
        effectivePermissions.add(perm.key);
      }
    }
  }

  const handleSave = async () => {
    if (!selectedUser) return;
    setSaveError(null);
    setSaveSuccess(false);
    setIsSaving(true);
    try {
      // Assign role if changed
      if (editRoleId && editRoleId !== selectedUser.roleId) {
        await assignRole({ userId: selectedUser.id, roleId: editRoleId });
      }

      // Compute override changes
      const currentOverrideMap: Record<string, boolean> = {};
      for (const o of overrides as Array<{ permissionKey: string; granted: boolean }>) {
        currentOverrideMap[o.permissionKey] = o.granted;
      }

      for (const perm of allPermissions) {
        const desired = editOverrides[perm.key] ?? "inherit";
        const hasExisting = perm.key in currentOverrideMap;

        if (desired === "inherit") {
          // Remove override if one exists
          if (hasExisting) {
            await removeOverride({ userId: selectedUser.id, permissionKey: perm.key as Parameters<typeof removeOverride>[0]["permissionKey"] });
          }
        } else {
          const grantedValue = desired === "grant";
          // Set override if new or changed
          if (!hasExisting || currentOverrideMap[perm.key] !== grantedValue) {
            await setOverride({
              userId: selectedUser.id,
              permissionKey: perm.key as Parameters<typeof setOverride>[0]["permissionKey"],
              granted: grantedValue,
            });
          }
        }
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  };

  const cycleOverride = (key: string) => {
    setEditOverrides((prev) => {
      const current = prev[key] ?? "inherit";
      const next: OverrideState =
        current === "inherit" ? "grant" : current === "grant" ? "deny" : "inherit";
      return { ...prev, [key]: next };
    });
  };

  const permissionGroups = groupPermissions(allPermissions);

  const filteredUsers = searchQuery.trim()
    ? usersList.filter(
        (u) =>
          u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          u.email.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : usersList;

  // Helper to get role name by id
  const getRoleName = (roleId: string | null): string => {
    if (!roleId) return "None";
    const role = roles.find((r: { id: string; name: string }) => r.id === roleId);
    return role?.name ?? "Unknown";
  };

  if (usersQuery.isLoading || rolesLoading) {
    return (
      <div className="max-w-[900px] mx-auto py-8">
        <p className="text-sm text-[var(--text-faint)]">Loading users...</p>
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
        <h1 className="text-xl font-bold">User Permissions</h1>
      </div>

      <AdminNav />

      {usersQuery.error && (
        <div className="bg-red-900/20 text-red-400 p-3 rounded mb-4 text-sm">
          {usersQuery.error.message}
        </div>
      )}

      <div className="flex gap-6">
        {/* Users list (left column) */}
        <div className="w-[260px] shrink-0">
          <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg">
            <div className="p-3 border-b border-[var(--border-primary)]">
              <h2 className="text-sm font-semibold mb-2">Users</h2>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search users..."
                className="w-full px-2 py-1.5 text-xs bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded text-[var(--text-primary)] placeholder:text-[var(--text-faint)]"
              />
            </div>
            <div className="max-h-[500px] overflow-y-auto">
              {filteredUsers.map((user) => (
                <button
                  key={user.id}
                  onClick={() => setSelectedUserId(user.id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-[var(--border-primary)] last:border-b-0 cursor-pointer transition-colors ${
                    selectedUserId === user.id
                      ? "bg-[var(--accent-emphasis)]/10"
                      : "hover:bg-[var(--bg-secondary)]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {user.avatarUrl ? (
                      <img
                        src={user.avatarUrl}
                        alt={user.name}
                        className="w-6 h-6 rounded-full shrink-0"
                      />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-[var(--accent)] flex items-center justify-center text-white text-xs font-medium shrink-0">
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-[var(--text-primary)] block truncate">
                        {user.name}
                      </span>
                      <span className="text-xs text-[var(--text-faint)] block truncate">
                        {user.email}
                      </span>
                    </div>
                  </div>
                  <div className="mt-1">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-emphasis)]/20 text-[var(--accent-emphasis)] font-medium leading-none">
                      {getRoleName(user.roleId)}
                    </span>
                  </div>
                  <div className="mt-0.5">
                    {user.lastLoginAt ? (
                      (() => {
                        const lastLogin = new Date(user.lastLoginAt);
                        const daysSince = Math.floor((Date.now() - lastLogin.getTime()) / (1000 * 60 * 60 * 24));
                        const isRecent = daysSince <= 7;
                        return (
                          <span className={`text-[10px] ${isRecent ? "text-green-400" : "text-[var(--text-faint)]"}`}>
                            {isRecent ? `Active ${timeAgo(user.lastLoginAt)}` : `Last seen ${timeAgo(user.lastLoginAt)}`}
                          </span>
                        );
                      })()
                    ) : (
                      <span className="text-[10px] text-yellow-400">Never logged in</span>
                    )}
                  </div>
                </button>
              ))}
              {filteredUsers.length === 0 && (
                <p className="text-sm text-[var(--text-faint)] p-3">No users found.</p>
              )}
            </div>
          </div>
        </div>

        {/* User detail (right column) */}
        <div className="flex-1 min-w-0">
          {selectedUser ? (
            <>
              {/* User info & role assignment */}
              <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-6 mb-6">
                <div className="flex items-center gap-3 mb-4">
                  {selectedUser.avatarUrl ? (
                    <img
                      src={selectedUser.avatarUrl}
                      alt={selectedUser.name}
                      className="w-10 h-10 rounded-full"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-[var(--accent)] flex items-center justify-center text-white text-sm font-medium">
                      {selectedUser.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <h2 className="text-lg font-semibold">{selectedUser.name}</h2>
                    <p className="text-sm text-[var(--text-faint)]">{selectedUser.email}</p>
                  </div>
                </div>

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

                <div>
                  <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1">
                    Assigned Role
                  </label>
                  <select
                    value={editRoleId ?? ""}
                    onChange={(e) => setEditRoleId(e.target.value || null)}
                    className="w-full px-3 py-2 text-sm border border-[var(--border-secondary)] rounded bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                  >
                    <option value="">-- No role --</option>
                    {roles.map((role: { id: string; name: string }) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                  {selectedRole && (
                    <p className="text-xs text-[var(--text-faint)] mt-1">
                      Base permissions from role: {selectedRole.permissions.length}
                    </p>
                  )}
                </div>
              </div>

              {/* User Activity */}
              <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-6 mb-6">
                <h2 className="text-lg font-semibold mb-4">User Activity</h2>
                {statsQuery.isLoading ? (
                  <p className="text-sm text-[var(--text-faint)]">Loading stats...</p>
                ) : statsQuery.error ? (
                  <p className="text-sm text-red-400">{statsQuery.error.message}</p>
                ) : statsQuery.data ? (
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--text-secondary)]">Last Login</span>
                      <span className="text-[var(--text-primary)]">
                        {statsQuery.data.lastLoginAt ? timeAgo(statsQuery.data.lastLoginAt) : "Never"}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--text-secondary)]">Account Created</span>
                      <span className="text-[var(--text-primary)]">
                        {new Date(statsQuery.data.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--text-secondary)]">Total Sessions</span>
                      <span className="text-[var(--text-primary)] font-medium">{statsQuery.data.totalSessions}</span>
                    </div>
                    {Object.keys(statsQuery.data.sessionsByType).length > 0 && (
                      <div>
                        <span className="text-sm text-[var(--text-secondary)] block mb-1.5">Sessions by Type</span>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(statsQuery.data.sessionsByType).map(([type, count]) => (
                            <span
                              key={type}
                              className="text-xs px-2 py-0.5 rounded-full bg-[var(--accent-emphasis)]/10 text-[var(--accent-emphasis)] font-medium"
                            >
                              {type}: {count}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--text-secondary)]">Last Session</span>
                      <span className="text-[var(--text-primary)]">
                        {statsQuery.data.lastSessionAt ? timeAgo(statsQuery.data.lastSessionAt) : "No sessions yet"}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Permission overrides */}
              <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-6 mb-6">
                <h2 className="text-lg font-semibold mb-1">Permission Overrides</h2>
                <p className="text-sm text-[var(--text-muted)] mb-4">
                  Override individual permissions for this user. Overrides take precedence over
                  the assigned role&apos;s base permissions.
                </p>

                {overridesLoading ? (
                  <p className="text-sm text-[var(--text-faint)]">Loading overrides...</p>
                ) : overridesError ? (
                  <div className="bg-red-900/20 text-red-400 p-2 rounded mb-3 text-sm">
                    {overridesError}
                  </div>
                ) : Object.keys(permissionGroups).length === 0 ? (
                  <p className="text-sm text-[var(--text-faint)]">No permissions defined.</p>
                ) : (
                  <div className="space-y-5">
                    {/* Legend */}
                    <div className="flex items-center gap-4 text-xs text-[var(--text-faint)] pb-3 border-b border-[var(--border-primary)]">
                      <div className="flex items-center gap-1.5">
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--text-faint)]/30" />
                        <span>Inherit from role</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" />
                        <span>Granted (override)</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" />
                        <span>Denied (override)</span>
                      </div>
                    </div>

                    {Object.entries(permissionGroups).map(([category, perms]) => (
                      <div key={category}>
                        <h3 className="text-sm font-medium text-[var(--text-secondary)] capitalize mb-2">
                          {category}
                        </h3>
                        <div className="space-y-1">
                          {perms.map((perm) => {
                            const overrideState = editOverrides[perm.key] ?? "inherit";
                            const fromRole = rolePermissionSet.has(perm.key);
                            const effective = effectivePermissions.has(perm.key);

                            return (
                              <div
                                key={perm.key}
                                className="flex items-center gap-3 p-2 rounded hover:bg-[var(--bg-secondary)] transition-colors"
                              >
                                {/* Override toggle button */}
                                <button
                                  onClick={() => cycleOverride(perm.key)}
                                  className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 cursor-pointer border transition-colors ${
                                    overrideState === "grant"
                                      ? "bg-green-500/20 border-green-500/50 text-green-400"
                                      : overrideState === "deny"
                                        ? "bg-red-500/20 border-red-500/50 text-red-400"
                                        : "bg-[var(--bg-tertiary)] border-[var(--border-secondary)] text-[var(--text-faint)]"
                                  }`}
                                  title={`Click to cycle: inherit -> grant -> deny`}
                                >
                                  {overrideState === "grant" ? (
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                  ) : overrideState === "deny" ? (
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  ) : (
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12h-15" />
                                    </svg>
                                  )}
                                </button>

                                {/* Permission info */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm text-[var(--text-primary)] font-mono">
                                      {perm.key}
                                    </span>
                                    {overrideState !== "inherit" && (
                                      <span
                                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium leading-none ${
                                          overrideState === "grant"
                                            ? "bg-green-500/20 text-green-400"
                                            : "bg-red-500/20 text-red-400"
                                        }`}
                                      >
                                        {overrideState === "grant" ? "override: grant" : "override: deny"}
                                      </span>
                                    )}
                                    {overrideState === "inherit" && fromRole && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-emphasis)]/20 text-[var(--accent-emphasis)] font-medium leading-none">
                                        from role
                                      </span>
                                    )}
                                  </div>
                                  {perm.description && (
                                    <p className="text-xs text-[var(--text-faint)] mt-0.5">
                                      {perm.description}
                                    </p>
                                  )}
                                </div>

                                {/* Effective indicator */}
                                <div className="shrink-0" title={effective ? "Effective: allowed" : "Effective: denied"}>
                                  <span
                                    className={`inline-block w-2 h-2 rounded-full ${
                                      effective ? "bg-green-400" : "bg-[var(--text-faint)]/30"
                                    }`}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-5 pt-4 border-t border-[var(--border-primary)]">
                  <button
                    onClick={handleSave}
                    disabled={isSaving || isAssigning}
                    className="px-4 py-2 text-sm bg-[var(--accent-emphasis)] text-white rounded hover:opacity-90 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                  >
                    {isSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </div>

              {/* Effective permissions summary */}
              <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-6">
                <h2 className="text-lg font-semibold mb-1">Effective Permissions</h2>
                <p className="text-sm text-[var(--text-muted)] mb-4">
                  The resolved set of permissions this user will have after overrides are applied.
                </p>
                {effectivePermissions.size === 0 ? (
                  <p className="text-sm text-[var(--text-faint)]">No effective permissions.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from(effectivePermissions)
                      .sort()
                      .map((key) => (
                        <span
                          key={key}
                          className="text-xs font-mono px-2 py-1 rounded bg-green-500/10 text-green-400 border border-green-500/20"
                        >
                          {key}
                        </span>
                      ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-6 text-center">
              <p className="text-sm text-[var(--text-faint)]">
                Select a user from the list to view and manage their permissions.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
