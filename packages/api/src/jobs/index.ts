import PgBoss from "pg-boss";
import { REPO_CREATE, REPO_BUILD_DEVICE, SESSION_START, SESSION_MESSAGE, SESSION_STOP, GH_WEBHOOK_REGISTER, GH_WEBHOOK_DELETE, GH_DEPLOYMENT_RECONCILE, workerQueue } from "@praxis2/shared";
import { getLogger } from "../lib/logger.js";
import { registerExampleHandler, EXAMPLE_JOB } from "./handlers/example.js";
import {
  registerWelcomeNotificationHandler,
  WELCOME_NOTIFICATION,
} from "./handlers/sendWelcomeNotification.js";
import {
  registerByokTeardownWorkerHandler,
  BYOK_TEARDOWN_WORKER,
} from "./handlers/byokTeardownWorker.js";
import {
  registerByokProvisionWorkerHandler,
  BYOK_PROVISION_WORKER,
} from "./handlers/byokProvisionWorker.js";
import {
  registerByokOrphanCleanupHandler,
  BYOK_ORPHAN_CLEANUP,
} from "./handlers/byokOrphanCleanup.js";
import {
  registerProcessOrgInvitationHandler,
  PROCESS_ORG_INVITATION,
} from "./handlers/processOrgInvitation.js";
import { registerGhWebhookRegisterHandler } from "./handlers/ghWebhookRegister.js";
import { registerGhWebhookDeleteHandler } from "./handlers/ghWebhookDelete.js";
import { registerGhDeploymentReconcileHandler } from "./handlers/ghDeploymentReconcile.js";
import type { PgPubSub } from "../pubsub.js";

let boss: PgBoss | null = null;

export async function initJobs(connectionString: string, pubsub?: PgPubSub): Promise<void> {
  boss = new PgBoss({ connectionString, max: 3 });

  boss.on("error", (error) => {
    getLogger().error({ err: error }, "pg-boss error");
  });

  await boss.start();
  getLogger().info("pg-boss started");

  // pg-boss v10 requires explicit queue creation before work()/send()
  await boss.createQueue(EXAMPLE_JOB);
  await boss.createQueue(WELCOME_NOTIFICATION);
  await boss.createQueue(REPO_CREATE);
  await boss.createQueue(REPO_BUILD_DEVICE);
  await boss.createQueue(SESSION_START);
  await boss.createQueue(SESSION_MESSAGE);
  await boss.createQueue(SESSION_STOP);
  await boss.createQueue(BYOK_TEARDOWN_WORKER);
  await boss.createQueue(BYOK_PROVISION_WORKER);
  await boss.createQueue(BYOK_ORPHAN_CLEANUP);
  await boss.createQueue(GH_WEBHOOK_REGISTER);
  await boss.createQueue(GH_WEBHOOK_DELETE);
  await boss.createQueue(GH_DEPLOYMENT_RECONCILE);
  await boss.createQueue(PROCESS_ORG_INVITATION);

  await registerExampleHandler(boss);
  await registerWelcomeNotificationHandler(boss);
  await registerByokTeardownWorkerHandler(boss);
  await registerByokProvisionWorkerHandler(boss);
  await registerByokOrphanCleanupHandler(boss);
  await registerGhWebhookRegisterHandler(boss);
  await registerGhWebhookDeleteHandler(boss);
  await registerProcessOrgInvitationHandler(boss);
  if (pubsub) {
    await registerGhDeploymentReconcileHandler(boss, pubsub);
  }

  // Session job handlers are registered ONLY by the Worker package.
  // The API only creates queues and enqueues jobs — the Worker processes them
  // using real Anthropic API calls (conversational.ts).
}

export function getBoss(): PgBoss {
  if (!boss) throw new Error("pg-boss not initialized — call initJobs() first");
  return boss;
}

export async function closeJobs(): Promise<void> {
  if (boss) {
    await boss.stop();
    getLogger().info("pg-boss stopped");
  }
}

export async function cancelJob(queueName: string, jobId: string): Promise<void> {
  if (!boss) throw new Error("pg-boss not initialized");
  await boss.cancel(queueName, jobId);
}

export async function enqueueJob<T extends object>(
  name: string,
  data: T,
  options?: PgBoss.SendOptions & { workerId?: string },
): Promise<string | null> {
  if (!boss) throw new Error("pg-boss not initialized");
  const { workerId, ...sendOptions } = options ?? {};
  const queueName = workerId ? workerQueue(name, workerId) : name;
  // Create the worker-scoped queue if it doesn't exist
  if (workerId) await boss.createQueue(queueName);
  if (Object.keys(sendOptions).length > 0) return boss.send(queueName, data, sendOptions);
  return boss.send(queueName, data);
}
