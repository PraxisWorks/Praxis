import { trpc } from "../trpc.js";

export function useUserPermissions(userId: string | null) {
  const utils = trpc.useUtils();

  const overridesQuery = trpc.permission.listUserOverrides.useQuery(
    { userId: userId! },
    { enabled: !!userId },
  );

  const assignRole = trpc.permission.assignRole.useMutation({
    onSuccess: () => {
      utils.admin.listUsers.invalidate();
    },
  });

  const setOverride = trpc.permission.setUserOverride.useMutation({
    onSuccess: () => {
      utils.permission.listUserOverrides.invalidate();
    },
  });

  const removeOverride = trpc.permission.removeUserOverride.useMutation({
    onSuccess: () => {
      utils.permission.listUserOverrides.invalidate();
    },
  });

  return {
    overrides: overridesQuery.data ?? [],
    isLoading: overridesQuery.isLoading,
    error: overridesQuery.error?.message ?? null,
    assignRole: assignRole.mutateAsync,
    setOverride: setOverride.mutateAsync,
    removeOverride: removeOverride.mutateAsync,
    isAssigning: assignRole.isPending,
  };
}
