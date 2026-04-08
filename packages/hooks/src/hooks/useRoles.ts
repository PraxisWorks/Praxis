import { trpc } from "../trpc.js";

/**
 * Hook for managing permission roles including limit fields
 * (maxActiveSessions, maxOrgMemberships, maxReposPerOrg, maxIdeasPerRepo).
 * Limit fields flow through automatically via the typed tRPC client.
 */
export function useRoles() {
  const utils = trpc.useUtils();
  const listQuery = trpc.permission.listRoles.useQuery();
  const permissionsQuery = trpc.permission.listPermissions.useQuery();

  const createRole = trpc.permission.createRole.useMutation({
    onSuccess: () => utils.permission.listRoles.invalidate(),
  });
  const updateRole = trpc.permission.updateRole.useMutation({
    onSuccess: () => utils.permission.listRoles.invalidate(),
  });
  const deleteRole = trpc.permission.deleteRole.useMutation({
    onSuccess: () => utils.permission.listRoles.invalidate(),
  });
  const setRolePermissions = trpc.permission.setRolePermissions.useMutation({
    onSuccess: () => utils.permission.listRoles.invalidate(),
  });
  const defaultRoleQuery = trpc.permission.getDefaultRole.useQuery();
  const updateRoleLimits = trpc.permission.updateRoleLimits.useMutation({
    onSuccess: () => utils.permission.listRoles.invalidate(),
  });
  const setDefaultRoleMutation = trpc.permission.setDefaultRole.useMutation({
    onSuccess: () => {
      utils.permission.getDefaultRole.invalidate();
      utils.permission.listRoles.invalidate();
    },
  });

  return {
    roles: listQuery.data ?? [],
    allPermissions: permissionsQuery.data ?? [],
    isLoading: listQuery.isLoading,
    error: listQuery.error?.message ?? null,
    createRole: createRole.mutateAsync,
    updateRole: updateRole.mutateAsync,
    deleteRole: deleteRole.mutateAsync,
    setRolePermissions: setRolePermissions.mutateAsync,
    isCreating: createRole.isPending,
    isUpdating: updateRole.isPending,
    isDeleting: deleteRole.isPending,
    defaultRole: defaultRoleQuery.data ?? null,
    setDefaultRole: setDefaultRoleMutation.mutateAsync,
    isSettingDefault: setDefaultRoleMutation.isPending,
    updateRoleLimits: updateRoleLimits.mutateAsync,
    isUpdatingLimits: updateRoleLimits.isPending,
  };
}
