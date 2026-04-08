import "dotenv/config";
import { initConfig, type Config } from "./config.js";
import { initLogger, getLogger } from "./logger.js";
import { createWorkerConnection, type WorkerConnection } from "./connection/index.js";
import { registerAllHandlers } from "./jobs/index.js";
import { SessionManager } from "./sessions/session-manager.js";
import { autoResumeOrphanedSessions } from "./sessions/startup-reconciliation.js";
import { checkStaleSessions } from "./sessions/stale-session-check.js";
import type { StorageAdapter } from "./storage.js";
import {
  createS3StorageAdapter,
  createLocalStorageAdapter,
  createConsoleStorageAdapter,
} from "./storage.js";

function createStorage(config: Config, logger: ReturnType<typeof getLogger>): StorageAdapter {
  switch (config.STORAGE_PROVIDER) {
    case "s3": {
      if (!config.S3_BUCKET) {
        throw new Error("STORAGE_PROVIDER=s3 requires S3_BUCKET to be set");
      }
      logger.info({ bucket: config.S3_BUCKET, region: config.S3_REGION }, "Storage adapter: S3");
      return createS3StorageAdapter({
        bucket: config.S3_BUCKET,
        region: config.S3_REGION,
        accessKeyId: config.AWS_ACCESS_KEY_ID,
        secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
        endpoint: config.S3_ENDPOINT,
      });
    }
    case "local": {
      const baseDir = config.STORAGE_LOCAL_DIR ?? "./uploads";
      logger.info({ baseDir }, "Storage adapter: local");
      return createLocalStorageAdapter(baseDir);
    }
    default:
      logger.info("Storage adapter: console (no STORAGE_PROVIDER set)");
      return createConsoleStorageAdapter();
  }
}

async function main(): Promise<void> {
  const config = initConfig(process.env as Record<string, string | undefined>);
  const logger = initLogger(config.LOG_LEVEL, config.NODE_ENV);

  logger.info("Worker starting...");

  // Create the DB connection
  const connection: WorkerConnection = createWorkerConnection({
    databaseUrl: config.DATABASE_URL,
    userId: config.WORKER_USER_ID,
  });

  logger.info("WorkerConnection initialized");

  // Create SessionManager with connection
  const sessionManager = new SessionManager(connection, config.WORKER_NAME);
  logger.info("SessionManager initialized");

  // Start job processing (pg-boss)
  await connection.startJobProcessing();
  logger.info("Job processing started");

  // Create storage adapter for file attachment delivery
  const storage = createStorage(config, logger);

  // Register job handlers (must happen before reconciliation so resume jobs
  // enqueued during reconciliation can be immediately processed)
  await registerAllHandlers(connection, sessionManager, storage, config.WORKER_ID);
  logger.info(
    { workerId: config.WORKER_ID ?? "central" },
    "Job handlers registered",
  );

  // Run startup reconciliation (once, not polling):
  // Auto-resumes any orphaned "active" sessions by clearing claimedBy and
  // enqueuing SESSION_START jobs. Now runs AFTER handlers are registered so
  // any resume jobs enqueued can be processed immediately.
  await autoResumeOrphanedSessions(connection, config.WORKER_ID);
  logger.info("Auto-resume reconciliation complete");

  // Check for stale sessions (backup catch for anything reconciliation missed)
  await checkStaleSessions(connection, sessionManager, config.WORKER_ID);
  logger.info("Stale session check complete");

  logger.info("Worker ready");

  // Start heartbeat (every 30 seconds)
  const HEARTBEAT_INTERVAL_MS = 30_000;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  // Self-register deployment if GIT_SHA is available
  if (config.GIT_SHA) {
    try {
      const deployedAt = config.DEPLOY_TIMESTAMP
        ? new Date(config.DEPLOY_TIMESTAMP)
        : new Date();

      await connection.upsertDeployment("worker", config.GIT_SHA, deployedAt);

      await connection.publishSync("sync:deployment", {
        action: "updated",
        data: { service: "worker", gitSha: config.GIT_SHA },
        timestamp: Date.now(),
      });

      logger.info({ gitSha: config.GIT_SHA }, "Worker deployment registered");
    } catch (err) {
      logger.error({ err }, "Failed to register worker deployment");
    }
  }

  // Self-register worker. All workers (central and local) register in the
  // workers table so the API can verify they're online before routing jobs.
  // Central worker has null userId since it's not user-specific.
  const CENTRAL_UUID = "00000000-0000-0000-0000-000000000000";
  const workerId = config.WORKER_ID ?? CENTRAL_UUID;
  const workerName = config.WORKER_NAME;
  const isCentral = !config.WORKER_ID;

  try {
    await connection.register(
      workerId,
      workerName,
      isCentral ? null : config.WORKER_USER_ID,
    );
    logger.info({ workerId, workerName, isCentral }, "Worker registered as online");
  } catch (err) {
    logger.error({ err }, "Failed to register worker");
  }

  // Heartbeat for all workers
  heartbeatTimer = setInterval(async () => {
    try {
      await connection.heartbeat(workerId);
    } catch (err) {
      logger.warn({ err, workerId }, "Heartbeat update failed");
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Graceful shutdown
  let isShuttingDown = false;
  const DRAIN_TIMEOUT_MS = 60_000;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info({ signal }, "Shutting down worker...");

    // 1. Clear heartbeat timer
    if (heartbeatTimer) clearInterval(heartbeatTimer);

    // 2. Stop accepting new jobs
    try { await connection.stopJobProcessing(); } catch (e) { logger.error(e, "Error stopping job processing"); }

    // 3. Wait for active sessions to drain (60s timeout)
    try {
      logger.info("Waiting for active sessions to drain...");
      await Promise.race([
        sessionManager.shutdownAll(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Drain timeout")), DRAIN_TIMEOUT_MS),
        ),
      ]);
      logger.info("All sessions drained");
    } catch (e) {
      logger.warn(e, "Session drain timed out or errored, forcing shutdown");
    }

    // 4. Mark worker offline
    try {
      await connection.markOffline(workerId);
      logger.info({ workerId }, "Worker marked as offline");
    } catch (e) {
      logger.error(e, "Error marking worker offline");
    }

    // 5. Close all connections
    try { await connection.close(); } catch (e) { logger.error(e, "Error closing connection"); }

    logger.info("Worker shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  const logger = getLogger();
  logger.fatal({ err }, "Worker failed to start");
  process.exit(1);
});
