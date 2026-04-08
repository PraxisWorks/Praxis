import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";

type SerializedOrg = {
  id: string;
  updatedAt: string;
};

/**
 * Hook for reading and updating an organization's AI instructions.
 * Fetches all 5 instruction fields and provides a mutation to update
 * individual session types. Subscribes to real-time sync events.
 */
export function useOrgAiInstructions(orgId: string) {
  const utils = trpc.useUtils();

  const query = trpc.organization.getAiInstructions.useQuery(
    { orgId },
    { enabled: !!orgId },
  );

  useSyncSubscription<SerializedOrg>(trpc.organization.onSync, {
    onUpdated: () => {
      if (orgId) {
        utils.organization.getAiInstructions.invalidate({ orgId });
      }
    },
  });

  const mutation = trpc.organization.setAiInstructions.useMutation({
    onSuccess: () => {
      utils.organization.getAiInstructions.invalidate({ orgId });
    },
  });

  return {
    instructions: query.data ?? null,
    isLoading: query.isLoading,
    setAiInstructions: mutation.mutateAsync,
    isSaving: mutation.isPending,
    error: mutation.error?.message ?? null,
  };
}
