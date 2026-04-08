import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useAuth0 } from "@auth0/auth0-react";
import { useNotifications, useQuestionQueue } from "@praxis2/hooks";
import { useSelectedRepo } from "../contexts/RepoContext.js";

const TABS = [
  { path: "/", label: "Ideas" },
  { path: "/board", label: "Board" },
  { path: "/graph", label: "Graph" },
  { path: "/stats", label: "Stats" },
  { path: "/questions", label: "Questions" },
  { path: "/deployments", label: "Deployments" },
  { path: "/notifications", label: "Notifications" },
] as const;

/** Badge that shows the unread notification count. Only rendered when authenticated. */
function UnreadBadge() {
  const { selectedRepoId } = useSelectedRepo();
  const { unreadCount } = useNotifications(selectedRepoId);
  if (unreadCount <= 0) return null;
  return (
    <span className="ml-1 px-1.5 py-0.5 text-xs bg-red-500 text-white rounded-full leading-none">
      {unreadCount}
    </span>
  );
}

/** Badge that shows the open question count. Only rendered when authenticated. */
function QuestionBadge() {
  const { openCount } = useQuestionQueue();
  if (openCount <= 0) return null;
  return (
    <span className="ml-1 px-1.5 py-0.5 text-xs bg-amber-500 text-white rounded-full leading-none">
      {openCount}
    </span>
  );
}

export function TabNav() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { isAuthenticated } = useAuth0();
  const repoParam = searchParams.get("repo");

  return (
    <div className="border-b border-[var(--border-primary)] bg-[var(--bg-primary)] px-4 flex items-center shrink-0">
      <nav className="flex gap-1">
        {TABS.map((tab) => {
          const isActive =
            tab.path === "/"
              ? location.pathname === "/"
              : location.pathname.startsWith(tab.path);

          const linkTo = repoParam ? `${tab.path}?repo=${repoParam}` : tab.path;

          return (
            <Link
              key={tab.path}
              to={linkTo}
              className={`px-3 py-2.5 text-sm font-medium no-underline border-b-2 transition-colors ${
                isActive
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--border-secondary)]"
              }`}
            >
              {tab.label}
              {tab.path === "/notifications" && isAuthenticated && (
                <UnreadBadge />
              )}
              {tab.path === "/questions" && isAuthenticated && (
                <QuestionBadge />
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
