import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";

type SerializedDeployment = {
  id: string;
  service: string;
  gitSha: string;
  deployedAt: string;
  createdAt: string;
};

export function useDeployments() {
  const utils = trpc.useUtils();
  const listQuery = trpc.deployment.list.useQuery();

  useSyncSubscription<SerializedDeployment>(trpc.deployment.onSync, {
    onCreated: () => utils.deployment.list.invalidate(),
    onUpdated: () => utils.deployment.list.invalidate(),
    onDeleted: () => utils.deployment.list.invalidate(),
  });

  return {
    deployments: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    error: listQuery.error?.message ?? null,
  };
}
