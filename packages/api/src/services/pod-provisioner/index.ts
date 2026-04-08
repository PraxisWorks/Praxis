import { getLogger } from "../../lib/logger.js";
import type { PodProvisionerAdapter } from "./types.js";
import { createConsolePodProvisionerAdapter } from "./console.js";
import { createK8sProvisionerAdapter } from "./k8s.js";

export type {
  PodProvisionerAdapter,
  CreatePodConfig,
  CreatePodResult,
  DeletePodConfig,
  DeletePodResult,
  GetPodStatusConfig,
  GetPodStatusResult,
} from "./types.js";
export { createConsolePodProvisionerAdapter } from "./console.js";
export { createK8sProvisionerAdapter } from "./k8s.js";

let instance: PodProvisionerAdapter | null = null;

export function getPodProvisionerAdapter(): PodProvisionerAdapter {
  if (instance) return instance;

  const provider = process.env.POD_PROVISIONER_PROVIDER;

  switch (provider) {
    case "k8s": {
      getLogger().info("Pod provisioner adapter: k8s");
      instance = createK8sProvisionerAdapter();
      break;
    }

    default:
      getLogger().info(
        "Pod provisioner adapter: console (no POD_PROVISIONER_PROVIDER set)",
      );
      instance = createConsolePodProvisionerAdapter();
      break;
  }

  return instance;
}

export function setPodProvisionerAdapter(adapter: PodProvisionerAdapter): void {
  instance = adapter;
}

export function resetPodProvisionerAdapter(): void {
  instance = null;
}
