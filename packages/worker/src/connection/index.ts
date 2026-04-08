/**
 * DB connection factory — creates a direct Postgres connection for the worker.
 */

import { createDbConnection } from "./db-connection.js";
import type { DbConnectionConfig } from "./db-connection.js";
import type { WorkerConnection } from "./types.js";

// Re-export all types from the types module
export type {
  WorkerConnection,
  JobPayload,
  JobHandler,
  WorkerRepo,
  WorkerSession,
  WorkerTask,
  OrgSessionSettings,
  FileDownload,
  SyncHandler,
} from "./types.js";

export { createDbConnection, type DbConnectionConfig } from "./db-connection.js";

export function createWorkerConnection(config: DbConnectionConfig): WorkerConnection {
  return createDbConnection(config);
}
