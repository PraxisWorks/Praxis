import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";

type SerializedWorker = {
  id: string;
  userId: string;
  name: string;
  status: string;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  apiKeyId: string | null;
};

/**
 * Hook for the worker list + mutations + real-time sync.
 * Components call this to manage workers, generate tokens, and set the active worker.
 */
export function useWorkers() {
  const utils = trpc.useUtils();

  const listQuery = trpc.worker.list.useQuery();
  const getActiveQuery = trpc.worker.getActive.useQuery();

  useSyncSubscription<SerializedWorker>(trpc.worker.onSync, {
    onCreated: () => {
      utils.worker.list.invalidate();
      utils.worker.getActive.invalidate();
    },
    onUpdated: () => {
      utils.worker.list.invalidate();
      utils.worker.getActive.invalidate();
    },
    onDeleted: () => {
      utils.worker.list.invalidate();
      utils.worker.getActive.invalidate();
    },
  });

  const generateTokenMutation = trpc.worker.generateToken.useMutation();
  const setActiveMutation = trpc.worker.setActive.useMutation({
    onSuccess: () => {
      utils.worker.getActive.invalidate();
    },
  });
  const removeWorkerMutation = trpc.worker.removeWorker.useMutation({
    onSuccess: () => {
      utils.worker.list.invalidate();
      utils.worker.getActive.invalidate();
    },
  });
  const renameWorkerMutation = trpc.worker.renameWorker.useMutation({
    onSuccess: () => {
      utils.worker.list.invalidate();
    },
  });

  return {
    workers: listQuery.data ?? [],
    activeWorker: getActiveQuery.data ?? null,
    isLoading: listQuery.isLoading,
    generateToken: generateTokenMutation.mutateAsync,
    isGeneratingToken: generateTokenMutation.isPending,
    setActive: setActiveMutation.mutateAsync,
    removeWorker: removeWorkerMutation.mutateAsync,
    renameWorker: renameWorkerMutation.mutateAsync,
  };
}
