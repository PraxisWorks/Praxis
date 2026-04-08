import { useState, useRef, useEffect, useCallback, useMemo, type KeyboardEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth0 } from "@auth0/auth0-react";
import {
  useSessions,
  useSession,
  useSessionMessages,
  useSessionLastViewed,
  useFileUpload,
  useTask,
  useTasks,
  useIdeaPhases,
  useLimits,
  usePermissions,
} from "@praxis2/hooks";
import { SessionEntry } from "./SessionEntry";
import { SessionFilters } from "./SessionFilters";
import { MarkdownContent } from "./sessions/MarkdownContent";
import { StructuredQuestion } from "./sessions/StructuredQuestion.js";
import { useSessionsPanel } from "../contexts/SessionsPanelContext.js";
import { useToast } from "../contexts/ToastContext.js";
import { timeAgo } from "../lib/timeAgo.js";
import { RepoIcon } from "./RepoIcon";
import { UsageBadge } from "./UsageBadge.js";

/** Detect if a message is raw proposal JSON (fallback for old messages). */
function isProposalJson(content: string): boolean {
  return /^\s*\{[\s\S]*"epics"[\s\S]*\}\s*$/.test(content);
}

export function SessionsPanel() {
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>(["active", "paused"]);
  const [orgFilter, setOrgFilter] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { sessions, isLoading, sessionCount, pause, resume, complete, rename, remake, cancelScheduled, isPausing, isResuming, isCompleting, isRemaking } = useSessions({
    typeFilter,
    statusFilter,
    orgIds: orgFilter.length > 0 ? orgFilter : undefined,
  });
  const { hasUnread, markViewed, version } = useSessionLastViewed();
  const unreadCount = useMemo(
    () => sessions.filter((s) => hasUnread(s.id, s.lastMessageAt ?? s.createdAt)).length,
    [sessions, version, hasUnread],
  );
  const { pendingSessionId, clearPendingSession } = useSessionsPanel();
  const { addToast } = useToast();
  const { limits, usage, isAtLimit } = useLimits();
  const [showTimestamps, setShowTimestamps] = useState(false);

  const openSession = useCallback((id: string) => {
    markViewed(id);
    setExpandedId(id);
  }, [markViewed]);

  useEffect(() => {
    if (!pendingSessionId) return;
    const found = sessions.find((s) => s.id === pendingSessionId);
    if (found) {
      openSession(pendingSessionId);
      clearPendingSession();
    }
  }, [pendingSessionId, sessions, openSession, clearPendingSession]);

  // Detail view: single session chat
  if (expandedId) {
    const session = sessions.find((s) => s.id === expandedId);
    return (
      <div className="h-full flex flex-col bg-[var(--bg-primary)]">
        {/* Detail header */}
        <DetailHeader
          session={session ?? null}
          repoColor={session?.repoColor ?? null}
          repoIcon={session?.repoIcon ?? null}
          repoName={session?.repoName ?? null}
          onBack={() => setExpandedId(null)}
          onRename={(title) => rename({ id: expandedId, title })}
          showTimestamps={showTimestamps}
          onToggleTimestamps={() => setShowTimestamps(s => !s)}
        />

        {/* Messages + input fill remaining space */}
        <SessionDetail
          sessionId={expandedId}
          sessionType={session?.type ?? ""}
          entityId={session?.entityId ?? null}
          sessionStatus={session?.status ?? "completed"}
          sessionMetadata={session?.metadata as Record<string, unknown> | null ?? null}
          showTimestamps={showTimestamps}
          onPause={() => pause({ sessionId: expandedId })}
          onResume={() => resume({ sessionId: expandedId, message: "Pick up where you left off" })}
          onComplete={() => complete({ sessionId: expandedId })}
          onRemake={async () => {
            try {
              const newSession = await remake({ id: expandedId });
              setExpandedId(newSession.id);
            } catch (err) {
              addToast({
                title: "Remake failed",
                body: err instanceof Error ? err.message : "Something went wrong",
                variant: "error",
              });
            }
          }}
          isPausing={isPausing}
          isResuming={isResuming}
          isCompleting={isCompleting}
          isRemaking={isRemaking}
        />
      </div>
    );
  }

  // List view: all sessions
  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)]">
      {/* Header with count badge */}
      <div className="p-4 border-b border-[var(--border-primary)] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-sm">AI Sessions</h2>
          <Link
            to="/documentation"
            className="p-0.5 rounded text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            aria-label="Open documentation"
            title="Help & documentation"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <circle cx="12" cy="12" r="9" />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.5 9a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 4"
              />
              <circle cx="12" cy="17" r="0.5" fill="currentColor" />
            </svg>
          </Link>
          <UsageBadge
            current={usage?.activeSessions ?? 0}
            max={limits?.maxActiveSessions ?? null}
            label="sessions"
          />
        </div>
        {unreadCount > 0 && (
          <span className="text-xs bg-[var(--accent-light)] text-[var(--accent-emphasis)] rounded-full px-2 py-0.5 font-medium">
            {unreadCount}
          </span>
        )}
      </div>
      {isAtLimit("activeSessions") && (
        <div className="px-4 py-2 text-xs text-amber-600 border-b border-[var(--border-primary)]">
          Session limit reached. Contact your admin to increase your limit.
        </div>
      )}

      {/* Filter dropdowns */}
      <SessionFilters
        typeFilter={typeFilter}
        statusFilter={statusFilter}
        orgFilter={orgFilter}
        onTypeChange={setTypeFilter}
        onStatusChange={setStatusFilter}
        onOrgChange={setOrgFilter}
      />

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="text-[var(--text-faint)] text-xs text-center py-8">Loading...</p>
        ) : sessions.length === 0 ? (
          <p className="text-[var(--text-faint)] text-xs text-center py-8">
            No sessions yet.
          </p>
        ) : (
          <div>
            {sessions.map((session) => (
              <SessionEntry
                key={session.id}
                session={{
                  id: session.id,
                  type: session.type,
                  status: session.status,
                  title: session.title,
                  repoColor: session.repoColor ?? null,
                  repoIcon: session.repoIcon ?? null,
                  repoName: session.repoName ?? null,
                  lastMessageAt: session.lastMessageAt ?? session.createdAt,
                  metadata: session.metadata as Record<string, unknown> | null ?? null,
                  workerName: session.workerName ?? null,
                  workerStatus: session.workerStatus ?? null,
                  scheduledFor: session.scheduledFor ?? null,
                  lastMessageContent: session.lastMessageContent ?? null,
                  lastMessageRole: session.lastMessageRole ?? null,
                  taskTotal: session.taskTotal ?? null,
                  taskCompleted: session.taskCompleted ?? null,
                  taskInProgress: session.taskInProgress ?? null,
                  phaseCompleted: session.phaseCompleted ?? null,
                  latestPhaseName: session.latestPhaseName ?? null,
                }}
                isUnread={hasUnread(
                  session.id,
                  session.lastMessageAt ?? session.createdAt,
                )}
                isExpanded={false}
                onToggle={() => openSession(session.id)}
                onMarkViewed={() => markViewed(session.id)}
                onCancelScheduled={(id) => cancelScheduled({ sessionId: id })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Detail header with inline title editing ---

function DetailHeader({
  session,
  repoColor,
  repoIcon,
  repoName,
  onBack,
  onRename,
  showTimestamps,
  onToggleTimestamps,
}: {
  session: { title: string; type: string; status: string; workerName?: string | null; phaseCompleted?: number | null; latestPhaseName?: string | null } | null;
  repoColor: string | null;
  repoIcon: string | null;
  repoName: string | null;
  onBack: () => void;
  onRename: (title: string) => void;
  showTimestamps: boolean;
  onToggleTimestamps: () => void;
}) {
  const hasRigColor = !!repoColor;
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = () => {
    setDraft(session?.title ?? "");
    setIsEditing(true);
  };

  useEffect(() => {
    if (isEditing) inputRef.current?.select();
  }, [isEditing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== session?.title) {
      onRename(trimmed);
    }
    setIsEditing(false);
  };

  const cancel = () => setIsEditing(false);

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
  };

  return (
    <div
      className="p-3 border-b border-[var(--border-primary)] flex items-center gap-2 shrink-0"
      style={{ backgroundColor: repoColor ?? undefined }}
    >
      <button
        onClick={onBack}
        className={`p-1 rounded cursor-pointer ${hasRigColor ? 'hover:bg-white/20 text-white' : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]'}`}
        aria-label="Back to session list"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={handleKey}
            className="text-sm font-medium w-full px-1 py-0.5 border border-[var(--accent)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            maxLength={255}
          />
        ) : (
          <button
            type="button"
            onDoubleClick={startEditing}
            className={`text-sm font-medium truncate block w-full text-left cursor-text group relative ${hasRigColor ? 'text-white' : ''}`}
            title="Double-click to rename"
          >
            {repoIcon && <RepoIcon name={repoIcon} color="white" size={18} className="inline-block mr-1.5 -mt-0.5" />}
            {session?.title ?? "Session"}
            <svg
              className={`w-3 h-3 inline-block ml-1.5 -mt-0.5 transition-colors ${hasRigColor ? 'text-white/50 group-hover:text-white/80' : 'text-[var(--text-faint)] group-hover:text-[var(--text-muted)]'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
        )}
        {session && !isEditing && (
          <p className={`text-[11px] ${hasRigColor ? 'text-white/70' : 'text-[var(--text-faint)]'}`}>
            {session.type} &middot; {session.status}
            {session.workerName && <> &middot; {session.workerName}</>}
            {session.type === 'architecture' && session.phaseCompleted != null && session.phaseCompleted > 0 && (
              <> &middot; Phase {session.phaseCompleted}/8: {session.latestPhaseName}</>
            )}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onToggleTimestamps}
        className={`p-1 rounded cursor-pointer transition-colors ${hasRigColor ? 'hover:bg-white/20 text-white/70 hover:text-white' : `hover:bg-[var(--bg-tertiary)] ${showTimestamps ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}`}
        aria-label="Toggle timestamps"
        title="Toggle timestamps"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>
    </div>
  );
}

// --- Detail view: scrollable messages + fixed-bottom input ---

function SessionDetail({
  sessionId,
  sessionType,
  entityId,
  sessionStatus,
  sessionMetadata,
  onPause,
  onResume,
  onComplete,
  onRemake,
  isPausing,
  isResuming,
  isCompleting,
  isRemaking,
  showTimestamps,
}: {
  sessionId: string;
  sessionType: string;
  entityId: string | null;
  sessionStatus: string;
  sessionMetadata: Record<string, unknown> | null;
  onPause: () => void;
  onResume: () => void;
  onComplete: () => void;
  onRemake: () => void;
  isPausing: boolean;
  isResuming: boolean;
  isCompleting: boolean;
  isRemaking: boolean;
  showTimestamps: boolean;
}) {
  const navigate = useNavigate();
  const { getAccessTokenSilently } = useAuth0();
  const { session, isLoading } = useSession(sessionId);
  const { sendMessage, answerQuestion, isSending, isWaitingForResponse, toolActivity } = useSessionMessages(sessionId, session);
  const { upload: uploadFile, isUploading, error: uploadError, clearError: clearUploadError } = useFileUpload({
    apiUrl: "/api",
    getAccessToken: getAccessTokenSilently,
  });
  const [input, setInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const { hasPermission } = usePermissions();
  const canUpload = hasPermission("file:upload");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const messages = session?.messages ?? [];

  // Task progress for work sessions
  const isWorkSession = sessionType === "working" && !!entityId;
  const { task: entityTask } = useTask(isWorkSession ? entityId : null);
  const { tasks: allTasks } = useTasks(
    isWorkSession ? (session?.repoId ?? null) : null,
    isWorkSession && entityTask?.ideaId ? { ideaId: entityTask.ideaId } : undefined,
  );
  const taskProgress = useMemo(() => {
    if (!isWorkSession || allTasks.length === 0) return null;
    const leafTasks = allTasks.filter((b) => !b.isEpic);
    if (leafTasks.length === 0) return null;
    const completed = leafTasks.filter(
      (b) => b.status === "complete" || b.status === "archived",
    ).length;
    const inProgress = leafTasks.filter(
      (b) => b.status === "in_progress",
    ).length;
    const pct = Math.round((completed / leafTasks.length) * 100);
    const inProgressPct = Math.round((inProgress / leafTasks.length) * 100);
    return { completed, inProgress, total: leafTasks.length, pct, inProgressPct };
  }, [isWorkSession, allTasks]);

  // Phase progress for architecture sessions
  const isArchSession = sessionType === "architecture" && !!entityId;
  const { phases: archPhases } = useIdeaPhases(isArchSession ? entityId : null);
  const phaseProgress = useMemo(() => {
    if (!isArchSession || archPhases.length === 0) return null;
    const latest = archPhases.reduce((max, p) => p.phaseNumber > max.phaseNumber ? p : max, archPhases[0]);
    return { current: latest.phaseNumber, name: latest.phaseName, pct: Math.round((latest.phaseNumber / 8) * 100) };
  }, [isArchSession, archPhases]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Auto-resize textarea as content changes
  const resizeTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 150)}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [input, resizeTextarea]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() && !selectedFile) return;

    let attachmentIds: string[] | undefined;

    // Upload selected file first, then attach its ID to the message
    if (selectedFile) {
      clearUploadError();
      const attachment = await uploadFile(sessionId, selectedFile);
      if (!attachment) {
        // Upload failed — useFileUpload.error will have the message
        return;
      }
      attachmentIds = [attachment.id];
    }

    const content = input.trim() || (selectedFile ? `[Attached file: ${selectedFile.name}]` : "");
    await sendMessage(content, attachmentIds);
    setInput("");
    setSelectedFile(null);
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set false when leaving the container (not entering a child)
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  }, []);

  // Can link to idea page for architecture/spec sessions
  const ideaId = sessionType === "architecture" || sessionType === "spec"
    ? entityId
    : null;

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[var(--text-faint)] text-xs">Loading messages...</p>
      </div>
    );
  }

  return (
    <>
      {/* Phase progress bar for architecture sessions */}
      {phaseProgress && (
        <div className="px-4 py-2 border-b border-[var(--border-primary)] shrink-0">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)] mb-1">
            <span>Phase {phaseProgress.current}/8: {phaseProgress.name}</span>
            <span>{phaseProgress.pct}%</span>
          </div>
          <div className="w-full h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--accent-arch)] transition-all duration-300"
              style={{ width: `${phaseProgress.pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Task progress bar for work sessions */}
      {taskProgress && (
        <div className="px-4 py-2 border-b border-[var(--border-primary)] shrink-0">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)] mb-1">
            <span>
              {taskProgress.completed} of {taskProgress.total} tasks complete ({taskProgress.pct}%)
            </span>
            {taskProgress.inProgress > 0 && (
              <span className="text-amber-600">
                {taskProgress.inProgress} in progress
              </span>
            )}
          </div>
          <div className="w-full h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden flex">
            <div
              className="h-full bg-[var(--accent)] transition-all duration-300"
              style={{ width: `${taskProgress.pct}%` }}
            />
            <div
              className="h-full bg-amber-400 transition-all duration-300"
              style={{ width: `${taskProgress.inProgressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Pause banner */}
      {sessionStatus === "paused" && (
        <div className="sticky top-0 z-10 mx-4 mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-center gap-2">
          <svg className="w-4 h-4 text-yellow-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <p className="text-sm text-yellow-700">
            {sessionMetadata?.reason === "worker_disconnected"
              ? "Worker went offline — session will auto-resume when worker reconnects"
              : "Session paused"}
          </p>
        </div>
      )}

      {/* Scrollable messages area */}
      <div
        className="flex-1 overflow-y-auto px-4 py-3 space-y-2 relative"
        onDragOver={canUpload ? handleDragOver : undefined}
        onDragLeave={canUpload ? handleDragLeave : undefined}
        onDrop={canUpload ? handleDrop : undefined}
      >
        {/* Drop zone overlay */}
        {canUpload && isDragging && (
          <div className="absolute inset-0 bg-[var(--accent-light)]/80 border-2 border-dashed border-[var(--accent)] rounded-lg z-10 flex items-center justify-center">
            <div className="text-center">
              <svg className="w-8 h-8 text-[var(--accent)] mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm font-medium text-[var(--accent)]">Drop file to attach</p>
            </div>
          </div>
        )}
        {messages.length === 0 ? (
          <div className="text-center py-8">
            {sessionStatus === "active" ? (
              <div className="flex flex-col items-center gap-2">
                <span className="inline-flex gap-1">
                  <span className={`w-2 h-2 ${sessionType === 'architecture' || sessionType === 'spec' ? 'bg-[var(--accent-arch)]' : 'bg-[var(--accent)]'} rounded-full animate-bounce [animation-delay:0ms]`} />
                  <span className={`w-2 h-2 ${sessionType === 'architecture' || sessionType === 'spec' ? 'bg-[var(--accent-arch)]' : 'bg-[var(--accent)]'} rounded-full animate-bounce [animation-delay:150ms]`} />
                  <span className={`w-2 h-2 ${sessionType === 'architecture' || sessionType === 'spec' ? 'bg-[var(--accent-arch)]' : 'bg-[var(--accent)]'} rounded-full animate-bounce [animation-delay:300ms]`} />
                </span>
                <p className="text-[var(--text-faint)] text-xs">Starting session...</p>
              </div>
            ) : (
              <p className="text-[var(--text-faint)] text-xs">No messages yet.</p>
            )}
          </div>
        ) : (
          messages.map((msg) => {
            const attachments = (msg as typeof msg & { attachments?: { id: string; filename: string; mimeType: string; sizeBytes: number }[] }).attachments;
            // Structured question — interactive card
            if (msg.role === "assistant" && (msg as any).metadata?.type === "structured_question") {
              const meta = (msg as any).metadata;
              return (
                <div key={msg.id} className="mr-6">
                  <StructuredQuestion
                    messageId={msg.id}
                    questions={meta.questions ?? []}
                    onAnswer={(messageId, formattedResponse, selectedOptions) => {
                      answerQuestion(messageId, formattedResponse, selectedOptions);
                    }}
                    isAnswered={meta.answered === true}
                    selectedOptions={meta.selectedOptions ?? []}
                  />
                  <div className={`overflow-hidden transition-all duration-200 ${showTimestamps ? 'max-h-6 mt-1' : 'max-h-0'}`}>
                    <span className="text-[10px] text-[var(--text-faint)]">
                      {timeAgo(msg.createdAt)}
                    </span>
                  </div>
                </div>
              );
            }
            // Hide raw proposal JSON — show a link card instead
            if (msg.role === "assistant" && isProposalJson(msg.content)) {
              return (
                <div
                  key={msg.id}
                  className="bg-[var(--accent-light)] border border-[var(--accent)] rounded-lg p-3 mr-6"
                >
                  <p className="text-xs font-medium text-[var(--accent-emphasis)] mb-1">
                    Plan proposal generated
                  </p>
                  {ideaId && (
                    <button
                      onClick={() => navigate(`/ideas/${ideaId}`)}
                      className="text-xs text-[var(--accent)] underline cursor-pointer hover:text-[var(--accent-hover)]"
                    >
                      Review on idea page &rarr;
                    </button>
                  )}
                  <div className={`overflow-hidden transition-all duration-200 ${showTimestamps ? 'max-h-6 mt-1' : 'max-h-0'}`}>
                    <span className="text-[10px] text-[var(--text-faint)]">
                      {timeAgo(msg.createdAt)}
                    </span>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={msg.id}
                className={`text-xs p-2.5 rounded-lg ${
                  msg.role === "user"
                    ? "bg-[var(--accent-light)] text-[var(--accent-emphasis)] ml-6"
                    : msg.role === "assistant"
                      ? "bg-[var(--bg-secondary)] text-[var(--text-primary)] mr-6"
                      : "bg-[var(--bg-secondary)] text-[var(--accent)] border border-[var(--border-primary)] mr-6"
                }`}
              >
                <p className="text-[10px] font-medium text-[var(--text-faint)] mb-0.5">
                  {msg.role === "user" ? "You" : msg.role === "assistant" ? (msg.workerName ? `${msg.workerName} \u2013 praxis` : "AI") : (msg.workerName ? `${msg.workerName} \u2013 praxis` : "System")}
                </p>
                <MarkdownContent content={msg.content} />
                {/* File attachment cards */}
                {(attachments?.length ?? 0) > 0 && (
                  <div className="mt-1.5 space-y-1">
                    {attachments!.map((att) => (
                      <div
                        key={att.id}
                        className="flex items-center gap-2 px-2 py-1 bg-[var(--bg-primary)]/60 border border-[var(--border-primary)] rounded text-[10px]"
                      >
                        <span className="text-[var(--text-faint)]">
                          {att.mimeType.startsWith("image/") ? "\u{1F5BC}" : att.mimeType === "application/pdf" ? "\u{1F4C4}" : "\u{1F4CE}"}
                        </span>
                        <span className="font-medium text-[var(--text-secondary)] truncate">{att.filename}</span>
                        <span className="text-[var(--text-faint)] shrink-0">
                          {att.sizeBytes < 1024
                            ? `${att.sizeBytes} B`
                            : att.sizeBytes < 1048576
                              ? `${(att.sizeBytes / 1024).toFixed(0)} KB`
                              : `${(att.sizeBytes / 1048576).toFixed(1)} MB`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className={`overflow-hidden transition-all duration-200 ${showTimestamps ? 'max-h-6 mt-1' : 'max-h-0'}`}>
                  <span className="text-[10px] text-[var(--text-faint)]">
                    {timeAgo(msg.createdAt)}
                  </span>
                </div>
              </div>
            );
          })
        )}
        {(isSending || isWaitingForResponse || toolActivity) && (
          <div className="bg-[var(--bg-secondary)] text-[var(--text-muted)] mr-6 rounded-lg p-2.5 text-xs flex items-center gap-2">
            <span className="inline-flex gap-0.5">
              <span className="w-1.5 h-1.5 bg-[var(--text-faint)] rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 bg-[var(--text-faint)] rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 bg-[var(--text-faint)] rounded-full animate-bounce [animation-delay:300ms]" />
            </span>
            <span className="text-[var(--text-faint)]">
              {toolActivity ?? "AI is thinking..."}
            </span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Pause / Resume bar */}
      {(sessionStatus === "active" || sessionStatus === "paused") && (
        <div className="px-4 py-2 border-t border-[var(--border-primary)] flex gap-2 shrink-0">
          {sessionStatus === "active" && (
            <button
              type="button"
              onClick={onPause}
              disabled={isPausing}
              className="px-3 py-1 border border-[var(--border-secondary)] text-[var(--text-secondary)] rounded text-xs cursor-pointer disabled:opacity-60 hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              {isPausing ? "Pausing..." : "Pause"}
            </button>
          )}
          {sessionStatus === "paused" && (
            <button
              type="button"
              onClick={onResume}
              disabled={isResuming}
              className="px-3 py-1 border border-blue-300 text-blue-700 rounded text-xs cursor-pointer disabled:opacity-60 hover:bg-blue-50 transition-colors"
            >
              {isResuming ? "Resuming..." : "Resume"}
            </button>
          )}
          <button
            type="button"
            onClick={onComplete}
            disabled={isCompleting}
            className="px-3 py-1 border border-green-300 text-green-700 rounded text-xs cursor-pointer disabled:opacity-60 hover:bg-green-50 transition-colors"
          >
            {isCompleting ? "Completing..." : "Complete"}
          </button>
          <button
            type="button"
            onClick={onRemake}
            disabled={isRemaking}
            className="px-3 py-1 border border-orange-300 text-orange-700 rounded text-xs cursor-pointer disabled:opacity-60 hover:bg-orange-50 transition-colors ml-auto"
          >
            {isRemaking ? "Remaking..." : "Remake"}
          </button>
        </div>
      )}

      {/* Link to idea page for architecture sessions */}
      {ideaId && (
        <div className="px-4 py-2 border-t border-[var(--border-primary)] shrink-0">
          <button
            onClick={() => navigate(`/ideas/${ideaId}`)}
            className="text-xs text-[var(--accent)] hover:text-[var(--accent-hover)] cursor-pointer"
          >
            View idea page &rarr;
          </button>
        </div>
      )}

      {/* Hidden file input */}
      {canUpload && (
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            setSelectedFile(file);
            // Reset the input so selecting the same file again triggers onChange
            if (fileInputRef.current) fileInputRef.current.value = "";
          }}
          accept="image/*,text/*,.pdf,.json"
        />
      )}

      {/* Selected file chip */}
      {canUpload && selectedFile && (
        <div className="px-4 py-1.5 border-t border-[var(--border-primary)] flex items-center gap-2 shrink-0">
          <span className="text-xs bg-[var(--accent-light)] text-[var(--accent-emphasis)] px-2 py-0.5 rounded-full flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
            {selectedFile.name}
            <button
              type="button"
              onClick={() => setSelectedFile(null)}
              className="ml-0.5 text-[var(--accent)] hover:text-[var(--accent-hover)] cursor-pointer"
              aria-label="Remove file"
            >
              &times;
            </button>
          </span>
          <span className="text-[10px] text-[var(--text-faint)]">
            {(selectedFile.size / 1024).toFixed(0)} KB
          </span>
        </div>
      )}

      {/* Fixed-bottom input */}
      <form
        onSubmit={handleSend}
        className="px-4 py-3 border-t border-[var(--border-primary)] flex items-end gap-2 shrink-0 bg-[var(--bg-primary)]"
      >
        {canUpload && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2 text-[var(--text-faint)] hover:text-[var(--accent)] cursor-pointer transition-colors"
            aria-label="Attach file"
            title="Attach file"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>
        )}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (input.trim() || selectedFile) {
                handleSend(e as unknown as React.FormEvent);
              }
            }
          }}
          disabled={isSending}
          placeholder={isSending ? "Sending..." : isWaitingForResponse ? "AI is thinking..." : sessionStatus === "paused" ? "Session paused — type a message to resume..." : "Type a message..."}
          rows={1}
          className="flex-1 px-3 py-2 border border-[var(--border-secondary)] rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent)] focus:border-[var(--accent)] disabled:bg-[var(--bg-secondary)] disabled:text-[var(--text-faint)] resize-none overflow-y-auto"
          style={{ maxHeight: 150 }}
        />
        <button
          type="submit"
          disabled={isSending || isUploading || (!input.trim() && !selectedFile)}
          className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg text-sm cursor-pointer disabled:opacity-60 hover:bg-[var(--accent-hover)] transition-colors"
        >
          {isUploading ? "Uploading..." : isSending ? "..." : "Send"}
        </button>
      </form>
      {uploadError && (
        <div className="px-4 py-1.5 text-xs text-red-600 bg-red-50 border-t border-red-100">
          Upload failed: {uploadError}
        </div>
      )}
    </>
  );
}
