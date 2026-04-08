import { getLogger } from "../../lib/logger.js";
import type { PodProvisionerAdapter } from "./types.js";

const NAMESPACE = "praxis-byok";

/**
 * Creates a Kubernetes-backed pod provisioner adapter.
 *
 * Uses dynamic import for `@kubernetes/client-node` so the package is not
 * required at compile time or in environments that use the console adapter.
 */
export function createK8sProvisionerAdapter(): PodProvisionerAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let k8sApi: any;

  async function getApi() {
    if (k8sApi) return k8sApi;
    // @ts-expect-error TS2307 — optional dependency, only installed in K8s environments
    const k8s = await import("@kubernetes/client-node");
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    return k8sApi;
  }

  return {
    async createPod(config) {
      const log = getLogger();
      try {
        const api = await getApi();
        const ns = config.namespace || NAMESPACE;

        // Create a Secret with the provided key/value pairs
        await api.createNamespacedSecret(ns, {
          metadata: { name: config.name, namespace: ns },
          stringData: config.secrets,
        });
        log.info({ name: config.name, namespace: ns }, "K8s Secret created");

        // Create the Pod, referencing the secret via envFrom
        await api.createNamespacedPod(ns, {
          metadata: { name: config.name, namespace: ns, labels: { app: config.template } },
          spec: {
            containers: [
              {
                name: config.template,
                image: config.template,
                envFrom: [{ secretRef: { name: config.name } }],
              },
            ],
            restartPolicy: "Never",
          },
        });
        log.info({ name: config.name, namespace: ns }, "K8s Pod created");

        return { podName: config.name, status: "Pending" };
      } catch (error) {
        log.error({ error, name: config.name }, "Failed to create K8s pod");
        return { podName: config.name, status: `Error: ${String(error)}` };
      }
    },

    async deletePod(config) {
      const log = getLogger();
      try {
        const api = await getApi();
        const ns = config.namespace || NAMESPACE;

        // Delete the pod
        await api.deleteNamespacedPod(config.name, ns);
        log.info({ name: config.name, namespace: ns }, "K8s Pod deleted");

        // Delete the associated secret (convention: secret name = pod name)
        await api.deleteNamespacedSecret(config.name, ns);
        log.info({ name: config.name, namespace: ns }, "K8s Secret deleted");

        return { success: true };
      } catch (error) {
        log.error({ error, name: config.name }, "Failed to delete K8s pod");
        return { success: false };
      }
    },

    async getPodStatus(config) {
      const log = getLogger();
      try {
        const api = await getApi();
        const ns = config.namespace || NAMESPACE;

        const response = await api.readNamespacedPod(config.name, ns);
        const phase = response.body?.status?.phase ?? "Unknown";
        const conditions = response.body?.status?.conditions ?? [];
        const ready = conditions.some(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (c: any) => c.type === "Ready" && c.status === "True",
        );

        log.info({ name: config.name, namespace: ns, phase, ready }, "K8s Pod status");
        return { status: phase, ready };
      } catch (error) {
        log.error({ error, name: config.name }, "Failed to get K8s pod status");
        return { status: `Error: ${String(error)}`, ready: false };
      }
    },
  };
}
