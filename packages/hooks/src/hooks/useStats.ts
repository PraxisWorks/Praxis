import { trpc } from "../trpc.js";

/** Stats data for a repo (or all repos when repoId is null). */
export function useStats(repoId: string | null) {
  const summaryQuery = trpc.stats.summary.useQuery({ repoId });
  const timelineQuery = trpc.stats.timeline.useQuery({ repoId });

  return {
    summary: summaryQuery.data ?? null,
    timeline: timelineQuery.data ?? null,
    isLoading: summaryQuery.isLoading || timelineQuery.isLoading,
    error: summaryQuery.error?.message ?? timelineQuery.error?.message ?? null,
  };
}
