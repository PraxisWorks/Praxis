import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";
import type { PlanStatus } from "@praxis2/shared";

type SerializedPlan = {
  id: string;
  ideaId: string;
  repoId: string;
  sessionId: string;
  proposal?: unknown; // JSON
  status: PlanStatus;
  createdAt: string;
  updatedAt: string;
};

/**
 * Hook for fetching the plan associated with an idea + real-time sync.
 * Returns the plan (or null) and subscribes to plan sync events.
 */
export function usePlan(ideaId: string | null) {
  const utils = trpc.useUtils();

  const planQuery = trpc.plan.getByIdea.useQuery(
    { ideaId: ideaId! },
    { enabled: !!ideaId },
  );

  useSyncSubscription<SerializedPlan>(trpc.plan.onSync, {
    onCreated: () => {
      if (ideaId) utils.plan.getByIdea.invalidate({ ideaId });
    },
    onUpdated: () => {
      if (ideaId) utils.plan.getByIdea.invalidate({ ideaId });
    },
    onDeleted: () => {
      if (ideaId) utils.plan.getByIdea.invalidate({ ideaId });
    },
  });

  return {
    plan: planQuery.data ?? null,
    isLoading: planQuery.isLoading,
    error: planQuery.error?.message ?? null,
  };
}

/**
 * Hook for accepting a draft plan.
 * Invalidates plan and idea list caches on success.
 */
export function useAcceptPlan() {
  const utils = trpc.useUtils();

  const mutation = trpc.plan.accept.useMutation({
    onSuccess: (data) => {
      utils.plan.getByIdea.invalidate({ ideaId: data.ideaId });
      // Idea status changes to "planned" on accept, so invalidate the list
      utils.idea.list.invalidate();
    },
  });

  return {
    mutate: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error?.message ?? null,
  };
}

/**
 * Hook for rejecting a draft plan.
 * Invalidates plan and idea list caches on success.
 */
export function useRejectPlan() {
  const utils = trpc.useUtils();

  const mutation = trpc.plan.reject.useMutation({
    onSuccess: (data) => {
      utils.plan.getByIdea.invalidate({ ideaId: data.ideaId });
      // Idea status resets to "new" on reject, so invalidate the list
      utils.idea.list.invalidate();
    },
  });

  return {
    mutate: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error?.message ?? null,
  };
}

/**
 * Hook for updating the proposal on a draft plan (inline editing from UI).
 */
export function useUpdateProposal() {
  const utils = trpc.useUtils();

  const mutation = trpc.plan.updateProposal.useMutation({
    onSuccess: (data) => {
      utils.plan.getByIdea.invalidate({ ideaId: data.ideaId });
    },
  });

  return {
    mutate: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error?.message ?? null,
  };
}
