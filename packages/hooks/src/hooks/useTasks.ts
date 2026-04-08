import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";
import type { TaskStatus } from "@praxis2/shared";

// Match the actual API/DB return shape (Date -> string over wire)
type SerializedTask = {
  id: string;
  repoId: string;
  parentId: string | null;
  ideaId: string | null;
  title: string;
  description: string;
  notes: string | null;
  status: string;
  priority: string;
  isEpic: boolean;
  taskId: string | null;
  statusChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type TaskFilters = {
  status?: TaskStatus;
  parentId?: string | null;
  isEpic?: boolean;
  ideaId?: string;
};

/** List tasks for a rig (or all rigs when repoId is null). */
export function useTasks(repoId: string | null, filters?: TaskFilters) {
  const utils = trpc.useUtils();

  const input = { repoId, ...filters };
  const listQuery = trpc.task.list.useQuery(input);

  useSyncSubscription<SerializedTask>(trpc.task.onSync, {
    onCreated: () => {
      utils.task.list.invalidate();
    },
    onUpdated: (data) => {
      utils.task.list.invalidate();
      utils.task.getById.invalidate({ id: data.id });
    },
    onDeleted: () => {
      utils.task.list.invalidate();
    },
  });

  const createMutation = trpc.task.create.useMutation({
    onSuccess: () => utils.task.list.invalidate(),
  });
  const updateMutation = trpc.task.update.useMutation({
    onSuccess: () => utils.task.list.invalidate(),
  });
  const deleteMutation = trpc.task.delete.useMutation({
    onSuccess: () => utils.task.list.invalidate(),
  });

  return {
    tasks: listQuery.data?.items ?? [],
    nextCursor: listQuery.data?.nextCursor ?? null,
    isLoading: listQuery.isLoading,
    error: listQuery.error?.message ?? null,
    createTask: createMutation.mutateAsync,
    updateTask: updateMutation.mutateAsync,
    deleteTask: deleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
  };
}

/** Single task with dependencies. */
export function useTask(id: string | null) {
  const query = trpc.task.getById.useQuery(
    { id: id! },
    { enabled: !!id },
  );

  return {
    task: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error?.message ?? null,
  };
}

/** Dependency mutations (add/remove). */
export function useTaskDependencies() {
  const utils = trpc.useUtils();

  const addMutation = trpc.task.addDependency.useMutation({
    onSuccess: (_data, variables) => {
      utils.task.getById.invalidate({ id: variables.taskId });
      utils.task.list.invalidate();
    },
  });

  const removeMutation = trpc.task.removeDependency.useMutation({
    onSuccess: (_data, variables) => {
      utils.task.getById.invalidate({ id: variables.taskId });
      utils.task.list.invalidate();
    },
  });

  return {
    addDependency: addMutation.mutateAsync,
    removeDependency: removeMutation.mutateAsync,
    isAdding: addMutation.isPending,
    isRemoving: removeMutation.isPending,
  };
}
