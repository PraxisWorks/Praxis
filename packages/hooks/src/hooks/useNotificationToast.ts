import { useRef, useEffect } from "react";
import type { SyncEvent } from "@praxis2/shared";
import { trpc } from "../trpc.js";

type ToastNotification = {
  id: string;
  userId: string;
  title: string;
  body: string;
  actionUrl: string | null;
};

export function useNotificationToast(
  currentUserId: string | null | undefined,
  onNotification: (notification: ToastNotification) => void,
) {
  const callbackRef = useRef(onNotification);
  const seenIdsRef = useRef(new Set<string>());

  useEffect(() => {
    callbackRef.current = onNotification;
  });

  trpc.notification.onSync.useSubscription(undefined, {
    onData(event: { data: SyncEvent }) {
      const { action, data } = event.data as unknown as SyncEvent<ToastNotification>;
      if (action === "created" && currentUserId && data.userId === currentUserId) {
        // Deduplicate: skip if we've already shown a toast for this notification
        if (seenIdsRef.current.has(data.id)) return;
        seenIdsRef.current.add(data.id);
        // Auto-clear after 5 seconds to prevent unbounded growth
        setTimeout(() => {
          seenIdsRef.current.delete(data.id);
        }, 5000);

        callbackRef.current({
          id: data.id,
          userId: data.userId,
          title: data.title,
          body: data.body,
          actionUrl: data.actionUrl,
        });
      }
    },
  });
}
