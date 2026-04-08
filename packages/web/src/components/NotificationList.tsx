import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useNotifications, useRepos } from "@praxis2/hooks";
import { RepoIcon } from "./RepoIcon.js";

function timeAgo(dateStr: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000,
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

type NotificationListProps = {
  repoId?: string | null;
};

export function NotificationList({ repoId }: NotificationListProps) {
  const navigate = useNavigate();
  const {
    notifications,
    isLoading,
    hasNextPage,
    fetchNextPage,
    unreadCount,
    markRead,
    markUnread,
    markAllRead,
  } = useNotifications(repoId);

  const { repos } = useRepos();
  const repoMap = useMemo(
    () => Object.fromEntries(repos.map((r) => [r.id, r])),
    [repos],
  );

  if (isLoading) {
    return <p className="text-[var(--text-faint)] text-center p-8">Loading notifications...</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Notifications</h2>
        {unreadCount > 0 && (
          <button
            onClick={() => markAllRead()}
            className="text-sm text-[var(--accent)] hover:text-[var(--accent-hover)] cursor-pointer"
          >
            Mark all read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <p className="text-[var(--text-faint)] text-center p-8">No notifications yet.</p>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-4 border-l-4 ${
                n.read ? "border-l-transparent" : "border-l-[var(--accent)]"
              } ${n.actionUrl ? "cursor-pointer" : ""}`}
              onClick={() => {
                if (n.actionUrl) navigate(n.actionUrl);
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    {(() => {
                      const repo = n.repoId ? repoMap[n.repoId] : null;
                      if (!repo) return null;
                      return (
                        <>
                          <RepoIcon name={repo.icon} color={repo.color} size={12} className="shrink-0" />
                          <span className="text-xs text-[var(--text-muted)]">{repo.name}</span>
                          <span className="text-xs text-[var(--text-faint)]">&middot;</span>
                        </>
                      );
                    })()}
                    <p className={`${n.read ? "font-normal" : "font-bold"} text-sm`}>
                      {n.title}
                    </p>
                  </div>
                  <p className="text-[var(--text-secondary)] text-sm mt-0.5">{n.body}</p>
                  <p className="text-[var(--text-faint)] text-xs mt-1">
                    {timeAgo(n.createdAt)}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (n.read) {
                      markUnread({ id: n.id });
                    } else {
                      markRead({ id: n.id });
                    }
                  }}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] whitespace-nowrap cursor-pointer"
                >
                  {n.read ? "Mark unread" : "Mark read"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {hasNextPage && (
        <button
          onClick={fetchNextPage}
          className="mt-4 w-full py-2 text-sm text-[var(--accent)] hover:text-[var(--accent-hover)] cursor-pointer"
        >
          Load more
        </button>
      )}
    </div>
  );
}
