import { useState, type FormEvent } from "react";
import { useOrgMembers, useOrgInvitations } from "@praxis2/hooks";
import { useSelectedOrg } from "../contexts/OrgContext.js";
import { Modal } from "./Modal.js";

type OrgMembersPanelProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function OrgMembersPanel({ isOpen, onClose }: OrgMembersPanelProps) {
  const { selectedOrgId, selectedOrg } = useSelectedOrg();
  const {
    members,
    isLoading,
    error,
    addMember,
    updateMemberRole,
    removeMember,
    isAddingMember,
  } = useOrgMembers(selectedOrgId);

  const {
    invitations,
    isLoading: invitationsLoading,
    revokeInvitation,
    resendInvitation,
    isRevoking,
    isResending,
  } = useOrgInvitations(selectedOrgId ?? undefined);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  const canManage = selectedOrg?.role === "owner" || selectedOrg?.role === "admin";

  const handleInvite = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedOrgId || !inviteEmail) return;
    setInviteError(null);
    setInviteSuccess(null);

    try {
      const result = await addMember({ orgId: selectedOrgId, email: inviteEmail, role: inviteRole });
      setInviteEmail("");
      if (result.status === "invited") {
        setInviteSuccess("Invitation sent! They'll receive an email to set up their account.");
      } else {
        setInviteSuccess("Member added successfully.");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to add member";
      setInviteError(message);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`${selectedOrg?.name ?? "Organization"} Members`}>
      {isLoading && (
        <p className="text-sm text-[var(--text-faint)]">Loading members...</p>
      )}

      {error && (
        <p className="text-sm text-red-500 mb-4">{error}</p>
      )}

      {/* Member list */}
      <div className="space-y-2 mb-6 max-h-60 overflow-y-auto">
        {members.map((member) => (
          <div
            key={member.userId}
            className="flex items-center justify-between p-2 rounded bg-[var(--bg-secondary)]"
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
                  className="text-xs border border-[var(--border-secondary)] rounded px-2 py-1 bg-transparent"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              ) : (
                <span className="text-xs text-[var(--text-faint)] capitalize px-2">
                  {member.role}
                </span>
              )}

              {canManage && member.role !== "owner" && (
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

      {/* Pending Invitations */}
      {canManage && invitations.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-[var(--text-primary)] mb-2">
            Pending Invitations
          </h3>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {invitations.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between p-2 rounded bg-[var(--bg-secondary)]"
              >
                <div>
                  <p className="text-sm text-[var(--text-primary)]">{inv.email}</p>
                  <p className="text-xs text-[var(--text-faint)]">
                    {inv.role} · invited by {inv.inviterName} · expires{" "}
                    {new Date(inv.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => resendInvitation({ id: inv.id })}
                    disabled={isResending}
                    className="text-xs text-[var(--accent)] hover:underline cursor-pointer disabled:opacity-50"
                  >
                    Resend
                  </button>
                  <button
                    onClick={() => revokeInvitation({ id: inv.id })}
                    disabled={isRevoking}
                    className="text-xs text-red-500 hover:text-red-700 cursor-pointer disabled:opacity-50"
                  >
                    Revoke
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {canManage && invitations.length === 0 && !invitationsLoading && (
        <p className="text-xs text-[var(--text-faint)] mb-4">No pending invitations.</p>
      )}

      {/* Invite form */}
      {canManage && (
        <>
          <h3 className="text-sm font-medium text-[var(--text-primary)] mb-2">
            Add Member
          </h3>
          {inviteError && (
            <div className="bg-red-50 text-red-600 p-2 rounded mb-2 text-sm">
              {inviteError}
            </div>
          )}
          {inviteSuccess && (
            <div className="bg-green-50 text-green-700 p-2 rounded mb-2 text-sm">
              {inviteSuccess}
            </div>
          )}
          <form onSubmit={handleInvite} className="flex gap-2">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="user@example.com"
              required
              className="flex-1 px-3 py-2 border border-[var(--border-secondary)] rounded text-sm"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as "member" | "admin")}
              className="px-2 py-2 border border-[var(--border-secondary)] rounded text-sm"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="submit"
              disabled={isAddingMember || !inviteEmail}
              className="px-4 py-2 text-sm bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] disabled:opacity-50 cursor-pointer"
            >
              {isAddingMember ? "Adding..." : "Add"}
            </button>
          </form>
        </>
      )}
    </Modal>
  );
}
