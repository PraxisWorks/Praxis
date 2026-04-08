import { useMemo } from "react";
import { useSessionLastViewed } from "./useSessionLastViewed.js";

type SessionLike = {
  id: string;
  status: string;
  lastMessageAt?: string | null;
  createdAt: string;
};

/**
 * Compute unread session count from an existing sessions array.
 * Accepts sessions data so it does NOT fire its own session.list query.
 * The caller (e.g. Layout) should pass the sessions already being fetched
 * by SessionsPanel or another component.
 */
export function useUnreadSessionCount(sessions: SessionLike[] = []) {
  const { hasUnread, markViewed, version } = useSessionLastViewed();

  const activeSessions = useMemo(
    () => sessions.filter((s) => s.status === "active"),
    [sessions],
  );

  const unreadSessionCount = useMemo(() => {
    return activeSessions.filter((s) =>
      hasUnread(s.id, s.lastMessageAt ?? s.createdAt),
    ).length;
  }, [activeSessions, version, hasUnread]);

  return { unreadSessionCount, markViewed };
}
