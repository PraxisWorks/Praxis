import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";

type SerializedUser = { id: string; sub: string | null; name: string; email: string; role: string; avatarUrl: string | null; lastLoginAt: string | null; pushOptOut: boolean; theme: string; createdAt: string };

export function useUsers() {
  const utils = trpc.useUtils();
  const listQuery = trpc.user.list.useQuery();

  useSyncSubscription<SerializedUser>(trpc.user.onSync, {
    onCreated: () => utils.user.list.invalidate(),
    onUpdated: () => utils.user.list.invalidate(),
    onDeleted: () => utils.user.list.invalidate(),
  });

  const createMutation = trpc.user.create.useMutation({
    onSuccess: () => {
      utils.user.list.invalidate();
    },
  });
  const deleteMutation = trpc.user.delete.useMutation({
    onSuccess: () => {
      utils.user.list.invalidate();
    },
  });

  return {
    users: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    error: listQuery.error?.message ?? null,
    createUser: createMutation.mutateAsync,
    deleteUser: deleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
