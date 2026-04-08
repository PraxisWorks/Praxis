import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";
import { useAuth0 } from "@auth0/auth0-react";
import type { RepoStatus } from "@praxis2/shared";

/**
 * Safely attempt useAuth0 — returns { isAuthenticated: false } when called
 * outside an Auth0Provider (e.g. React Native / mobile).
 */
function useAuth0Safe() {
  try {
    return useAuth0();
  } catch {
    return { isAuthenticated: false };
  }
}

type UseReposOptions = {
  isAuthenticated?: boolean;
  orgId?: string;
};

// Hand-written serialized repo type matching the actual API/DB return shape.
// The Zod Repo type has `repo` and `description` as optional (can be undefined),
// but the DB select always returns them as string | null. Using Serialized<Repo>
// would preserve the `undefined` possibility, causing type mismatches with the
// tRPC query cache updater.
type SerializedRepo = {
  id: string;
  orgId: string;
  userId: string;
  name: string;
  repo: string | null;
  bdPrefix: string;
  color: string;
  icon: string | null;
  description: string | null;
  workspacePath: string | null;
  status: RepoStatus;
  createdAt: string;
  updatedAt: string;
};

/**
 * Hook for the repo list + CRUD + real-time sync.
 * Components call this to get the user's repos and mutate them.
 */
export function useRepos(options?: UseReposOptions) {
  const { isAuthenticated: auth0IsAuthenticated } = useAuth0Safe();
  const isAuthenticated = options?.isAuthenticated ?? auth0IsAuthenticated;
  const utils = trpc.useUtils();

  const listQuery = trpc.repo.list.useQuery(
    options?.orgId ? { orgId: options.orgId } : undefined,
    { enabled: isAuthenticated },
  );

  useSyncSubscription<SerializedRepo>(trpc.repo.onSync, {
    onCreated: () => utils.repo.list.invalidate(),
    onUpdated: () => utils.repo.list.invalidate(),
    onDeleted: () => utils.repo.list.invalidate(),
  });

  const createMutation = trpc.repo.create.useMutation({
    onSuccess: () => {
      utils.repo.list.invalidate();
    },
  });

  const updateMutation = trpc.repo.update.useMutation({
    onSuccess: () => {
      utils.repo.list.invalidate();
    },
  });

  const deleteMutation = trpc.repo.delete.useMutation({
    onSuccess: () => {
      utils.repo.list.invalidate();
    },
  });

  const buildDeviceMutation = trpc.repo.buildDevice.useMutation();

  return {
    repos: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    error: listQuery.error?.message ?? null,
    createRepo: createMutation.mutateAsync,
    updateRepo: updateMutation.mutateAsync,
    deleteRepo: deleteMutation.mutateAsync,
    buildDevice: buildDeviceMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isBuilding: buildDeviceMutation.isPending,
  };
}

/**
 * Hook for fetching a single repo by ID.
 * Used by components that need the full repo object (e.g., repo settings).
 */
export function useRepo(id: string | null) {
  const query = trpc.repo.getById.useQuery(
    { id: id! },
    { enabled: !!id },
  );

  return {
    repo: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error?.message ?? null,
  };
}
