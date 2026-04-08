export const REPO_CREATE = "repo.create";
export const REPO_BUILD_DEVICE = "repo.build-device";
export const SESSION_START = "session.start";
export const SESSION_MESSAGE = "session.message";
export const SESSION_STOP = "session.stop";
export const GH_WEBHOOK_REGISTER = "gh.webhook-register";
export const GH_WEBHOOK_DELETE = "gh.webhook-delete";
export const GH_DEPLOYMENT_RECONCILE = "gh.deployment-reconcile";

/**
 * Returns a worker-scoped queue name, e.g. 'session.start.<workerId>'
 * Used by local workers to subscribe to their own job queues.
 */
export function workerQueue(jobName: string, workerId: string): string {
  return `${jobName}.${workerId}`;
}
