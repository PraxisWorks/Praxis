import { trpc } from "../trpc.js";

export function useOrgInvitations(orgId: string | undefined) {
  const utils = trpc.useUtils();

  const listQuery = trpc.invitation.list.useQuery(
    { orgId: orgId! },
    { enabled: !!orgId },
  );

  const revokeMutation = trpc.invitation.revoke.useMutation({
    onSuccess: () => {
      if (orgId) utils.invitation.list.invalidate({ orgId });
    },
  });

  const resendMutation = trpc.invitation.resend.useMutation({
    onSuccess: () => {
      if (orgId) utils.invitation.list.invalidate({ orgId });
    },
  });

  return {
    invitations: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    error: listQuery.error?.message ?? null,
    revokeInvitation: revokeMutation.mutateAsync,
    resendInvitation: resendMutation.mutateAsync,
    isRevoking: revokeMutation.isPending,
    isResending: resendMutation.isPending,
  };
}
