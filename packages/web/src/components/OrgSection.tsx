import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useSessions, useLimits, useRepos } from "@praxis2/hooks";
import { useSelectedRepo } from "../contexts/RepoContext.js";
import { useSelectedOrg } from "../contexts/OrgContext.js";
import { useSessionsPanel } from "../contexts/SessionsPanelContext.js";
import { RepoIcon } from "./RepoIcon.js";
import { EditRepoModal } from "./EditRepoModal.js";

type Repo = {
  id: string;
  orgId: string;
  name: string;
  color: string;
  icon: string | null;
  status: string;
};

type OrgSectionProps = {
  org: { id: string; name: string; slug: string; role: string };
  repos: Repo[];
  isCollapsed: boolean;
  onToggleCollapse: () => void;
};

export function OrgSection({ org, repos, isCollapsed, onToggleCollapse }: OrgSectionProps) {
  const { selectedRepoId, setSelectedRepoId } = useSelectedRepo();
  const { setSelectedOrgId } = useSelectedOrg();
  const { startRepoSession, isStartingRepoSession } = useSessions();
  const { deleteRepo, isDeleting } = useRepos();
  const { openSession: openSessionPanel } = useSessionsPanel();
  const { isAtLimit } = useLimits();
  const navigate = useNavigate();
  const location = useLocation();
  const canManage = org.role === "owner" || org.role === "admin";

  const [editTarget, setEditTarget] = useState<{
    id: string;
    name: string;
    color: string;
    icon: string | null;
    orgId: string;
  } | null>(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: org.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="mb-1">
      {/* Org header */}
      <div className="group/org flex items-center gap-1 px-2 py-1.5 rounded hover:bg-[var(--bg-tertiary)]">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="p-0.5 text-[var(--text-faint)] opacity-0 group-hover/org:opacity-100 cursor-grab active:cursor-grabbing transition-opacity"
          aria-label={`Reorder ${org.name}`}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="9" cy="6" r="1.5" />
            <circle cx="15" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" />
            <circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" />
            <circle cx="15" cy="18" r="1.5" />
          </svg>
        </button>

        {/* Collapse toggle + org name */}
        <button
          onClick={onToggleCollapse}
          className="flex-1 min-w-0 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)] cursor-pointer"
        >
          <svg
            className={`w-3 h-3 transition-transform shrink-0 ${isCollapsed ? "" : "rotate-90"}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="truncate">{org.name}</span>
          <span className="text-[var(--text-faint)] font-normal tabular-nums">
            {repos.length}
          </span>
        </button>

        {/* Gear icon for owners and admins */}
        {canManage && (
          <button
            onClick={() => {
              navigate(`/org/settings?org=${org.id}`);
            }}
            className="p-1 text-[var(--text-faint)] hover:text-[var(--text-primary)] opacity-0 group-hover/org:opacity-100 rounded cursor-pointer transition-opacity"
            title="Organization settings"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        )}
      </div>

      {/* Repo list (collapsible) */}
      {!isCollapsed && (
        <div className="ml-3 pl-2 border-l border-[var(--border-primary)]">
          {repos.length === 0 && (
            <p className="px-2 py-2 text-xs text-[var(--text-faint)] italic">No repos</p>
          )}
          {repos.map((repo) => {
            const isCreating = repo.status === "creating";
            const isError = repo.status === "error";

            return (
              <div
                key={repo.id}
                className={`group/repo flex items-center rounded ${
                  isCreating ? "opacity-60 cursor-wait" :
                  selectedRepoId === repo.id
                    ? "bg-[var(--accent-light)] text-[var(--accent-emphasis)] font-medium"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                }`}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isCreating) return;
                    setSelectedOrgId(org.id);
                    navigate(`${location.pathname}?repo=${repo.id}`);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  disabled={isCreating}
                  className={`flex-1 text-left px-2 py-1.5 text-sm flex items-center gap-2 ${isCreating ? "cursor-wait" : "cursor-pointer"}`}
                >
                  {repo.icon && !isCreating && !isError ? (
                    <RepoIcon name={repo.icon} color={repo.color} size={14} className="shrink-0" />
                  ) : (
                    <span
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${isCreating ? "animate-pulse" : ""}`}
                      style={{ backgroundColor: isError ? "#ef4444" : repo.color }}
                    />
                  )}
                  <span className="truncate">{repo.name}</span>
                  {isCreating && (
                    <span className="text-xs text-[var(--text-faint)] ml-auto shrink-0">Creating...</span>
                  )}
                  {isError && (
                    <span className="text-xs text-red-500 ml-auto shrink-0">Error</span>
                  )}
                </button>
                {isCreating && canManage && (
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        await deleteRepo({ id: repo.id });
                      } catch (err) {
                        console.error("Failed to cancel stuck repo", err);
                      }
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    disabled={isDeleting}
                    className="px-1.5 py-1 text-[var(--text-faint)] hover:text-red-500 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label={`Cancel creation of ${repo.name}`}
                    title="Cancel and delete this stuck repo"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                )}
                {!isCreating && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedOrgId(org.id);
                        navigate(`/?repo=${repo.id}&newIdea=1`);
                      }}
                      className="opacity-0 group-hover/repo:opacity-100 px-1.5 py-1 text-[var(--text-faint)] hover:text-[var(--text-secondary)] cursor-pointer transition-opacity"
                      aria-label={`New idea for ${repo.name}`}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 4v16m8-8H4"
                        />
                      </svg>
                    </button>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        const result = await startRepoSession({ repoId: repo.id });
                        openSessionPanel(result.id);
                      }}
                      disabled={isStartingRepoSession || isAtLimit("activeSessions")}
                      className={`opacity-0 group-hover/repo:opacity-100 px-1.5 py-1 text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-opacity ${isAtLimit("activeSessions") ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                      title={isAtLimit("activeSessions") ? "Session limit reached" : `Chat with ${repo.name}`}
                      aria-label={`Chat with ${repo.name}`}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                        />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditTarget({ id: repo.id, name: repo.name, color: repo.color, icon: repo.icon ?? null, orgId: repo.orgId });
                      }}
                      className="opacity-0 group-hover/repo:opacity-100 px-1.5 py-1 text-[var(--text-faint)] hover:text-[var(--text-secondary)] cursor-pointer transition-opacity"
                      aria-label={`Edit ${repo.name}`}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-3.5 w-3.5"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editTarget && (
        <EditRepoModal
          isOpen
          onClose={() => setEditTarget(null)}
          repo={editTarget}
        />
      )}
    </div>
  );
}
