import { useEffect } from "react";
import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";

type SerializedSession = {
  id: string;
  repoId: string;
  userId: string;
  type: string;
  entityType: string | null;
  entityId: string | null;
  title: string;
  status: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  messages: Array<{
    id: string;
    sessionId: string;
    role: string;
    content: string;
    createdAt: string;
    workerName?: string;
    metadata?: {
      type: string;
      questions?: Array<{
        question: string;
        header: string;
        options: Array<{ label: string; description: string }>;
        multiSelect: boolean;
      }>;
      answered?: boolean;
      answeredAt?: string;
      selectedOptions?: string[];
    } | null;
    attachments?: Array<{
      id: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
    }>;
  }>;
};

export function useSession(sessionId: string | null) {
  const utils = trpc.useUtils();
  const query = trpc.session.getById.useQuery(
    { id: sessionId! },
    { enabled: !!sessionId },
  );

  // Refetch on mount / session change so we never show stale cached data
  // after navigating away and back (the 5-min staleTime would otherwise
  // serve the old response until the next subscription event).
  useEffect(() => {
    if (sessionId) {
      utils.session.getById.invalidate({ id: sessionId });
    }
  }, [sessionId, utils]);

  useSyncSubscription<SerializedSession>(trpc.session.onSync, {
    onUpdated: (data) => {
      if (data.id === sessionId) {
        utils.session.getById.invalidate({ id: sessionId! });
      }
    },
  });

  return {
    session: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error?.message ?? null,
  };
}
