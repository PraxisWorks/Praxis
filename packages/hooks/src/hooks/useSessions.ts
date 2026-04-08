import { useEffect } from "react";
import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";
import type { SessionType, SessionStatus } from "@praxis2/shared";

type SerializedSession = {
  id: string;
  repoId: string;
  userId: string;
  type: string;
  entityType: string | null;
  entityId: string | null;
  title: string;
  status: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  repoColor: string | null;
  repoIcon: string | null;
  repoName: string | null;
  orgId: string | null;
  orgName: string | null;
  lastMessageAt: string;
  workerName?: string | null;
  workerStatus?: string | null;
  scheduledFor?: string | null;
  jobId?: string | null;
  lastMessageContent?: string | null;
  lastMessageRole?: string | null;
  taskTotal?: number | null;
  taskCompleted?: number | null;
  taskInProgress?: number | null;
  phaseCompleted?: number | null;
  latestPhaseName?: string | null;
};

export function useSessions(filters?: {
  repoId?: string;
  type?: SessionType;
  status?: SessionStatus;
  typeFilter?: string[];
  statusFilter?: string[];
  orgIds?: string[];
}) {
  const utils = trpc.useUtils();

  // Build input from either old-style or new-style filter keys
  const input: Record<string, unknown> = {};
  if (filters?.typeFilter && filters.typeFilter.length > 0) input.typeFilter = filters.typeFilter;
  else if (filters?.type) input.typeFilter = [filters.type];
  if (filters?.statusFilter && filters.statusFilter.length > 0) input.statusFilter = filters.statusFilter;
  else if (filters?.status) input.statusFilter = [filters.status];
  if (filters?.orgIds && filters.orgIds.length > 0) input.orgIds = filters.orgIds;

  const listQuery = trpc.session.list.useQuery(input);

  // Refetch on mount so navigating back from a chat view picks up
  // metadata changes (currentActivity) that arrived while unmounted.
  useEffect(() => {
    utils.session.list.invalidate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useSyncSubscription<SerializedSession>(trpc.session.onSync, {
    onCreated: () => {
      utils.session.list.invalidate();
    },
    onUpdated: () => {
      utils.session.list.invalidate();
    },
    onDeleted: () => {
      utils.session.list.invalidate();
    },
  });

  // Re-fetch session list when tasks change (to update progress counts)
  useSyncSubscription<any>(trpc.task.onSync, {
    onCreated: () => {
      utils.session.list.invalidate();
    },
    onUpdated: () => {
      utils.session.list.invalidate();
    },
    onDeleted: () => {
      utils.session.list.invalidate();
    },
  });

  // Re-fetch session list when phases change (to update architecture session progress)
  useSyncSubscription<any>(trpc.ideaPhase.onSync, {
    onCreated: () => {
      utils.session.list.invalidate();
    },
    onUpdated: () => {
      utils.session.list.invalidate();
    },
    onDeleted: () => {
      utils.session.list.invalidate();
    },
  });

  const createMutation = trpc.session.create.useMutation({
    onSuccess: () => utils.session.list.invalidate(),
  });

  const updateStatusMutation = trpc.session.updateStatus.useMutation({
    onSuccess: () => utils.session.list.invalidate(),
  });

  const startDebugMutation = trpc.session.startDebug.useMutation({
    onSuccess: () => utils.session.list.invalidate(),
  });

  const startWorkMutation = trpc.session.startWork.useMutation({
    onSuccess: () => utils.session.list.invalidate(),
  });

  const startRepoSessionMutation = trpc.session.startRepoSession.useMutation({
    onSuccess: () => utils.session.list.invalidate(),
  });

  const pauseMutation = trpc.session.pause.useMutation({
    onSuccess: () => utils.session.list.invalidate(),
  });

  const resumeMutation = trpc.session.resume.useMutation({
    onSuccess: () => utils.session.list.invalidate(),
  });

  const completeMutation = trpc.session.complete.useMutation({
    onSuccess: () => utils.session.list.invalidate(),
  });

  const renameMutation = trpc.session.rename.useMutation({
    onSuccess: () => utils.session.list.invalidate(),
  });

  const remakeMutation = trpc.session.remake.useMutation({
    onSuccess: () => utils.session.list.invalidate(),
  });

  const cancelScheduledMutation = trpc.session.cancelScheduled.useMutation({
    onSuccess: () => utils.session.list.invalidate(),
  });

  /**
   * Retry an errored session by creating a new session of the same type
   * for the same entity. Does NOT resume the errored session.
   */
  const retry = async (session: {
    repoId: string;
    type: string;
    title: string;
    entityType?: string | null;
    entityId?: string | null;
    prompt?: string | null;
  }) => {
    return createMutation.mutateAsync({
      repoId: session.repoId,
      type: session.type as SessionType,
      title: session.title,
      entityType: (session.entityType ?? undefined) as
        | "repo"
        | "idea"
        | "epic"
        | "task"
        | undefined,
      entityId: session.entityId ?? undefined,
      prompt: session.prompt ?? undefined,
    });
  };

  return {
    sessions: listQuery.data ?? [],
    sessionCount: listQuery.data?.length ?? 0,
    isLoading: listQuery.isLoading,
    error: listQuery.error?.message ?? null,
    createSession: createMutation.mutateAsync,
    updateStatus: updateStatusMutation.mutateAsync,
    startDebug: startDebugMutation.mutateAsync,
    startWork: startWorkMutation.mutateAsync,
    startRepoSession: startRepoSessionMutation.mutateAsync,
    pause: pauseMutation.mutateAsync,
    resume: resumeMutation.mutateAsync,
    complete: completeMutation.mutateAsync,
    rename: renameMutation.mutateAsync,
    remake: remakeMutation.mutateAsync,
    cancelScheduled: cancelScheduledMutation.mutateAsync,
    retry,
    isCreating: createMutation.isPending,
    isStartingDebug: startDebugMutation.isPending,
    isStartingWork: startWorkMutation.isPending,
    isStartingRepoSession: startRepoSessionMutation.isPending,
    isPausing: pauseMutation.isPending,
    isResuming: resumeMutation.isPending,
    isCompleting: completeMutation.isPending,
    isRenaming: renameMutation.isPending,
    isRemaking: remakeMutation.isPending,
    isCancellingScheduled: cancelScheduledMutation.isPending,
  };
}
