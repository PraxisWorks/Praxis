import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";

type SerializedGhDeployment = {
  id: string;
  repoId: string;
  githubDeploymentId: string;
  environment: string;
  status: string;
  ref: string;
  description: string | null;
  url: string | null;
  creatorLogin: string | null;
  createdAt: string;
  updatedAt: string;
  repoName: string;
  repoColor: string;
};

export function useGhDeployments(repoId: string | null) {
  const utils = trpc.useUtils();
  const listQuery = trpc.ghDeployment.list.useQuery(
    { repoId: repoId ?? undefined },
  );

  useSyncSubscription<SerializedGhDeployment>(trpc.ghDeployment.onSync, {
    onCreated: () => utils.ghDeployment.list.invalidate(),
    onUpdated: () => utils.ghDeployment.list.invalidate(),
    onDeleted: () => utils.ghDeployment.list.invalidate(),
  });

  return {
    deployments: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    error: listQuery.error?.message ?? null,
  };
}
