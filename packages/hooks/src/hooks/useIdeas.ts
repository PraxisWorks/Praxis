import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";
import type { IdeaStatus } from "@praxis2/shared";

type SerializedIdea = {
  id: string;
  repoId: string;
  userId: string;
  title: string;
  description: string;
  status: string;
  source: string;
  tags: string[];
  size: string | null;
  planId: string | null;
  planStatus: string | null;
  topEpicId: string | null;
  completedTaskCount: number;
  totalTaskCount: number;
  latestPhaseNumber: number;
  latestPhaseName: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
};

export function useIdeas(repoId: string | null, status?: IdeaStatus) {
  const utils = trpc.useUtils();
  const input = { repoId, ...(status && { status }) };
  const listQuery = trpc.idea.list.useQuery(input);

  useSyncSubscription<SerializedIdea>(trpc.idea.onSync, {
    onCreated: (data) => {
      if (repoId !== null && data.repoId !== repoId) return;
      utils.idea.list.invalidate({ repoId });
    },
    onUpdated: () => {
      utils.idea.list.invalidate({ repoId });
    },
    onDeleted: (data) => {
      if (repoId !== null && "repoId" in data && data.repoId !== repoId) return;
      utils.idea.list.invalidate({ repoId });
    },
  });

  const createMutation = trpc.idea.create.useMutation({
    onSuccess: () => utils.idea.list.invalidate({ repoId }),
  });

  const updateMutation = trpc.idea.update.useMutation({
    onSuccess: () => utils.idea.list.invalidate({ repoId }),
  });

  const deleteMutation = trpc.idea.delete.useMutation({
    onSuccess: () => utils.idea.list.invalidate({ repoId }),
  });

  const reorderMutation = trpc.idea.reorder.useMutation({
    onSuccess: () => utils.idea.list.invalidate({ repoId }),
  });

  const startAutoSessionMutation =
    trpc.idea.startArchitectureSession.useMutation({
      onSuccess: () => utils.idea.list.invalidate({ repoId }),
    });

  const acceptPlanMutation = trpc.plan.accept.useMutation({
    onSuccess: () => utils.idea.list.invalidate({ repoId }),
  });

  const startWorkMutation = trpc.session.startWork.useMutation({
    onSuccess: () => utils.idea.list.invalidate({ repoId }),
  });

  const startDebugMutation = trpc.session.startDebug.useMutation({
    onSuccess: () => utils.idea.list.invalidate({ repoId }),
  });

  const archiveIdeaMutation = trpc.idea.archive.useMutation({
    onSuccess: () => utils.idea.list.invalidate({ repoId }),
  });

  useSyncSubscription<unknown>(trpc.plan.onSync, {
    onCreated: () => {
      utils.idea.list.invalidate({ repoId });
    },
    onUpdated: () => {
      utils.idea.list.invalidate({ repoId });
    },
    onDeleted: () => {
      utils.idea.list.invalidate({ repoId });
    },
  });

  useSyncSubscription<unknown>(trpc.task.onSync, {
    onCreated: () => {
      utils.idea.list.invalidate({ repoId });
    },
    onUpdated: () => {
      utils.idea.list.invalidate({ repoId });
    },
    onDeleted: () => {
      utils.idea.list.invalidate({ repoId });
    },
  });

  useSyncSubscription<unknown>(trpc.ideaPhase.onSync, {
    onCreated: () => {
      utils.idea.list.invalidate({ repoId });
    },
    onUpdated: () => {
      utils.idea.list.invalidate({ repoId });
    },
    onDeleted: () => {
      utils.idea.list.invalidate({ repoId });
    },
  });

  const isActing =
    startAutoSessionMutation.isPending ||
    acceptPlanMutation.isPending ||
    startWorkMutation.isPending ||
    startDebugMutation.isPending ||
    archiveIdeaMutation.isPending;

  return {
    ideas: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    error: listQuery.error?.message ?? null,
    createIdea: (data: {
      repoId: string;
      title: string;
      description: string;
      source?: "human" | "ai";
      tags?: string[];
      size?: "xs" | "s" | "m" | "l" | "xl";
    }) => createMutation.mutateAsync(data),
    updateIdea: updateMutation.mutateAsync,
    deleteIdea: (id: string) => deleteMutation.mutateAsync({ id }),
    reorderIdeas: reorderMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    startAutoSession: (ideaId: string, scheduledFor?: string) =>
      startAutoSessionMutation.mutateAsync({
        ideaId,
        phaseConfig: [
          "context",
          "requirements",
          "design",
          "architecture",
          "implementation",
          "validation",
          "documentation",
          "review",
        ].map((phase) => ({ phase, mode: "full-ai" as const })),
        ...(scheduledFor && { scheduledFor }),
      }),
    startConfiguredSession: (
      ideaId: string,
      phaseConfig: { phase: string; mode: "skip" | "full-ai" | "ai-assisted" }[],
      scheduledFor?: string,
    ) =>
      startAutoSessionMutation.mutateAsync({ ideaId, phaseConfig, ...(scheduledFor && { scheduledFor }) }),
    acceptPlan: (planId: string) =>
      acceptPlanMutation.mutateAsync({ id: planId }),
    startWork: (params: {
      repoId: string;
      entityType: "epic";
      entityId: string;
    }) => startWorkMutation.mutateAsync(params),
    startDebug: (params: {
      repoId: string;
      entityType: "epic";
      entityId: string;
    }) => startDebugMutation.mutateAsync(params),
    archiveIdea: (ideaId: string) =>
      archiveIdeaMutation.mutateAsync({ id: ideaId }),
    isStartingAutoSession: startAutoSessionMutation.isPending,
    isAcceptingPlan: acceptPlanMutation.isPending,
    isStartingWork: startWorkMutation.isPending,
    isStartingDebug: startDebugMutation.isPending,
    isArchiving: archiveIdeaMutation.isPending,
    isActing,
  };
}
