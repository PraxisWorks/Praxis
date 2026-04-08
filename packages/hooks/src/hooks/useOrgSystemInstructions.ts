import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";

type SerializedOrg = {
  id: string;
  updatedAt: string;
};

/**
 * Hook for reading and updating an organization's system instructions.
 * Fetches instructions and defaults, and provides a mutation to update them.
 * Subscribes to real-time sync events.
 */
export function useOrgSystemInstructions(orgId: string) {
  const utils = trpc.useUtils();

  const query = trpc.organization.getSystemInstructions.useQuery(
    { orgId },
    { enabled: !!orgId },
  );

  useSyncSubscription<SerializedOrg>(trpc.organization.onSync, {
    onUpdated: () => {
      if (orgId) {
        utils.organization.getSystemInstructions.invalidate({ orgId });
      }
    },
  });

  const mutation = trpc.organization.setSystemInstructions.useMutation({
    onSuccess: () => {
      utils.organization.getSystemInstructions.invalidate({ orgId });
    },
  });

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    setSystemInstructions: mutation.mutateAsync,
    isSaving: mutation.isPending,
    error: mutation.error?.message ?? null,
  };
}
