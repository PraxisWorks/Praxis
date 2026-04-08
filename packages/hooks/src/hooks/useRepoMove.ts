import { trpc } from "../trpc.js";
import { useAuth0 } from "@auth0/auth0-react";

function useAuth0Safe() {
  try {
    return useAuth0();
  } catch {
    return { isAuthenticated: false };
  }
}

/**
 * Hook for moving a repo between organizations.
 * Exposes the move mutation and a filtered list of admin+ orgs.
 */
export function useRepoMove() {
  const { isAuthenticated } = useAuth0Safe();
  const utils = trpc.useUtils();

  // Fetch the user's organizations to filter admin+ orgs
  const orgsQuery = trpc.organization.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // Filter to only orgs where user has admin or owner role
  const adminOrgs = (orgsQuery.data ?? []).filter(
    (org) => org.role === "admin" || org.role === "owner",
  );

  const moveMutation = trpc.repo.move.useMutation({
    onSuccess: () => {
      utils.repo.list.invalidate();
    },
  });

  return {
    moveRepo: moveMutation.mutateAsync,
    isMoving: moveMutation.isPending,
    moveError: moveMutation.error?.message ?? null,
    adminOrgs,
    isLoadingOrgs: orgsQuery.isLoading,
  };
}
