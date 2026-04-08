import { useState, useEffect, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  trpc,
  useOrgMembers,
  useOrgMemberWorker,
  useOrganizations,
  useOrgWorkerPolicy,
  useOrgAiInstructions,
  useOrgSystemInstructions,
  usePermissions,
  useWorkers,
} from "@praxis2/hooks";
import { useSelectedOrg } from "../contexts/OrgContext.js";

type WorkerPolicy = "user_default" | "require_local" | "central_worker";

export function OrgSettings() {
  const navigate = useNavigate();
  const { selectedOrgId, selectedOrg } = useSelectedOrg();
  const { updateOrg, deleteOrg } = useOrganizations();
  const {
    members,
    isLoading,
    error,
    addMember,
    updateMemberRole,
    removeMember,
    isAddingMember,
  } = useOrgMembers(selectedOrgId);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);

  // Worker policy state
  const orgByIdQuery = trpc.organization.getById.useQuery(
    { id: selectedOrgId! },
    { enabled: !!selectedOrgId },
  );
  const orgDetail = orgByIdQuery.data;
  const { setWorkerPolicy, isSettingPolicy, error: policyMutationError } =
    useOrgWorkerPolicy(selectedOrgId ?? "");
  const { workers } = useWorkers();

  const [selectedPolicy, setSelectedPolicy] = useState<WorkerPolicy>("user_default");
  const [selectedCentralWorkerId, setSelectedCentralWorkerId] = useState<string | null>(null);
  const [policySaved, setPolicySaved] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);

  // Member worker assignment state
  const {
    memberWorker,
    isLoading: isMemberWorkerLoading,
    setMemberWorker,
    isSettingWorker,
    error: memberWorkerError,
  } = useOrgMemberWorker(selectedOrgId ?? "");
  const [selectedMemberWorkerId, setSelectedMemberWorkerId] = useState<string | null>(null);
  const [memberWorkerSaved, setMemberWorkerSaved] = useState(false);
  const [memberWorkerSaveError, setMemberWorkerSaveError] = useState<string | null>(null);

  // AI instructions state
  const SESSION_TYPES = ["working", "spec", "architecture", "debug", "repo"] as const;
  const SESSION_TYPE_LABELS: Record<string, string> = {
    working: "Working",
    spec: "Spec",
    architecture: "Architecture",
    debug: "Debug",
    repo: "Repo",
  };
  const {
    instructions: aiInstructions,
    isLoading: isAiInstructionsLoading,
    setAiInstructions,
    isSaving: isAiSaving,
    error: aiError,
  } = useOrgAiInstructions(selectedOrgId ?? "");
  const [activeInstructionTab, setActiveInstructionTab] = useState<string>("working");
  const [instructionDrafts, setInstructionDrafts] = useState<Record<string, string>>({});
  const [aiSaved, setAiSaved] = useState(false);
  const [aiSaveError, setAiSaveError] = useState<string | null>(null);

  // System instructions state
  const {
    data: systemInstructionsData,
    isLoading: isSystemInstructionsLoading,
    setSystemInstructions,
    isSaving: isSystemSaving,
    error: systemError,
  } = useOrgSystemInstructions(selectedOrgId ?? "");
  const [activeSITab, setActiveSITab] = useState<string>("working");
  const [siDrafts, setSiDrafts] = useState<Record<string, string>>({});
  const [siSaved, setSiSaved] = useState(false);
  const [siSaveError, setSiSaveError] = useState<string | null>(null);
  const [siDefaultExpanded, setSiDefaultExpanded] = useState(false);

  // Sync local state when the org data loads or changes
  useEffect(() => {
    if (orgDetail) {
      setSelectedPolicy((orgDetail.workerPolicy as WorkerPolicy) ?? "user_default");
      setSelectedCentralWorkerId(orgDetail.centralWorkerId ?? null);
    }
  }, [orgDetail]);

  // Sync member worker dropdown when assignment loads
  useEffect(() => {
    setSelectedMemberWorkerId(memberWorker?.workerId ?? null);
  }, [memberWorker]);

  // Sync AI instruction drafts when data loads
  useEffect(() => {
    if (aiInstructions) {
      setInstructionDrafts({
        working: aiInstructions.aiInstructionsWorking ?? "",
        spec: aiInstructions.aiInstructionsSpec ?? "",
        architecture: aiInstructions.aiInstructionsArchitecture ?? "",
        debug: aiInstructions.aiInstructionsDebug ?? "",
        repo: aiInstructions.aiInstructionsRepo ?? "",
      });
    }
  }, [aiInstructions]);

  // Sync system instruction drafts when data loads
  useEffect(() => {
    if (systemInstructionsData?.instructions) {
      const inst = systemInstructionsData.instructions;
      setSiDrafts({
        working: inst.working ?? "",
        spec: inst.spec ?? "",
        architecture: inst.architecture ?? "",
        debug: inst.debug ?? "",
        repo: inst.repo ?? "",
      });
    }
  }, [systemInstructionsData]);

  const { hasPermission } = usePermissions();

  const isOwner = selectedOrg?.role === "owner";
  const canManage = isOwner || selectedOrg?.role === "admin";

  if (!selectedOrg) {
    return (
      <div className="max-w-[700px] mx-auto py-8">
        <p className="text-[var(--text-muted)]">No organization selected.</p>
      </div>
    );
  }

  const handleInvite = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedOrgId || !inviteEmail) return;
    setInviteError(null);
    try {
      await addMember({ orgId: selectedOrgId, email: inviteEmail, role: inviteRole });
      setInviteEmail("");
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : "Failed to add member");
    }
  };

  const handleRename = async () => {
    if (!selectedOrgId || !newName.trim()) return;
    setNameError(null);
    try {
      await updateOrg({ id: selectedOrgId, data: { name: newName.trim() } });
      setEditingName(false);
    } catch (err: unknown) {
      setNameError(err instanceof Error ? err.message : "Failed to rename");
    }
  };

  const handleDelete = async () => {
    if (!selectedOrgId) return;
    if (!confirm(`Delete "${selectedOrg.name}"? This cannot be undone.`)) return;
    try {
      await deleteOrg({ id: selectedOrgId });
      navigate("/");
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to delete organization");
    }
  };

  const handleSaveWorkerPolicy = async () => {
    if (!selectedOrgId) return;
    setPolicyError(null);
    setPolicySaved(false);
    try {
      await setWorkerPolicy({
        orgId: selectedOrgId,
        policy: selectedPolicy,
        centralWorkerId: selectedPolicy === "central_worker" ? selectedCentralWorkerId : null,
      });
      setPolicySaved(true);
      setTimeout(() => setPolicySaved(false), 3000);
    } catch (err: unknown) {
      setPolicyError(err instanceof Error ? err.message : "Failed to update worker policy");
    }
  };

  const handleSaveMemberWorker = async () => {
    if (!selectedOrgId) return;
    setMemberWorkerSaveError(null);
    setMemberWorkerSaved(false);
    try {
      await setMemberWorker({ orgId: selectedOrgId, workerId: selectedMemberWorkerId });
      setMemberWorkerSaved(true);
      setTimeout(() => setMemberWorkerSaved(false), 3000);
    } catch (err: unknown) {
      setMemberWorkerSaveError(err instanceof Error ? err.message : "Failed to update worker assignment");
    }
  };

  const handleClearMemberWorker = async () => {
    if (!selectedOrgId) return;
    setMemberWorkerSaveError(null);
    setMemberWorkerSaved(false);
    try {
      await setMemberWorker({ orgId: selectedOrgId, workerId: null });
      setSelectedMemberWorkerId(null);
      setMemberWorkerSaved(true);
      setTimeout(() => setMemberWorkerSaved(false), 3000);
    } catch (err: unknown) {
      setMemberWorkerSaveError(err instanceof Error ? err.message : "Failed to clear worker assignment");
    }
  };

  const handleSaveAiInstructions = async () => {
    if (!selectedOrgId) return;
    setAiSaveError(null);
    setAiSaved(false);
    try {
      const value = instructionDrafts[activeInstructionTab]?.trim() || null;
      await setAiInstructions({
        orgId: selectedOrgId,
        sessionType: activeInstructionTab as "working" | "spec" | "architecture" | "debug" | "repo",
        instructions: value,
      });
      setAiSaved(true);
      setTimeout(() => setAiSaved(false), 3000);
    } catch (err: unknown) {
      setAiSaveError(err instanceof Error ? err.message : "Failed to save instructions");
    }
  };

  const handleSaveSystemInstructions = async () => {
    if (!selectedOrgId) return;
    setSiSaveError(null);
    setSiSaved(false);
    try {
      const draft = siDrafts[activeSITab] ?? "";
      await setSystemInstructions({
        orgId: selectedOrgId,
        sessionType: activeSITab as "working" | "spec" | "architecture" | "debug" | "repo",
        instructions: draft.trim() || null,
      });
      setSiSaved(true);
      setTimeout(() => setSiSaved(false), 3000);
    } catch (err: unknown) {
      setSiSaveError(err instanceof Error ? err.message : "Failed to save");
    }
  };

  const handleResetSystemInstructions = async () => {
    if (!selectedOrgId) return;
    setSiSaveError(null);
    setSiSaved(false);
    try {
      await setSystemInstructions({
        orgId: selectedOrgId,
        sessionType: activeSITab as "working" | "spec" | "architecture" | "debug" | "repo",
        instructions: null,
      });
      setSiDrafts((prev) => ({ ...prev, [activeSITab]: "" }));
      setSiSaved(true);
      setTimeout(() => setSiSaved(false), 3000);
    } catch (err: unknown) {
      setSiSaveError(err instanceof Error ? err.message : "Failed to reset");
    }
  };

  const currentWorkerPolicy = (orgDetail?.workerPolicy as WorkerPolicy) ?? "user_default";

  return (
    <div className="max-w-[700px] mx-auto">
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
        <h1 className="text-xl font-bold">Organization Settings</h1>
      </div>

      {/* General section */}
      <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">General</h2>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1">Name</label>
            {editingName ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded text-[var(--text-primary)]"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                />
                <button
                  onClick={handleRename}
                  className="px-3 py-2 text-sm bg-[var(--accent-emphasis)] text-white rounded hover:opacity-90 cursor-pointer"
                >
                  Save
                </button>
                <button
                  onClick={() => { setEditingName(false); setNameError(null); }}
                  className="px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--text-primary)]">{selectedOrg.name}</span>
                {isOwner && (
                  <button
                    onClick={() => { setNewName(selectedOrg.name); setEditingName(true); }}
                    className="text-xs text-[var(--accent-emphasis)] hover:underline cursor-pointer"
                  >
                    Rename
                  </button>
                )}
              </div>
            )}
            {nameError && <p className="text-xs text-red-400 mt-1">{nameError}</p>}
          </div>

          <div>
            <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1">Slug</label>
            <span className="text-sm text-[var(--text-faint)] font-mono">{selectedOrg.slug}</span>
          </div>

          <div>
            <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1">Your Role</label>
            <span className="text-sm text-[var(--text-primary)] capitalize">{selectedOrg.role}</span>
          </div>
        </div>
      </div>

      {/* Members section */}
      <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">
          Members {!isLoading && <span className="text-[var(--text-faint)] font-normal">({members.length})</span>}
        </h2>

        {isLoading && (
          <p className="text-sm text-[var(--text-faint)]">Loading members...</p>
        )}

        {error && (
          <p className="text-sm text-red-500 mb-4">{error}</p>
        )}

        <div className="space-y-2 mb-6">
          {members.map((member) => (
            <div
              key={member.userId}
              className="flex items-center justify-between p-3 rounded bg-[var(--bg-secondary)]"
            >
              <div className="flex items-center gap-3">
                {member.userAvatarUrl ? (
                  <img
                    src={member.userAvatarUrl}
                    alt={member.userName}
                    className="w-8 h-8 rounded-full"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-[var(--accent)] flex items-center justify-center text-white text-sm font-medium">
                    {member.userName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    {member.userName}
                  </p>
                  <p className="text-xs text-[var(--text-faint)]">{member.userEmail}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {canManage && member.role !== "owner" ? (
                  <select
                    value={member.role}
                    onChange={(e) => {
                      if (selectedOrgId) {
                        updateMemberRole({
                          orgId: selectedOrgId,
                          userId: member.userId,
                          role: e.target.value as "member" | "admin",
                        });
                      }
                    }}
                    className="text-xs border border-[var(--border-secondary)] rounded px-2 py-1 bg-transparent text-[var(--text-primary)]"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                ) : (
                  <span className="text-xs text-[var(--text-faint)] capitalize px-2">
                    {member.role}
                  </span>
                )}

                {(canManage || hasPermission("org:member:remove")) && member.role !== "owner" && (
                  <button
                    onClick={() => {
                      if (selectedOrgId && confirm(`Remove ${member.userName}?`)) {
                        removeMember({ orgId: selectedOrgId, userId: member.userId });
                      }
                    }}
                    className="text-xs text-red-500 hover:text-red-700 cursor-pointer"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Invite form */}
        {(canManage || hasPermission("org:member:invite")) && (
          <>
            <h3 className="text-sm font-medium text-[var(--text-primary)] mb-2">
              Add Member
            </h3>
            {inviteError && (
              <div className="bg-red-900/20 text-red-400 p-2 rounded mb-2 text-sm">
                {inviteError}
              </div>
            )}
            <form onSubmit={handleInvite} className="flex gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="user@example.com"
                required
                className="flex-1 px-3 py-2 border border-[var(--border-secondary)] rounded text-sm bg-[var(--bg-secondary)] text-[var(--text-primary)]"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "member" | "admin")}
                className="px-2 py-2 border border-[var(--border-secondary)] rounded text-sm bg-[var(--bg-secondary)] text-[var(--text-primary)]"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <button
                type="submit"
                disabled={isAddingMember || !inviteEmail}
                className="px-4 py-2 text-sm bg-[var(--accent-emphasis)] text-white rounded hover:opacity-90 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              >
                {isAddingMember ? "Adding..." : "Add"}
              </button>
            </form>
          </>
        )}
      </div>

      {/* Worker Policy section — admin/owner only */}
      {canManage && (
        <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-6 mb-6">
          <h2 className="text-lg font-semibold mb-1">Worker Policy</h2>
          <p className="text-sm text-[var(--text-muted)] mb-4">
            Controls how sessions are routed to workers for this organization.
          </p>

          {(policyError || policyMutationError) && (
            <div className="bg-red-900/20 text-red-400 p-2 rounded mb-4 text-sm">
              {policyError || policyMutationError}
            </div>
          )}

          {policySaved && (
            <div className="bg-green-900/20 text-green-400 p-2 rounded mb-4 text-sm">
              Worker policy updated successfully.
            </div>
          )}

          <div className="space-y-3 mb-4">
            {([
              { value: "user_default", label: "User Default", description: "Each member uses their own active worker." },
              { value: "require_local", label: "Require Local Workers", description: "Members must have an assigned worker for this org." },
              { value: "central_worker", label: "Central Worker", description: "All sessions route through a single shared worker." },
            ] as const).map((option) => (
              <label
                key={option.value}
                className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${
                  selectedPolicy === option.value
                    ? "border-[var(--accent-emphasis)] bg-[var(--accent-emphasis)]/5"
                    : "border-[var(--border-secondary)] bg-[var(--bg-secondary)] hover:border-[var(--border-primary)]"
                }`}
              >
                <input
                  type="radio"
                  name="workerPolicy"
                  value={option.value}
                  checked={selectedPolicy === option.value}
                  onChange={() => setSelectedPolicy(option.value)}
                  className="mt-0.5 accent-[var(--accent-emphasis)]"
                />
                <div>
                  <span className="text-sm font-medium text-[var(--text-primary)]">{option.label}</span>
                  <p className="text-xs text-[var(--text-faint)] mt-0.5">{option.description}</p>
                </div>
              </label>
            ))}
          </div>

          {selectedPolicy === "central_worker" && (
            <div className="mb-4">
              <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1">
                Select Worker
              </label>
              {workers.length === 0 ? (
                <p className="text-sm text-[var(--text-faint)]">
                  No workers available. Register a worker in your profile first.
                </p>
              ) : (
                <select
                  value={selectedCentralWorkerId ?? ""}
                  onChange={(e) => setSelectedCentralWorkerId(e.target.value || null)}
                  className="w-full px-3 py-2 text-sm border border-[var(--border-secondary)] rounded bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                >
                  <option value="">-- Choose a worker --</option>
                  {workers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} {w.status === "online" ? "(online)" : "(offline)"}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          <button
            onClick={handleSaveWorkerPolicy}
            disabled={isSettingPolicy || (selectedPolicy === "central_worker" && !selectedCentralWorkerId)}
            className="px-4 py-2 text-sm bg-[var(--accent-emphasis)] text-white rounded hover:opacity-90 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            {isSettingPolicy ? "Saving..." : "Save Policy"}
          </button>
        </div>
      )}

      {/* Your Worker for This Org — visible when policy is require_local */}
      {currentWorkerPolicy === "require_local" && (
        <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-6 mb-6">
          <h2 className="text-lg font-semibold mb-1">Your Worker for This Org</h2>
          <p className="text-sm text-[var(--text-muted)] mb-4">
            This organization requires each member to use a designated local worker.
          </p>

          {(memberWorkerSaveError || memberWorkerError) && (
            <div className="bg-red-900/20 text-red-400 p-2 rounded mb-4 text-sm">
              {memberWorkerSaveError || memberWorkerError}
            </div>
          )}

          {memberWorkerSaved && (
            <div className="bg-green-900/20 text-green-400 p-2 rounded mb-4 text-sm">
              Worker assignment updated successfully.
            </div>
          )}

          {isMemberWorkerLoading ? (
            <p className="text-sm text-[var(--text-faint)]">Loading assignment...</p>
          ) : (
            <>
              {/* Current assignment display */}
              <div className="mb-4">
                <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1">
                  Current Assignment
                </label>
                {memberWorker ? (
                  <div className="flex items-center gap-2">
                    <span className={`inline-block w-2 h-2 rounded-full ${memberWorker.workerStatus === "online" ? "bg-green-400" : "bg-gray-400"}`} />
                    <span className="text-sm text-[var(--text-primary)]">
                      {memberWorker.workerName}
                    </span>
                    <span className="text-xs text-[var(--text-faint)]">
                      ({memberWorker.workerStatus})
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 p-2 rounded bg-yellow-900/20 border border-yellow-500/30">
                    <svg className="w-4 h-4 text-yellow-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-sm text-yellow-400">
                      Not configured &mdash; you must assign a worker before starting sessions in this org.
                    </span>
                  </div>
                )}
              </div>

              {/* Worker selector */}
              <div className="mb-4">
                <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1">
                  Select Worker
                </label>
                {workers.length === 0 ? (
                  <p className="text-sm text-[var(--text-faint)]">
                    No workers available. Register a worker in your profile first.
                  </p>
                ) : (
                  <select
                    value={selectedMemberWorkerId ?? ""}
                    onChange={(e) => setSelectedMemberWorkerId(e.target.value || null)}
                    className="w-full px-3 py-2 text-sm border border-[var(--border-secondary)] rounded bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                  >
                    <option value="">-- Choose a worker --</option>
                    {workers.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} {w.status === "online" ? "(online)" : "(offline)"}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleSaveMemberWorker}
                  disabled={isSettingWorker || !selectedMemberWorkerId}
                  className="px-4 py-2 text-sm bg-[var(--accent-emphasis)] text-white rounded hover:opacity-90 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  {isSettingWorker ? "Saving..." : "Save"}
                </button>
                {memberWorker && (
                  <button
                    onClick={handleClearMemberWorker}
                    disabled={isSettingWorker}
                    className="px-4 py-2 text-sm text-[var(--text-secondary)] border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-tertiary)] disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                  >
                    Clear
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* System Instructions */}
      {(isOwner || hasPermission("session:instructions:edit")) && (
        <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-6 mb-6">
          <h2 className="text-lg font-semibold mb-1">System Instructions</h2>
          <p className="text-sm text-[var(--text-muted)] mb-2">
            Replace the default AI behavior for each session type. Leave empty to use the built-in defaults.
          </p>
          <div className="bg-amber-900/20 border border-amber-500/30 text-amber-300 p-3 rounded mb-4 text-sm">
            These instructions <strong>replace</strong> the default AI behavior. To add instructions without replacing defaults, use the <em>AI Instructions</em> section below.
          </div>

          {(siSaveError || systemError) && (
            <div className="bg-red-900/20 text-red-400 p-2 rounded mb-4 text-sm">
              {siSaveError || systemError}
            </div>
          )}
          {siSaved && (
            <div className="bg-green-900/20 text-green-400 p-2 rounded mb-4 text-sm">
              System instructions saved.
            </div>
          )}

          {/* Tab strip */}
          <div className="flex gap-1 mb-4 border-b border-[var(--border-primary)]">
            {SESSION_TYPES.map((t) => {
              const hasOverride = !!(siDrafts[t] ?? "").trim();
              return (
                <button
                  key={t}
                  onClick={() => setActiveSITab(t)}
                  className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                    activeSITab === t
                      ? "border-[var(--accent-emphasis)] text-[var(--accent-emphasis)]"
                      : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  {SESSION_TYPE_LABELS[t]}
                  {hasOverride && (
                    <span className="w-2 h-2 rounded-full bg-amber-400" title="Custom override active" />
                  )}
                </button>
              );
            })}
          </div>

          {isSystemInstructionsLoading ? (
            <p className="text-sm text-[var(--text-muted)]">Loading...</p>
          ) : (
            <div>
              {/* Default prompt preview */}
              {systemInstructionsData?.defaults && (
                <div className="mb-3">
                  <button
                    onClick={() => setSiDefaultExpanded((p) => !p)}
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer flex items-center gap-1"
                  >
                    <span className={`transition-transform ${siDefaultExpanded ? "rotate-90" : ""}`}>▶</span>
                    {siDefaultExpanded ? "Hide" : "Show"} built-in default
                  </button>
                  {siDefaultExpanded && (
                    <>
                      <pre className="mt-2 p-3 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded text-xs text-[var(--text-muted)] font-mono whitespace-pre-wrap overflow-auto max-h-40">
                        {(systemInstructionsData.defaults as Record<string, string>)[activeSITab] ?? "No default"}
                      </pre>
                      <p className="mt-1 text-xs text-[var(--text-faint)]">
                        This is the opening behavioral line of the prompt. The rest of the prompt (context, instructions, etc.) is appended automatically and is not affected by this override.
                      </p>
                    </>
                  )}
                </div>
              )}

              <textarea
                value={siDrafts[activeSITab] ?? ""}
                onChange={(e) =>
                  setSiDrafts((prev) => ({
                    ...prev,
                    [activeSITab]: e.target.value,
                  }))
                }
                maxLength={50000}
                className="w-full px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded text-[var(--text-primary)] font-mono resize-y"
                rows={8}
                placeholder={`Custom system instructions for ${SESSION_TYPE_LABELS[activeSITab]} sessions... (replaces default behavior)`}
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-[var(--text-faint)]">
                  {(siDrafts[activeSITab] ?? "").length.toLocaleString()} / 50,000
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={handleResetSystemInstructions}
                    disabled={isSystemSaving || !(siDrafts[activeSITab] ?? "").trim()}
                    className="px-4 py-2 text-sm border border-[var(--border-primary)] text-[var(--text-secondary)] rounded hover:bg-[var(--bg-secondary)] disabled:opacity-50 cursor-pointer"
                  >
                    Reset to Default
                  </button>
                  <button
                    onClick={handleSaveSystemInstructions}
                    disabled={isSystemSaving}
                    className="px-4 py-2 text-sm bg-[var(--accent-emphasis)] text-white rounded hover:opacity-90 disabled:opacity-50 cursor-pointer"
                  >
                    {isSystemSaving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* AI Instructions */}
      {(isOwner || hasPermission("session:instructions:append")) && (
        <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-6 mb-6">
          <h2 className="text-lg font-semibold mb-1">AI Instructions</h2>
          <p className="text-sm text-[var(--text-muted)] mb-4">
            Additional instructions appended to each session. Unlike System Instructions above which replace default behavior, these are added alongside it.
          </p>

          {(aiSaveError || aiError) && (
            <div className="bg-red-900/20 text-red-400 p-2 rounded mb-4 text-sm">
              {aiSaveError || aiError}
            </div>
          )}
          {aiSaved && (
            <div className="bg-green-900/20 text-green-400 p-2 rounded mb-4 text-sm">
              Instructions saved.
            </div>
          )}

          {/* Tab strip */}
          <div className="flex gap-1 mb-4 border-b border-[var(--border-primary)]">
            {SESSION_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setActiveInstructionTab(t)}
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                  activeInstructionTab === t
                    ? "border-[var(--accent-emphasis)] text-[var(--accent-emphasis)]"
                    : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
              >
                {SESSION_TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          {isAiInstructionsLoading ? (
            <p className="text-sm text-[var(--text-muted)]">Loading...</p>
          ) : (
            <div>
              <textarea
                value={instructionDrafts[activeInstructionTab] ?? ""}
                onChange={(e) =>
                  setInstructionDrafts((prev) => ({
                    ...prev,
                    [activeInstructionTab]: e.target.value,
                  }))
                }
                maxLength={10000}
                className="w-full px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded text-[var(--text-primary)] font-mono resize-y"
                rows={8}
                placeholder={`Custom instructions for ${SESSION_TYPE_LABELS[activeInstructionTab]} sessions...`}
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-[var(--text-faint)]">
                  {(instructionDrafts[activeInstructionTab] ?? "").length.toLocaleString()} / 10,000
                </span>
                <button
                  onClick={handleSaveAiInstructions}
                  disabled={isAiSaving}
                  className="px-4 py-2 text-sm bg-[var(--accent-emphasis)] text-white rounded hover:opacity-90 disabled:opacity-50 cursor-pointer"
                >
                  {isAiSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Rig Template Config */}
      {canManage && (
        <RigTemplateConfig orgId={selectedOrgId!} />
      )}

      {/* Danger zone */}
      {(isOwner || hasPermission("org:delete")) && (
        <div className="bg-[var(--bg-primary)] border border-red-500/30 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-red-400 mb-2">Danger Zone</h2>
          <p className="text-sm text-[var(--text-muted)] mb-4">
            Deleting this organization will remove all associated repos and data. This action cannot be undone.
          </p>
          <button
            onClick={handleDelete}
            className="px-4 py-2 text-sm border border-red-500 text-red-500 rounded hover:bg-red-500/10 cursor-pointer"
          >
            Delete Organization
          </button>
        </div>
      )}
    </div>
  );
}

function RigTemplateConfig({ orgId }: { orgId: string }) {
  const templateQuery = trpc.organization.getRigTemplate.useQuery({ orgId });
  const updateMutation = trpc.organization.updateRigTemplate.useMutation();
  const utils = trpc.useUtils();

  const [templateRepo, setTemplateRepo] = useState(templateQuery.data?.templateRepo ?? "");
  const [initScriptsText, setInitScriptsText] = useState(
    (templateQuery.data?.initScripts ?? []).join("\n"),
  );
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (templateQuery.data) {
      setTemplateRepo(templateQuery.data.templateRepo ?? "");
      setInitScriptsText((templateQuery.data.initScripts ?? []).join("\n"));
    }
  }, [templateQuery.data]);

  const handleSave = async () => {
    setSaveError(null);
    setSaved(false);
    try {
      const scripts = initScriptsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      await updateMutation.mutateAsync({
        orgId,
        templateRepo: templateRepo.trim() || null,
        initScripts: scripts.length ? scripts : null,
      });
      await utils.organization.getRigTemplate.invalidate({ orgId });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Failed to save template config");
    }
  };

  if (templateQuery.isLoading) {
    return <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-6">Loading template config...</div>;
  }

  return (
    <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-6">
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Rig Template Config</h2>
      <p className="text-sm text-[var(--text-muted)] mb-4">
        Configure the GitHub template repo and init scripts for new rigs in this organization.
      </p>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
            Template Repository (owner/repo)
          </label>
          <input
            type="text"
            value={templateRepo}
            onChange={(e) => setTemplateRepo(e.target.value)}
            placeholder="e.g. my-org/my-template"
            className="w-full px-3 py-2 text-sm border border-[var(--border-primary)] rounded bg-[var(--bg-secondary)] text-[var(--text-primary)]"
          />
          <p className="text-xs text-[var(--text-faint)] mt-1">Leave empty to use server defaults.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
            Init Scripts (one per line)
          </label>
          <textarea
            value={initScriptsText}
            onChange={(e) => setInitScriptsText(e.target.value)}
            placeholder="./scripts/init.sh"
            rows={3}
            className="w-full px-3 py-2 text-sm border border-[var(--border-primary)] rounded bg-[var(--bg-secondary)] text-[var(--text-primary)] font-mono"
          />
          <p className="text-xs text-[var(--text-faint)] mt-1">Each script must start with ./scripts/ and contain no '..' segments.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="px-4 py-2 text-sm bg-[var(--accent-emphasis)] text-white rounded hover:opacity-90 disabled:opacity-50 cursor-pointer"
          >
            {updateMutation.isPending ? "Saving..." : "Save"}
          </button>
          {saved && <span className="text-sm text-green-500">Saved!</span>}
          {saveError && <span className="text-sm text-red-500">{saveError}</span>}
        </div>
      </div>
    </div>
  );
}
