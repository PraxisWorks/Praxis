import { trpc } from "../trpc.js";

export function useLimits() {
  const query = trpc.permission.myLimits.useQuery();

  const limits = query.data?.limits ?? null;
  const usage = query.data?.usage ?? null;

  function isAtLimit(type: "activeSessions" | "orgMemberships"): boolean {
    if (!limits || !usage) return false;
    const max =
      type === "activeSessions"
        ? limits.maxActiveSessions
        : limits.maxOrgMemberships;
    const current =
      type === "activeSessions" ? usage.activeSessions : usage.orgMemberships;
    if (max === null) return false; // unlimited
    return current >= max;
  }

  function usageLabel(type: "activeSessions" | "orgMemberships"): string {
    if (!limits || !usage) return "";
    const max =
      type === "activeSessions"
        ? limits.maxActiveSessions
        : limits.maxOrgMemberships;
    const current =
      type === "activeSessions" ? usage.activeSessions : usage.orgMemberships;
    if (max === null) return String(current); // unlimited, just show count
    return `${current}/${max}`;
  }

  return {
    limits,
    usage,
    isLoading: query.isLoading,
    isAtLimit,
    usageLabel,
  };
}
