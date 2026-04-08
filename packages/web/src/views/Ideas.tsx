import { useState, useMemo, useEffect } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useIdeas, uploadIdeaFile, useLimits, usePermissions } from "@praxis2/hooks";
import { UsageBadge } from "../components/UsageBadge.js";
import { useSelectedRepo } from "../contexts/RepoContext.js";
import { RepoColorDot } from "../components/RepoColorDot.js";
import { RepoIcon } from "../components/RepoIcon.js";
import { IdeaCardActions } from "../components/IdeaCardActions.js";
import { useSessionsPanel } from "../contexts/SessionsPanelContext.js";
import type { IdeaStatus, IdeaSize } from "@praxis2/shared";

const STATUS_OPTIONS: { value: IdeaStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "planning", label: "Planning" },
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In Progress" },
  { value: "complete", label: "Complete" },
  { value: "dismissed", label: "Dismissed" },
  { value: "archived", label: "Archived" },
];

/** "All" means every status except archived and dismissed */
const ALL_STATUSES: IdeaStatus[] = STATUS_OPTIONS
  .filter((o) => o.value !== "archived" && o.value !== "dismissed")
  .map((o) => o.value);

const DEFAULT_STATUSES: IdeaStatus[] = ALL_STATUSES;

const STATUS_SORT_ORDER: Record<string, number> = {
  complete: 0,
  in_progress: 1,
  planned: 2,
  planning: 3,
  new: 4,
  dismissed: 5,
  archived: 6,
};

const ALL_SIZES: (IdeaSize | "unsized")[] = ["xs", "s", "m", "l", "xl", "unsized"];

const STATUS_COLORS: Record<string, string> = {
  new: "bg-gray-100 text-gray-700",
  planning: "bg-blue-100 text-blue-700",
  planned: "bg-indigo-100 text-indigo-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  complete: "bg-green-100 text-green-700",
  dismissed: "bg-red-100 text-red-700",
  archived: "bg-gray-100 text-gray-500",
};

const SIZE_OPTIONS: { value: IdeaSize; label: string }[] = [
  { value: "xs", label: "XS" },
  { value: "s", label: "S" },
  { value: "m", label: "M" },
  { value: "l", label: "L" },
  { value: "xl", label: "XL" },
];

const SIZE_COLORS: Record<string, string> = {
  xs: "bg-emerald-100 text-emerald-700",
  s: "bg-teal-100 text-teal-700",
  m: "bg-cyan-100 text-cyan-700",
  l: "bg-orange-100 text-orange-700",
  xl: "bg-rose-100 text-rose-700",
};

export function Ideas() {
  const { getAccessTokenSilently } = useAuth0();
  const { selectedRepoId } = useSelectedRepo();
  const navigate = useNavigate();
  const { limits } = useLimits();
  const { hasPermission } = usePermissions();

  const [selectedStatuses, setSelectedStatuses] = useState<Set<IdeaStatus>>(
    () => new Set(DEFAULT_STATUSES),
  );
  const [selectedSizes, setSelectedSizes] = useState<Set<IdeaSize | "unsized">>(
    () => new Set(ALL_SIZES),
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const [showForm, setShowForm] = useState(false);

  // Auto-open the new-idea form when navigated with ?newIdea=1
  useEffect(() => {
    if (searchParams.get("newIdea") === "1" && selectedRepoId) {
      setShowForm(true);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("newIdea");
        return next;
      }, { replace: true });
    }
  }, [searchParams, selectedRepoId, setSearchParams]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [size, setSize] = useState<IdeaSize | null>(null);

  // Fetch all ideas (no server-side status filter), filter client-side
  const {
    ideas: allIdeas,
    isLoading,
    error,
    createIdea,
    isCreating,
    startAutoSession,
    startConfiguredSession,
    acceptPlan,
    startWork,
    archiveIdea,
    startDebug: startDebugRaw,
    isStartingDebug,
    isStartingAutoSession,
    isAcceptingPlan,
    isStartingWork,
    isArchiving,
  } = useIdeas(selectedRepoId);

  const { openSession: openSessionPanel } = useSessionsPanel();

  const startDebug = async (params: { repoId: string; entityType: "epic"; entityId: string }) => {
    const result = await startDebugRaw(params);
    if (result?.id) {
      openSessionPanel(result.id);
    }
    return result;
  };

  const isAllSelected = ALL_STATUSES.every((s) => selectedStatuses.has(s)) &&
    !selectedStatuses.has("archived") && !selectedStatuses.has("dismissed");

  const toggleStatus = (status: IdeaStatus) => {
    setSelectedStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (isAllSelected) {
      setSelectedStatuses(new Set(DEFAULT_STATUSES));
    } else {
      setSelectedStatuses(new Set(ALL_STATUSES));
    }
  };

  const isAllSizesSelected = ALL_SIZES.every((s) => selectedSizes.has(s));

  const toggleSize = (size: IdeaSize | "unsized") => {
    setSelectedSizes((prev) => {
      const next = new Set(prev);
      if (next.has(size)) {
        next.delete(size);
      } else {
        next.add(size);
      }
      return next;
    });
  };

  const toggleAllSizes = () => {
    if (isAllSizesSelected) {
      setSelectedSizes(new Set());
    } else {
      setSelectedSizes(new Set(ALL_SIZES));
    }
  };

  const ideas = useMemo(
    () => allIdeas
      .filter((idea) => {
        if (!selectedStatuses.has(idea.status as IdeaStatus)) return false;
        const sizeKey = idea.size ?? "unsized";
        if (!selectedSizes.has(sizeKey as IdeaSize | "unsized")) return false;
        return true;
      })
      .sort((a, b) => {
        const aOrder = STATUS_SORT_ORDER[a.status] ?? 99;
        const bOrder = STATUS_SORT_ORDER[b.status] ?? 99;
        return aOrder - bOrder;
      }),
    [allIdeas, selectedStatuses, selectedSizes],
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;
    if (!selectedRepoId) return;
    setUploadError(null);

    const newIdea = await createIdea({
      repoId: selectedRepoId,
      title: title.trim(),
      description: description.trim(),
      ...(size && { size }),
    });

    // Upload files if any were selected
    if (hasPermission("file:upload") && files.length > 0 && newIdea?.id) {
      setIsUploading(true);
      try {
        const token = await getAccessTokenSilently();
        for (const file of files) {
          await uploadIdeaFile(newIdea.id, file, token, "/api/trpc");
        }
      } catch (err) {
        setUploadError(
          err instanceof Error ? err.message : "File upload failed",
        );
        // Don't lose the created idea -- it was already created
      } finally {
        setIsUploading(false);
      }
    }

    setTitle("");
    setDescription("");
    setFiles([]);
    setSize(null);
    setShowForm(false);
  };

  return (
    <div className="max-w-[700px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Ideas</h1>
          <p className="text-[var(--text-muted)] text-sm">
            Capture features and concepts to build.
          </p>
          <UsageBadge current={allIdeas.length} max={limits?.maxIdeasPerRepo ?? null} label="ideas" />
        </div>
        {selectedRepoId && (
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={() => setShowForm(!showForm)}
              disabled={limits?.maxIdeasPerRepo != null && allIdeas.length >= limits.maxIdeasPerRepo}
              className="px-4 py-2 bg-[var(--accent)] text-white rounded text-sm cursor-pointer hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {showForm ? "Cancel" : "+ New Idea"}
            </button>
            {limits?.maxIdeasPerRepo != null && allIdeas.length >= limits.maxIdeasPerRepo && (
              <p className="text-xs text-red-500">Idea limit reached.</p>
            )}
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded mb-4">{error}</div>
      )}

      {/* Create form (inline, shown when toggled) */}
      {showForm && (
        <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">New Idea</h2>
          <form onSubmit={handleCreate} className="flex flex-col gap-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Idea title"
              required
              className="px-3 py-2 border border-[var(--border-secondary)] rounded text-sm"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the idea..."
              required
              rows={3}
              className="px-3 py-2 border border-[var(--border-secondary)] rounded text-sm"
            />
            {/* Size picker */}
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">
                Size (optional)
              </label>
              <div className="flex gap-2">
                {SIZE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSize(size === opt.value ? null : opt.value)}
                    className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer border transition-colors ${
                      size === opt.value
                        ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                        : "bg-[var(--bg-primary)] text-[var(--text-secondary)] border-[var(--border-secondary)] hover:border-[var(--border-secondary)]"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {/* File attachment input */}
            {hasPermission("file:upload") && (
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">
                Attachments (optional)
              </label>
              <input
                type="file"
                multiple
                onChange={(e) => {
                  if (e.target.files) {
                    setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
                    e.target.value = "";
                  }
                }}
                className="text-sm text-[var(--text-secondary)] file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:bg-[var(--bg-tertiary)] file:text-[var(--text-secondary)] hover:file:bg-[var(--bg-secondary)] file:cursor-pointer"
              />
              {files.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {files.map((file, idx) => (
                    <li
                      key={`${file.name}-${idx}`}
                      className="flex items-center gap-2 text-xs text-[var(--text-secondary)]"
                    >
                      <span className="truncate">{file.name}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setFiles((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="text-red-400 hover:text-red-600 cursor-pointer shrink-0"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            )}
            <button
              type="submit"
              disabled={isCreating || isUploading}
              className="self-end px-5 py-2 bg-[var(--accent)] text-white rounded text-sm cursor-pointer disabled:opacity-60 hover:bg-[var(--accent-hover)] transition-colors"
            >
              {isCreating
                ? "Creating..."
                : isUploading
                  ? "Uploading files..."
                  : "Create"}
            </button>
          </form>
        </div>
      )}

      {/* Upload error (shown outside the form since idea was already created) */}
      {uploadError && (
        <div className="bg-yellow-50 text-yellow-700 p-3 rounded mb-4 text-sm">
          Idea created, but file upload failed: {uploadError}
        </div>
      )}

      {/* Status filter chips (multi-select) */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <button
          onClick={toggleAll}
          className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer border transition-colors ${
            isAllSelected
              ? "bg-[var(--accent)] text-white border-[var(--accent)]"
              : "bg-[var(--bg-primary)] text-[var(--text-secondary)] border-[var(--border-secondary)] hover:border-[var(--border-secondary)]"
          }`}
        >
          All
        </button>
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => toggleStatus(opt.value)}
            className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer border transition-colors ${
              selectedStatuses.has(opt.value)
                ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                : "bg-[var(--bg-primary)] text-[var(--text-secondary)] border-[var(--border-secondary)] hover:border-[var(--border-secondary)]"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Size filter chips */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <button
          onClick={toggleAllSizes}
          className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer border transition-colors ${
            isAllSizesSelected
              ? "bg-[var(--accent)] text-white border-[var(--accent)]"
              : "bg-[var(--bg-primary)] text-[var(--text-secondary)] border-[var(--border-secondary)] hover:border-[var(--border-secondary)]"
          }`}
        >
          All Sizes
        </button>
        {(["xs", "s", "m", "l", "xl"] as IdeaSize[]).map((s) => (
          <button
            key={s}
            onClick={() => toggleSize(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer border transition-colors ${
              selectedSizes.has(s)
                ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                : "bg-[var(--bg-primary)] text-[var(--text-secondary)] border-[var(--border-secondary)] hover:border-[var(--border-secondary)]"
            }`}
          >
            {s.toUpperCase()}
          </button>
        ))}
        <button
          onClick={() => toggleSize("unsized")}
          className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer border transition-colors ${
            selectedSizes.has("unsized")
              ? "bg-[var(--accent)] text-white border-[var(--accent)]"
              : "bg-[var(--bg-primary)] text-[var(--text-secondary)] border-[var(--border-secondary)] hover:border-[var(--border-secondary)]"
          }`}
        >
          Unsized
        </button>
      </div>

      {/* Ideas list */}
      {isLoading ? (
        <p className="text-[var(--text-faint)] text-center p-8">Loading...</p>
      ) : ideas.length ? (
        <div className="space-y-3">
          {ideas.map((idea) => (
            <div
              key={idea.id}
              className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-4 cursor-pointer hover:border-[var(--border-secondary)] transition-colors"
              style={
                selectedRepoId === null && idea.repoColor
                  ? { borderLeftColor: idea.repoColor, borderLeftWidth: 3 }
                  : undefined
              }
              onClick={() => navigate(`/ideas/${idea.id}`)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {selectedRepoId === null && (idea.repoIcon || idea.repoColor) && (
                      idea.repoIcon ? (
                        <RepoIcon name={idea.repoIcon} color={idea.repoColor ?? undefined} size={14} className="shrink-0" />
                      ) : idea.repoColor ? (
                        <RepoColorDot color={idea.repoColor} />
                      ) : null
                    )}
                    <h3 className="font-semibold text-sm">{idea.title}</h3>
                  </div>
                  {selectedRepoId === null && idea.repoName && (
                    <p className="text-[11px] text-[var(--text-faint)] mt-0.5">{idea.repoName}</p>
                  )}
                  <p className="text-[var(--text-muted)] text-xs mt-1 line-clamp-2">
                    {idea.description}
                  </p>
                  {idea.latestPhaseNumber > 0 && (
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-[10px] text-[var(--text-faint)] mb-0.5">
                        <span>Phase {idea.latestPhaseNumber}/8: {idea.latestPhaseName}</span>
                        <span>{Math.round((idea.latestPhaseNumber / 8) * 100)}%</span>
                      </div>
                      <div className="w-full h-1 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[var(--accent-arch)] rounded-full transition-all duration-300"
                          style={{ width: `${Math.round((idea.latestPhaseNumber / 8) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {idea.tags.length > 0 && (
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {idea.tags.map((tag: string) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 bg-[var(--bg-tertiary)] text-[var(--text-secondary)] rounded text-xs"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[idea.status] ?? "bg-gray-100 text-gray-600"}`}
                  >
                    {idea.status.replace("_", " ")}
                  </span>
                  {idea.size && (
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${SIZE_COLORS[idea.size] ?? "bg-gray-100 text-gray-600"}`}
                    >
                      {idea.size.toUpperCase()}
                    </span>
                  )}
                  <IdeaCardActions
                    idea={idea}
                    startAutoSession={startAutoSession}
                    startConfiguredSession={startConfiguredSession}
                    acceptPlan={acceptPlan}
                    startWork={startWork}
                    archiveIdea={archiveIdea}
                    startDebug={startDebug}
                    isStartingAutoSession={isStartingAutoSession}
                    isAcceptingPlan={isAcceptingPlan}
                    isStartingWork={isStartingWork}
                    isArchiving={isArchiving}
                    isStartingDebug={isStartingDebug}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center p-8 space-y-4">
          <p className="text-[var(--text-faint)]">
            {selectedRepoId
              ? "No ideas yet. Create one to get started."
              : "Select a repo to see ideas, or view all repos."}
          </p>
          <div className="bg-[var(--accent-light)] border border-[var(--accent)]/20 rounded-lg p-4">
            <p className="text-sm text-[var(--text-secondary)] m-0">
              New to Praxis?{" "}
              <Link
                to="/documentation/getting-started"
                className="text-[var(--accent)] font-medium no-underline hover:underline"
              >
                Follow the Getting Started guide
              </Link>{" "}
              to set up your first project.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
