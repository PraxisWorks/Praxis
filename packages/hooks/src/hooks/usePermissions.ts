import { trpc } from "../trpc.js";

export function usePermissions() {
  const query = trpc.permission.myPermissions.useQuery();

  const permissions = query.data?.permissions ?? [];
  const role = query.data?.role ?? null;

  // Check if user has a specific permission
  const hasPermission = (key: string): boolean => {
    return permissions.includes(key);
  };

  // Check if user has ALL of the specified permissions
  const hasAllPermissions = (...keys: string[]): boolean => {
    return keys.every((key) => permissions.includes(key));
  };

  // Check if user has ANY of the specified permissions
  const hasAnyPermission = (...keys: string[]): boolean => {
    return keys.some((key) => permissions.includes(key));
  };

  return {
    permissions,
    role,
    isLoading: query.isLoading,
    error: query.error?.message ?? null,
    hasPermission,
    hasAllPermissions,
    hasAnyPermission,
    isAdmin: role?.name === "admin",
  };
}
