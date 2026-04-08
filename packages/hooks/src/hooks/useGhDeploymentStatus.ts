import { trpc } from "../trpc.js";

export function useGhDeploymentStatus(repoId: string | null) {
  const statusQuery = trpc.ghDeployment.status.useQuery(
    { repoId: repoId ?? undefined },
  );

  return {
    githubConfigured: statusQuery.data?.githubConfigured ?? null,
    repos: statusQuery.data?.repos ?? [],
    isLoading: statusQuery.isLoading,
  };
}
