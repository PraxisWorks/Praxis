import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";

type SerializedNotification = {
  id: string;
  userId: string;
  repoId: string | null;
  title: string;
  body: string;
  actionUrl: string | null;
  read: boolean;
  createdAt: string;
};

export function useNotifications(repoId?: string | null) {
  const utils = trpc.useUtils();

  const listQuery = trpc.notification.list.useQuery({ limit: 20, repoId: repoId ?? undefined });
  const unreadQuery = trpc.notification.unreadCount.useQuery(repoId != null ? { repoId } : undefined);

  useSyncSubscription<SerializedNotification>(trpc.notification.onSync, {
    onCreated: (data) => {
      if (repoId !== undefined && repoId !== null && data.repoId !== repoId) return;
      utils.notification.list.invalidate({ repoId: repoId ?? undefined });
      utils.notification.unreadCount.invalidate(repoId != null ? { repoId } : undefined);
    },
    onUpdated: (data) => {
      if (repoId !== undefined && repoId !== null && data.repoId !== repoId) return;
      utils.notification.list.invalidate({ repoId: repoId ?? undefined });
      utils.notification.unreadCount.invalidate(repoId != null ? { repoId } : undefined);
    },
    onDeleted: (data) => {
      if (repoId !== undefined && repoId !== null && data.repoId !== repoId) return;
      utils.notification.list.invalidate({ repoId: repoId ?? undefined });
      utils.notification.unreadCount.invalidate(repoId != null ? { repoId } : undefined);
    },
  });

  const markReadMutation = trpc.notification.markRead.useMutation({
    onSuccess: () => {
      utils.notification.list.invalidate({ repoId: repoId ?? undefined });
      utils.notification.unreadCount.invalidate(repoId != null ? { repoId } : undefined);
    },
  });

  const markUnreadMutation = trpc.notification.markUnread.useMutation({
    onSuccess: () => {
      utils.notification.list.invalidate({ repoId: repoId ?? undefined });
      utils.notification.unreadCount.invalidate(repoId != null ? { repoId } : undefined);
    },
  });

  const markAllReadMutation = trpc.notification.markAllRead.useMutation({
    onSuccess: () => {
      utils.notification.list.invalidate({ repoId: repoId ?? undefined });
      utils.notification.unreadCount.invalidate(repoId != null ? { repoId } : undefined);
    },
  });

  return {
    notifications: listQuery.data?.notifications ?? [],
    isLoading: listQuery.isLoading,
    error: listQuery.error?.message ?? null,
    hasNextPage: listQuery.data?.nextCursor != null,
    fetchNextPage: () => {
      if (listQuery.data?.nextCursor) {
        utils.notification.list.fetch({
          cursor: listQuery.data.nextCursor,
          limit: 20,
          repoId: repoId ?? undefined,
        });
      }
    },
    unreadCount: unreadQuery.data?.count ?? 0,
    markRead: markReadMutation.mutateAsync,
    markUnread: markUnreadMutation.mutateAsync,
    markAllRead: () => markAllReadMutation.mutateAsync(repoId != null ? { repoId } : undefined),
  };
}
