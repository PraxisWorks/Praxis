import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";

type SerializedIdea = {
  id: string;
  repoId: string;
  userId: string;
  title: string;
  description: string;
  status: string;
  source: string;
  tags: string[];
  order: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Hook to fetch a single idea by ID with real-time sync.
 */
export function useIdea(ideaId: string | null) {
  const utils = trpc.useUtils();
  const query = trpc.idea.getById.useQuery(
    { id: ideaId! },
    { enabled: !!ideaId },
  );

  useSyncSubscription<SerializedIdea>(trpc.idea.onSync, {
    onUpdated: (data) => {
      if ("id" in data && data.id === ideaId) {
        utils.idea.getById.invalidate({ id: ideaId! });
      }
      // Also invalidate on reorder or generic updates
      if (ideaId) {
        utils.idea.getById.invalidate({ id: ideaId });
      }
    },
    onDeleted: (data) => {
      if ("id" in data && data.id === ideaId) {
        utils.idea.getById.invalidate({ id: ideaId! });
      }
    },
  });

  return {
    idea: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error?.message ?? null,
  };
}
