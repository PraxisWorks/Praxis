/**
 * DbConnection — direct-to-Postgres implementation of WorkerConnection.
 *
 * Uses Drizzle ORM for queries, PgPubSub for sync events, and pg-boss
 * for the job queue. Created via `createDbConnection(config)`.
 */

import PgBoss from "pg-boss";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, isNull, isNotNull, inArray, sql, asc } from "drizzle-orm";
import { initDb, closeDb } from "../db.js";
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { PgPubSub } from "@praxis2/shared";
import {
  sessions,
  sessionMessages,
  rigs,
  tasks,
  taskDependencies,
  specs,
  ideas,
} from "@praxis2/api/schema";
import type {
  WorkerConnection,
  WorkerSession,
  WorkerRepo,
  WorkerTask,
  OrgSessionSettings,
  FileDownload,
  JobHandler,
} from "./types.js";
import type { SessionStatus, SessionType, MessageRole, SyncEvent } from "@praxis2/shared";

// ── Inline table definitions (avoid circular deps with api package) ──

const deploymentsTable = pgTable("deployments", {
  id: uuid("id").defaultRandom().primaryKey(),
  service: varchar("service", { length: 20 }).notNull().unique(),
  gitSha: varchar("git_sha", { length: 40 }).notNull(),
  deployedAt: timestamp("deployed_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

const workerStatusEnum = pgEnum("worker_status", ["online", "offline"]);

const workersTable = pgTable("workers", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id"),
  name: varchar("name", { length: 100 }).notNull(),
  status: workerStatusEnum("status").notNull().default("offline"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  rigInitSettings: jsonb("repo_init_settings"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

const organizationsTable = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
});

// ── Config type ──

export type DbConnectionConfig = {
  databaseUrl: string;
  userId?: string;
  maxConnections?: number;
};

// ── Factory ──

export function createDbConnection(config: DbConnectionConfig): WorkerConnection {
  const { databaseUrl, userId, maxConnections = 5 } = config;

  // Also initialize the global db singleton for backward compatibility.
  // Rig handlers and other central-only code may still use getDb() directly.
  initDb(databaseUrl, userId);

  // Inject app.user_id via the Postgres `options` connection parameter.
  // This sets the GUC at the protocol level on every new connection —
  // more reliable than the onconnect hook which can silently fail.
  let connUrl = databaseUrl;
  if (userId) {
    const url = new URL(databaseUrl);
    url.searchParams.set("options", `-c app.user_id=${userId}`);
    connUrl = url.toString();
  }

  // Initialize postgres connection pool.
  // Keep pool small (default 2) to stay within managed DB connection limits.
  const pgSql = postgres(connUrl, {
    max: Math.min(maxConnections, 2),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });

  const db = drizzle(pgSql);

  // Initialize PgPubSub
  const pubsub = new PgPubSub(connUrl);

  // Initialize pg-boss.
  // Two issues with pg-boss on managed Postgres:
  //
  // 1. pg-connection-string v2.11+ treats sslmode=require as verify-full,
  //    so we strip sslmode and pass ssl config explicitly.
  //
  // 2. pg-boss uses the `pg` driver (CJS) which can't be imported in our
  //    ESM bundle. Instead of creating a custom pg.Pool, we inject
  //    app.user_id via the Postgres `options` connection parameter
  //    (-c name=value), which sets GUC params at the protocol level.
  const needsInsecureSsl =
    databaseUrl.includes("sslmode=no-verify") ||
    databaseUrl.includes("sslmode=require");
  let bossUrl = needsInsecureSsl
    ? databaseUrl.replace(/[?&]sslmode=[^&]*/g, (m) => m[0] === "?" ? "?" : "")
        .replace(/\?$/, "")
        .replace(/\?&/, "?")
    : databaseUrl;
  // Inject app.user_id via the `options` connection parameter so every
  // pg connection (including pg-boss's internal pool) gets it set for RLS.
  if (userId) {
    const url = new URL(bossUrl);
    url.searchParams.set("options", `-c app.user_id=${userId}`);
    bossUrl = url.toString();
  }
  const boss = new PgBoss({
    connectionString: bossUrl,
    max: 1,
    ...(needsInsecureSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  boss.on("error", (error) => {
    console.error("[db-connection] pg-boss error:", error);
  });

  // ── Helpers ──

  function toWorkerSession(row: Record<string, unknown>): WorkerSession {
    return {
      id: row.id as string,
      status: row.status as SessionStatus,
      prompt: (row.prompt as string) ?? null,
      metadata: row.metadata as Record<string, unknown> | null,
      repoId: row.repoId as string,
      type: row.type as SessionType,
      entityType: (row.entityType as string) ?? null,
      entityId: (row.entityId as string) ?? null,
      workerId: (row.workerId as string) ?? null,
      claimedBy: (row.claimedBy as string) ?? null,
    };
  }

  function toWorkerRepo(row: Record<string, unknown>): WorkerRepo {
    return {
      id: row.id as string,
      name: row.name as string,
      status: row.status as WorkerRepo["status"],
      repo: (row.repo as string) ?? null,
      workspacePath: (row.workspacePath as string) ?? null,
      bdPrefix: row.bdPrefix as string,
      orgId: row.orgId as string,
    };
  }

  function toWorkerTask(row: Record<string, unknown>): WorkerTask {
    return {
      id: row.id as string,
      title: row.title as string,
      description: (row.description as string) ?? null,
      status: row.status as WorkerTask["status"],
      priority: row.priority as WorkerTask["priority"],
      isEpic: row.isEpic as boolean,
      taskId: (row.taskId as string) ?? null,
      parentId: (row.parentId as string) ?? null,
    };
  }

  async function collectDescendants(parentId: string): Promise<WorkerTask[]> {
    const children = await db
      .select()
      .from(tasks)
      .where(eq(tasks.parentId, parentId));

    const results: WorkerTask[] = [];
    for (const child of children) {
      const mapped = toWorkerTask(child as Record<string, unknown>);
      results.push(mapped);
      if (child.isEpic) {
        const nested = await collectDescendants(child.id as string);
        results.push(...nested);
      }
    }
    return results;
  }

  // ── Connection object ──

  const connection: WorkerConnection = {
    // ── Job Dispatch ──

    async startJobProcessing() {
      await boss.start();
    },

    async stopJobProcessing() {
      await boss.stop();
    },

    async createQueue(queueName: string) {
      await boss.createQueue(queueName);
    },

    async onJob<T = unknown>(queueName: string, handler: JobHandler<T>) {
      await boss.work<T>(queueName, async ([job]) => {
        await handler({ id: job.id, data: job.data });
      });
    },

    async sendJob(queueName: string, data: unknown) {
      await boss.send(queueName, data as object);
    },

    // ── Data Reads ──

    async getSession(sessionId: string) {
      const [row] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);
      if (!row) return null;
      return toWorkerSession(row as Record<string, unknown>);
    },

    async getRepo(repoId: string) {
      const [row] = await db
        .select()
        .from(rigs)
        .where(eq(rigs.id, repoId))
        .limit(1);
      if (!row) return null;
      return toWorkerRepo(row as Record<string, unknown>);
    },

    async getTask(taskId: string) {
      const [row] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);
      if (!row) return null;
      return toWorkerTask(row as Record<string, unknown>);
    },

    async getTaskAncestors(taskId: string) {
      const ancestors: WorkerTask[] = [];
      let currentId: string | null = taskId;

      while (currentId) {
        const [row] = await db
          .select()
          .from(tasks)
          .where(eq(tasks.id, currentId))
          .limit(1);

        if (!row) break;

        const mapped = toWorkerTask(row as Record<string, unknown>);
        const parentId = mapped.parentId;

        // Don't include the starting task, only its ancestors
        if (currentId !== taskId) {
          ancestors.push(mapped);
        }

        currentId = parentId;
      }

      return ancestors;
    },

    async getTaskDescendants(parentId: string) {
      return collectDescendants(parentId);
    },

    async getTaskDependencies(taskId: string) {
      const rows = await db
        .select()
        .from(taskDependencies)
        .where(eq(taskDependencies.taskId, taskId));
      return rows as unknown as import("@praxis2/shared").TaskDependency[];
    },

    async getSpec(repoId: string) {
      const [row] = await db
        .select()
        .from(specs)
        .where(eq(specs.repoId, repoId))
        .limit(1);
      if (!row) return null;
      return row as unknown as import("@praxis2/shared").Spec;
    },

    async getIdea(ideaId: string) {
      const [row] = await db
        .select()
        .from(ideas)
        .where(eq(ideas.id, ideaId))
        .limit(1);
      if (!row) return null;
      return row as unknown as import("@praxis2/shared").Idea;
    },

    async getSessionMessages(sessionId: string, limit?: number) {
      const query = db
        .select()
        .from(sessionMessages)
        .where(eq(sessionMessages.sessionId, sessionId))
        .orderBy(asc(sessionMessages.createdAt));

      const rows = limit ? await query.limit(limit) : await query;
      return rows as unknown as import("@praxis2/shared").SessionMessage[];
    },

    async getFile(_storageKey: string): Promise<FileDownload> {
      throw new Error("getFile not implemented in DbConnection — file storage is handled separately");
    },

    async getOrgSessionSettings(orgId: string, _sessionType: SessionType) {
      // Query the organizations table for AI/system instruction overrides.
      // These columns may not exist yet — return defaults if the query fails.
      try {
        const rows = await db.execute(
          sql`SELECT ai_instructions, system_instructions FROM organizations WHERE id = ${orgId} LIMIT 1`,
        );
        const row = (rows as unknown as Record<string, unknown>[])[0];
        if (!row) {
          return { aiInstructions: null, systemInstructions: null };
        }
        return {
          aiInstructions: (row.ai_instructions as string) ?? null,
          systemInstructions: (row.system_instructions as string) ?? null,
        };
      } catch {
        // Columns may not exist yet in the schema
        return { aiInstructions: null, systemInstructions: null };
      }
    },

    async getWorkerRepoInitSettings(workerId: string) {
      try {
        const rows = await db.execute(
          sql`SELECT repo_init_settings FROM workers WHERE id = ${workerId} LIMIT 1`,
        );
        const row = (rows as unknown as Record<string, unknown>[])[0];
        if (!row?.repo_init_settings) return null;
        return row.repo_init_settings as import("@praxis2/shared").RepoInitSettings;
      } catch {
        return null;
      }
    },

    async getOrphanedSessions(workerId: string | null) {
      const workerFilter = workerId
        ? eq(sessions.workerId, workerId)
        : isNull(sessions.workerId);

      const rows = await db
        .select()
        .from(sessions)
        .where(
          and(
            inArray(sessions.status, ["active", "error"]),
            workerFilter,
            isNotNull(sessions.claimedBy),
          ),
        );

      return rows.map((r) => toWorkerSession(r as Record<string, unknown>));
    },

    async getWorkerLastSeen(workerId: string) {
      const rows = await db.execute(
        sql`SELECT last_seen_at FROM workers WHERE id = ${workerId} LIMIT 1`,
      );
      const row = (rows as unknown as Record<string, unknown>[])[0];
      const rawLastSeen = row?.last_seen_at;
      if (!rawLastSeen) return null;
      return new Date(rawLastSeen as string);
    },

    // ── Data Writes ──

    async claimSession(sessionId: string, workerId: string) {
      const claimed = await db
        .update(sessions)
        .set({ claimedBy: workerId })
        .where(and(eq(sessions.id, sessionId), isNull(sessions.claimedBy)))
        .returning({ id: sessions.id });
      return claimed.length > 0;
    },

    async updateSessionStatus(sessionId: string, status: SessionStatus, options) {
      if (options?.metadata) {
        // Merge metadata into existing JSONB instead of overwriting.
        // This preserves fields like needsInput, error, etc.
        const metadataJson = JSON.stringify(options.metadata);
        const setClauses = [
          sql`status = ${status}`,
          sql`updated_at = now()`,
          sql`metadata = coalesce(metadata, '{}'::jsonb) || ${metadataJson}::jsonb`,
        ];
        if (options.clearClaim) {
          setClauses.push(sql`claimed_by = NULL`);
        }
        await db.execute(
          sql`UPDATE sessions SET ${sql.join(setClauses, sql`, `)} WHERE id = ${sessionId}`,
        );
      } else {
        // Clear currentActivity when leaving active state
        if (status !== "active") {
          const metadataJson = JSON.stringify({ currentActivity: null });
          const setClauses = [
            sql`status = ${status}`,
            sql`updated_at = now()`,
            sql`metadata = coalesce(metadata, '{}'::jsonb) || ${metadataJson}::jsonb`,
          ];
          if (options?.clearClaim) {
            setClauses.push(sql`claimed_by = NULL`);
          }
          await db.execute(
            sql`UPDATE sessions SET ${sql.join(setClauses, sql`, `)} WHERE id = ${sessionId}`,
          );
        } else {
          const set: Record<string, unknown> = {
            status,
            updatedAt: new Date(),
          };
          if (options?.clearClaim) {
            set.claimedBy = null;
          }
          await db
            .update(sessions)
            .set(set)
            .where(eq(sessions.id, sessionId));
        }
      }
    },

    async writeMessage(sessionId: string, role: MessageRole, content: string, workerName) {
      const [row] = await db
        .insert(sessionMessages)
        .values({
          sessionId,
          role,
          content,
          ...(workerName != null ? { workerName } : {}),
        })
        .returning({ id: sessionMessages.id });
      return row!.id as string;
    },

    async upsertSpec(repoId: string, title: string, content: string) {
      const existing = await db
        .select()
        .from(specs)
        .where(eq(specs.repoId, repoId))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(specs)
          .set({ title, content, updatedAt: new Date() })
          .where(eq(specs.repoId, repoId));
      } else {
        await db.insert(specs).values({ repoId, title, content });
      }
    },

    async upsertDeployment(service: string, gitSha: string, deployedAt: Date) {
      await db
        .insert(deploymentsTable)
        .values({ service, gitSha, deployedAt })
        .onConflictDoUpdate({
          target: deploymentsTable.service,
          set: { gitSha, deployedAt },
        });
    },

    // ── Sync / PubSub ──

    async publishSync(channel: string, event: SyncEvent) {
      await pubsub.publish(channel, event);
    },

    async subscribeSync(channel: string, handler) {
      return pubsub.subscribe(channel, handler as (data: unknown) => void);
    },

    // ── Worker Lifecycle ──

    async register(workerId: string, workerName: string, userIdParam) {
      await db
        .insert(workersTable)
        .values({
          id: workerId,
          userId: userIdParam ?? null,
          name: workerName,
          status: "online",
          lastSeenAt: new Date(),
        })
        .onConflictDoUpdate({
          target: workersTable.id,
          set: {
            status: "online" as const,
            lastSeenAt: new Date(),
            name: workerName,
            updatedAt: new Date(),
          },
        });
    },

    async heartbeat(workerId: string) {
      await db
        .update(workersTable)
        .set({
          lastSeenAt: new Date(),
          status: "online" as const,
          updatedAt: new Date(),
        })
        .where(eq(workersTable.id, workerId));
    },

    async markOffline(workerId: string) {
      await db
        .update(workersTable)
        .set({
          status: "offline",
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(workersTable.id, workerId));
    },

    // ── Cleanup ──

    async close() {
      await pubsub.close();
      await pgSql.end();
      // Also close the global db singleton for backward compat
      await closeDb();
      await boss.stop();
    },
  };

  return connection;
}
