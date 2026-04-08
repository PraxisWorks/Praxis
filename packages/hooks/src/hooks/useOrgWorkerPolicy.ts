import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";

type SerializedOrg = {
  id: string;
  workerPolicy?: string;
  updatedAt: string;
};

/**
 * Hook for reading and updating an organization's worker policy.
 * Invalidates the org cache on mutation success and subscribes to
 * real-time sync events so the UI stays current.
 */
export function useOrgWorkerPolicy(orgId: string) {
  const utils = trpc.useUtils();

  useSyncSubscription<SerializedOrg>(trpc.organization.onSync, {
    onUpdated: () => {
      if (orgId) utils.organization.getById.invalidate({ id: orgId });
    },
  });

  const setWorkerPolicy = trpc.organization.setWorkerPolicy.useMutation({
    onSuccess: () => {
      utils.organization.getById.invalidate({ id: orgId });
    },
  });

  return {
    setWorkerPolicy: setWorkerPolicy.mutateAsync,
    isSettingPolicy: setWorkerPolicy.isPending,
    error: setWorkerPolicy.error?.message ?? null,
  };
}
