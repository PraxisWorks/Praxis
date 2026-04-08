import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";

type SerializedApiKey = {
  id: string;
  userId: string;
  label: string;
  keyLastFour: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Hook for API key list + mutations + real-time sync.
 * Components call this to manage BYOK API keys.
 */
export function useApiKeys() {
  const utils = trpc.useUtils();

  const listQuery = trpc.apiKey.list.useQuery();

  useSyncSubscription<SerializedApiKey>(trpc.apiKey.onSync, {
    onCreated: () => {
      utils.apiKey.list.invalidate();
    },
    onUpdated: () => {
      utils.apiKey.list.invalidate();
    },
    onDeleted: () => {
      utils.apiKey.list.invalidate();
    },
  });

  const createMutation = trpc.apiKey.create.useMutation({
    onSuccess: () => {
      utils.apiKey.list.invalidate();
    },
  });

  const deleteMutation = trpc.apiKey.delete.useMutation({
    onSuccess: () => {
      utils.apiKey.list.invalidate();
    },
  });

  return {
    apiKeys: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    error: listQuery.error,
    createKey: createMutation.mutateAsync,
    deleteKey: deleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
