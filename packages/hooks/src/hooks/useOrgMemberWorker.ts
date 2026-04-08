import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";

type SerializedOrg = {
  id: string;
  updatedAt: string;
};

/**
 * Hook for reading and updating a member's worker assignment within an org.
 * Queries the current member-worker mapping and provides a mutation to change it.
 * Subscribes to real-time sync so cache stays fresh on external changes.
 */
export function useOrgMemberWorker(orgId: string) {
  const utils = trpc.useUtils();

  const memberWorkerQuery = trpc.organization.getMemberWorker.useQuery(
    { orgId },
    { enabled: !!orgId },
  );

  useSyncSubscription<SerializedOrg>(trpc.organization.onSync, {
    onUpdated: () => {
      if (orgId) utils.organization.getMemberWorker.invalidate({ orgId });
    },
  });

  const setMemberWorker = trpc.organization.setMemberWorker.useMutation({
    onSuccess: () => {
      utils.organization.getMemberWorker.invalidate({ orgId });
    },
  });

  return {
    memberWorker: memberWorkerQuery.data ?? null,
    isLoading: memberWorkerQuery.isLoading,
    setMemberWorker: setMemberWorker.mutateAsync,
    isSettingWorker: setMemberWorker.isPending,
    error:
      memberWorkerQuery.error?.message ??
      setMemberWorker.error?.message ??
      null,
  };
}
