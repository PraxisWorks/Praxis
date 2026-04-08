import { trpc } from "../trpc.js";

type RigInitSettings = {
  mode: "ruflo" | "custom";
  scripts?: string[];
};

/**
 * Hook for reading and writing worker rig init settings.
 */
export function useWorkerSettings(workerId: string | null) {
  const utils = trpc.useUtils();

  const settingsQuery = trpc.worker.getSettings.useQuery(
    { workerId: workerId! },
    { enabled: !!workerId },
  );

  const setSettingsMutation = trpc.worker.setSettings.useMutation({
    onSuccess: () => {
      if (workerId) {
        utils.worker.getSettings.invalidate({ workerId });
      }
    },
  });

  return {
    settings: (settingsQuery.data ?? null) as RigInitSettings | null,
    isLoading: settingsQuery.isLoading,
    setSettings: setSettingsMutation.mutateAsync,
    isSaving: setSettingsMutation.isPending,
    error: setSettingsMutation.error?.message ?? null,
  };
}
