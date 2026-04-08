import { getLogger } from "../../lib/logger.js";
import type { PodProvisionerAdapter } from "./types.js";

export function createConsolePodProvisionerAdapter(): PodProvisionerAdapter {
  return {
    async createPod(config) {
      getLogger().info(
        { name: config.name, namespace: config.namespace, template: config.template },
        "Pod created (console adapter — not actually provisioned)",
      );
      return { podName: config.name, status: "Running" };
    },

    async deletePod(config) {
      getLogger().info(
        { name: config.name, namespace: config.namespace },
        "Pod deleted (console adapter)",
      );
      return { success: true };
    },

    async getPodStatus(config) {
      getLogger().info(
        { name: config.name, namespace: config.namespace },
        "Pod status requested (console adapter)",
      );
      return { status: "Running", ready: true };
    },
  };
}
