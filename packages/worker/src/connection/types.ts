/**
 * WorkerConnection — abstraction over all worker-to-backend operations.
 *
 * Implementation: DbConnection — direct Postgres via Drizzle + PgPubSub + pg-boss.
 *
 * Consumer code (index.ts, job handlers, SessionManager) calls this interface.
 */

import type {
  Session,
  SessionStatus,
  SessionType,
  Repo,
  Task,
  TaskDependency,
  Spec,
  Idea,
  SessionMessage,
  MessageRole,
  SyncEvent,
  RepoInitSettings,
} from "@praxis2/shared";

// ─── Job Dispatch ────────────────────────────────────────────────

/** Payload shape for an incoming job from the queue. */
export type JobPayload<T = unknown> = {
  id: string;
  data: T;
};

/** Handler function for processing a job. */
export type JobHandler<T = unknown> = (job: JobPayload<T>) => Promise<void>;

// ─── Data Read Return Types ──────────────────────────────────────

/**
 * Minimal rig fields the worker actually needs.
 * Avoids pulling the full Repo schema when only a subset is used.
 */
export type WorkerRepo = Pick<Repo, "id" | "name" | "status"> & {
  repo: string | null;
  workspacePath: string | null;
  bdPrefix: string;
  orgId: string;
};

/**
 * Minimal session fields the worker needs for job processing.
 */
export type WorkerSession = Pick<Session, "id" | "status" | "prompt" | "metadata"> & {
  repoId: string;
  type: SessionType;
  entityType: string | null;
  entityId: string | null;
  workerId: string | null;
  claimedBy: string | null;
};

/**
 * Minimal task fields used in prompt context building.
 */
export type WorkerTask = Pick<Task, "id" | "title" | "description" | "status" | "priority" | "isEpic"> & {
  taskId: string | null;
  parentId: string | null;
};

/**
 * Organization-level settings that affect session behavior.
 */
export type OrgSessionSettings = {
  aiInstructions: string | null;
  systemInstructions: string | null;
};

/**
 * File download result from storage.
 */
export type FileDownload = {
  data: Buffer;
};

// ─── Sync / PubSub ──────────────────────────────────────────────

/** Handler for real-time sync events. */
export type SyncHandler = (event: SyncEvent) => void;

// ─── WorkerConnection Interface ──────────────────────────────────

export type WorkerConnection = {
  // ── Job Dispatch ─────────────────────────────────────────────

  /** Start the job processing system (pg-boss.start). */
  startJobProcessing(): Promise<void>;

  /** Stop accepting new jobs (pg-boss.stop). */
  stopJobProcessing(): Promise<void>;

  /** Create a named job queue. Idempotent. */
  createQueue(queueName: string): Promise<void>;

  /** Register a handler for jobs on the given queue. */
  onJob<T = unknown>(queueName: string, handler: JobHandler<T>): Promise<void>;

  /** Enqueue a job onto the given queue. */
  sendJob(queueName: string, data: unknown): Promise<void>;

  // ── Data Reads ───────────────────────────────────────────────

  /** Get a session by ID. Returns null if not found. */
  getSession(sessionId: string): Promise<WorkerSession | null>;

  /** Get a rig by ID. Returns null if not found. */
  getRepo(repoId: string): Promise<WorkerRepo | null>;

  /** Get a task by ID. Returns null if not found. */
  getTask(taskId: string): Promise<WorkerTask | null>;

  /**
   * Get all ancestor tasks from the given task up to the root.
   * Returns them in order from immediate parent to root.
   */
  getTaskAncestors(taskId: string): Promise<WorkerTask[]>;

  /**
   * Get all descendant tasks of a parent (recursive).
   * Used for building epic context in prompts.
   */
  getTaskDescendants(parentId: string): Promise<WorkerTask[]>;

  /**
   * Get dependency records for a task.
   * Returns the raw dependency edges (taskId -> dependsOnId).
   */
  getTaskDependencies(taskId: string): Promise<TaskDependency[]>;

  /** Get the spec for a rig. Returns null if none exists. */
  getSpec(repoId: string): Promise<Spec | null>;

  /** Get an idea by ID. Returns null if not found. */
  getIdea(ideaId: string): Promise<Idea | null>;

  /** Get messages for a session, ordered by creation time. */
  getSessionMessages(sessionId: string, limit?: number): Promise<SessionMessage[]>;

  /** Download a file by its storage key. */
  getFile(storageKey: string): Promise<FileDownload>;

  /**
   * Get organization-level session settings (AI instructions and
   * system instruction overrides) for a specific session type.
   */
  getOrgSessionSettings(orgId: string, sessionType: SessionType): Promise<OrgSessionSettings>;

  /**
   * Get rig init settings for a worker.
   * Returns null if no settings are stored (defaults apply).
   */
  getWorkerRepoInitSettings(workerId: string): Promise<RepoInitSettings | null>;

  /**
   * Find orphaned sessions that were active/error with a claim
   * when the worker restarted. Used by startup reconciliation.
   */
  getOrphanedSessions(workerId: string | null): Promise<WorkerSession[]>;

  /**
   * Get the worker's last heartbeat timestamp.
   * Returns null if the worker has never reported.
   */
  getWorkerLastSeen(workerId: string): Promise<Date | null>;

  // ── Data Writes ──────────────────────────────────────────────

  /**
   * Atomically claim a session for this worker.
   * Returns true if the claim succeeded (session was unclaimed),
   * false if another worker already claimed it.
   */
  claimSession(sessionId: string, workerId: string): Promise<boolean>;

  /**
   * Update a session's status and optional metadata.
   * Also clears claimedBy when appropriate (error, completed, paused).
   */
  updateSessionStatus(
    sessionId: string,
    status: SessionStatus,
    options?: {
      clearClaim?: boolean;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void>;

  /**
   * Insert a message into session_messages.
   * Returns the created message ID.
   */
  writeMessage(
    sessionId: string,
    role: MessageRole,
    content: string,
    workerName?: string | null,
  ): Promise<string>;

  /**
   * Upsert a spec for a rig. Creates if none exists, updates if one does.
   */
  upsertSpec(repoId: string, title: string, content: string): Promise<void>;

  /**
   * Upsert the worker's deployment record (git SHA + timestamp).
   */
  upsertDeployment(service: string, gitSha: string, deployedAt: Date): Promise<void>;

  // ── Sync / PubSub ───────────────────────────────────────────

  /**
   * Publish a sync event to a named channel via pg_notify.
   */
  publishSync(channel: string, event: SyncEvent): Promise<void>;

  /**
   * Subscribe to sync events on a named channel.
   * Returns an unsubscribe function.
   */
  subscribeSync(channel: string, handler: SyncHandler): Promise<() => void>;

  // ── Worker Lifecycle ─────────────────────────────────────────

  /**
   * Register this worker as online. Creates the row if it doesn't
   * exist, updates status + lastSeenAt if it does.
   */
  register(
    workerId: string,
    workerName: string,
    userId?: string | null,
  ): Promise<void>;

  /**
   * Send a heartbeat — updates lastSeenAt and confirms online status.
   */
  heartbeat(workerId: string): Promise<void>;

  /**
   * Mark the worker as offline (during graceful shutdown).
   */
  markOffline(workerId: string): Promise<void>;

  // ── Cleanup ──────────────────────────────────────────────────

  /**
   * Close all connections (DB pool, WS, pubsub listeners).
   * Must be called during shutdown.
   */
  close(): Promise<void>;
};
