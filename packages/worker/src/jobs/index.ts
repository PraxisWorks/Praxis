import type { WorkerConnection } from "../connection/index.js";
import type { StorageAdapter } from "../storage.js";
import {
  SESSION_START,
  SESSION_MESSAGE,
  SESSION_STOP,
  REPO_CREATE,
  REPO_BUILD_DEVICE,
  workerQueue,
} from "@praxis2/shared";
import type { SessionManager } from "../sessions/session-manager.js";
import { getLogger } from "../logger.js";
import { registerRepoCreateHandler } from "./repo-create.js";
import { registerRepoBuildDeviceHandler } from "./repo-build-device.js";
import { registerSessionStartHandler } from "./session-start.js";
import { registerSessionMessageHandler } from "./session-message.js";
import { registerSessionStopHandler } from "./session-stop.js";

/** Repo queues created on the default (non-scoped) names. */
const REPO_QUEUES = [REPO_CREATE, REPO_BUILD_DEVICE];

export async function registerAllHandlers(
  connection: WorkerConnection,
  sessionManager: SessionManager,
  storage: StorageAdapter,
  workerId?: string,
): Promise<void> {
  // repo queues: every worker listens on the default unscoped names so a
  // central worker (or any worker on a deploy without one) can still pick
  // up jobs that aren't routed to a specific worker.
  for (const queue of REPO_QUEUES) {
    await connection.createQueue(queue);
  }

  // Session queues: scoped to this worker when workerId is provided,
  // otherwise use the default (central) queue names.
  // The central worker (no workerId) also listens on its scoped queue
  // (session.start.00000000-...) because the API may route there when
  // users/orgs have activeWorkerId or centralWorkerId set to the central UUID.
  const CENTRAL_UUID = "00000000-0000-0000-0000-000000000000";
  const resolvedWorkerId = workerId ?? CENTRAL_UUID;

  const sessionStart = workerQueue(SESSION_START, resolvedWorkerId);
  const sessionMessage = workerQueue(SESSION_MESSAGE, resolvedWorkerId);
  const sessionStop = workerQueue(SESSION_STOP, resolvedWorkerId);

  for (const queue of [sessionStart, sessionMessage, sessionStop]) {
    await connection.createQueue(queue);
  }

  // Repo queues, scoped to this worker. The API now routes repo.create and
  // repo.build-device to the user's resolved worker via these scoped queues
  // so the worker that processes the job is guaranteed to have RLS visibility
  // on the repo. Local workers also listen on their own scoped names; the
  // central worker listens on its CENTRAL_UUID scoped names for the same
  // reason session queues do.
  const repoCreateScoped = workerQueue(REPO_CREATE, resolvedWorkerId);
  const repoBuildDeviceScoped = workerQueue(REPO_BUILD_DEVICE, resolvedWorkerId);
  for (const queue of [repoCreateScoped, repoBuildDeviceScoped]) {
    await connection.createQueue(queue);
  }

  // Central worker also listens on unscoped queues for backwards compatibility
  // (auto-resume reconciliation and legacy jobs use the base queue name).
  const extraQueues: string[] = [];
  if (!workerId) {
    for (const base of [SESSION_START, SESSION_MESSAGE, SESSION_STOP]) {
      await connection.createQueue(base);
      extraQueues.push(base);
    }
  }

  const logger = getLogger();
  logger.info(
    {
      sessionStart,
      sessionMessage,
      sessionStop,
      repoCreateScoped,
      repoBuildDeviceScoped,
      extraQueues,
      workerId: workerId ?? "central",
    },
    "Registering job handlers on queues",
  );

  // Register all job handlers. Repo handlers are registered on BOTH the bare
  // queue (legacy / unrouted jobs) AND the worker-scoped queue (the routing
  // path the API now prefers).
  await registerRepoCreateHandler(connection, REPO_CREATE);
  await registerRepoCreateHandler(connection, repoCreateScoped);
  await registerRepoBuildDeviceHandler(connection, REPO_BUILD_DEVICE);
  await registerRepoBuildDeviceHandler(connection, repoBuildDeviceScoped);

  await registerSessionStartHandler(connection, sessionManager, storage, sessionStart);
  await registerSessionMessageHandler(connection, sessionManager, storage, sessionMessage);
  await registerSessionStopHandler(connection, sessionManager, sessionStop);

  // Register handlers on unscoped queues too for central worker
  if (!workerId) {
    await registerSessionStartHandler(connection, sessionManager, storage, SESSION_START);
    await registerSessionMessageHandler(connection, sessionManager, storage, SESSION_MESSAGE);
    await registerSessionStopHandler(connection, sessionManager, SESSION_STOP);
  }
}
