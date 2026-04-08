import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";

type SerializedIdeaPhase = {
  id: string;
  ideaId: string;
  sessionId: string;
  phaseNumber: number;
  phaseName: string;
  content: string;
  createdAt: string;
};

/**
 * Hook to list phases for a given idea.
 * Returns the phase list, loading/error state.
 * Real-time sync keeps the list updated when phases are created, updated, or removed.
 */
export function useIdeaPhases(ideaId: string | null) {
  const utils = trpc.useUtils();
  const listQuery = trpc.ideaPhase.list.useQuery(
    { ideaId: ideaId! },
    { enabled: !!ideaId },
  );

  // Subscribe to real-time sync events for idea phases
  useSyncSubscription<SerializedIdeaPhase>(trpc.ideaPhase.onSync, {
    onCreated: (data) => {
      if (data.ideaId !== ideaId) return;
      utils.ideaPhase.list.invalidate({ ideaId: ideaId! });
    },
    onUpdated: (data) => {
      if (data.ideaId !== ideaId) return;
      utils.ideaPhase.list.invalidate({ ideaId: ideaId! });
    },
    onDeleted: (data) => {
      if (data.ideaId !== ideaId) return;
      utils.ideaPhase.list.invalidate({ ideaId: ideaId! });
    },
  });

  return {
    phases: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    error: listQuery.error?.message ?? null,
  };
}
