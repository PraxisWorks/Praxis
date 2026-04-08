import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";
import { useAuth0 } from "@auth0/auth0-react";
import type { OrgRole } from "@praxis2/shared";

function useAuth0Safe() {
  try {
    return useAuth0();
  } catch {
    return { isAuthenticated: false };
  }
}

type SerializedOrg = {
  id: string;
  name: string;
  slug: string;
  role: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Hook for the organization list + CRUD + real-time sync.
 */
export function useOrganizations() {
  const { isAuthenticated } = useAuth0Safe();
  const utils = trpc.useUtils();

  const listQuery = trpc.organization.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  useSyncSubscription<SerializedOrg>(trpc.organization.onSync, {
    onCreated: () => utils.organization.list.invalidate(),
    onUpdated: () => utils.organization.list.invalidate(),
    onDeleted: () => utils.organization.list.invalidate(),
  });

  const createMutation = trpc.organization.create.useMutation({
    onSuccess: () => utils.organization.list.invalidate(),
  });

  const updateMutation = trpc.organization.update.useMutation({
    onSuccess: () => utils.organization.list.invalidate(),
  });

  const deleteMutation = trpc.organization.delete.useMutation({
    onSuccess: () => utils.organization.list.invalidate(),
  });

  return {
    organizations: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    error: listQuery.error?.message ?? null,
    createOrg: createMutation.mutateAsync,
    updateOrg: updateMutation.mutateAsync,
    deleteOrg: deleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
  };
}

/**
 * Hook for organization member management.
 */
export function useOrgMembers(orgId: string | null) {
  const utils = trpc.useUtils();

  const membersQuery = trpc.organization.listMembers.useQuery(
    { orgId: orgId! },
    { enabled: !!orgId },
  );

  const addMemberMutation = trpc.organization.addMember.useMutation({
    onSuccess: () => {
      if (orgId) utils.organization.listMembers.invalidate({ orgId });
    },
  });

  const updateRoleMutation = trpc.organization.updateMemberRole.useMutation({
    onSuccess: () => {
      if (orgId) utils.organization.listMembers.invalidate({ orgId });
    },
  });

  const removeMemberMutation = trpc.organization.removeMember.useMutation({
    onSuccess: () => {
      if (orgId) utils.organization.listMembers.invalidate({ orgId });
    },
  });

  const leaveMutation = trpc.organization.leave.useMutation({
    onSuccess: () => utils.organization.list.invalidate(),
  });

  return {
    members: membersQuery.data ?? [],
    isLoading: membersQuery.isLoading,
    error: membersQuery.error?.message ?? null,
    addMember: addMemberMutation.mutateAsync,
    updateMemberRole: updateRoleMutation.mutateAsync,
    removeMember: removeMemberMutation.mutateAsync,
    leaveOrg: leaveMutation.mutateAsync,
    isAddingMember: addMemberMutation.isPending,
  };
}
