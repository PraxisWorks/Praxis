import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { repos, users, workers, organizations, orgMemberWorkers } from "../db/schema.js";
import type { getDb } from "../db/index.js";
import { getLogger } from "./logger.js";

/**
 * Resolves the worker ID to route a session to.
 *
 * Routing is determined by the organization's workerPolicy:
 *  - central_worker: use the org's centralWorkerId (must be online)
 *  - require_local: use the user's orgMemberWorkers mapping (must be online)
 *  - user_default: check user's activeWorkerId, fall back to central worker
 *
 * Returns a worker UUID (routed to a worker-scoped queue) or undefined
 * (routed to the base queue, which the central worker listens on).
 */
export async function resolveWorkerForSession(
  db: ReturnType<typeof getDb>,
  userId: string,
  repoId: string,
): Promise<string | undefined> {
  const log = getLogger();
  const CENTRAL_UUID = "00000000-0000-0000-0000-000000000000";

  // 1. Look up the repo's orgId
  const [repo] = await db
    .select({ orgId: repos.orgId })
    .from(repos)
    .where(eq(repos.id, repoId))
    .limit(1);

  if (!repo) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Repo not found.",
    });
  }

  const { orgId } = repo;

  // 2. Fetch org's workerPolicy and centralWorkerId
  const [org] = await db
    .select({
      workerPolicy: organizations.workerPolicy,
      centralWorkerId: organizations.centralWorkerId,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (!org) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Organization not found.",
    });
  }

  const policy = org.workerPolicy;

  // ── central_worker mode ──────────────────────────────────────────
  if (policy === "central_worker") {
    if (!org.centralWorkerId) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "This organization uses a central worker but none is configured. Contact your org admin.",
      });
    }

    const [worker] = await db
      .select({ status: workers.status })
      .from(workers)
      .where(eq(workers.id, org.centralWorkerId))
      .limit(1);

    if (!worker || worker.status !== "online") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "This organization uses a central worker which is currently offline. Contact your org admin.",
      });
    }

    log.info(
      { orgId, policy, workerId: org.centralWorkerId, userId },
      "resolveWorkerForSession",
    );
    return org.centralWorkerId;
  }

  // ── require_local mode ───────────────────────────────────────────
  if (policy === "require_local") {
    const [mapping] = await db
      .select({ workerId: orgMemberWorkers.workerId })
      .from(orgMemberWorkers)
      .where(
        and(
          eq(orgMemberWorkers.orgId, orgId),
          eq(orgMemberWorkers.userId, userId),
        ),
      )
      .limit(1);

    if (!mapping?.workerId) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "This organization requires a local worker. Go to your org settings to assign one.",
      });
    }

    const [worker] = await db
      .select({ status: workers.status })
      .from(workers)
      .where(eq(workers.id, mapping.workerId))
      .limit(1);

    if (!worker || worker.status !== "online") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Your assigned local worker is currently offline. Please start it or contact your org admin.",
      });
    }

    log.info(
      { orgId, policy, workerId: mapping.workerId, userId },
      "resolveWorkerForSession",
    );
    return mapping.workerId;
  }

  // ── user_default mode (preserve existing behavior) ───────────────
  const [userRecord] = await db
    .select({ activeWorkerId: users.activeWorkerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (userRecord?.activeWorkerId) {
    log.info(
      { orgId, policy, workerId: userRecord.activeWorkerId, userId },
      "resolveWorkerForSession",
    );
    return userRecord.activeWorkerId;
  }

  // No active worker selected — check for an online central worker
  const [centralWorker] = await db
    .select({ id: workers.id })
    .from(workers)
    .where(and(eq(workers.id, CENTRAL_UUID), eq(workers.status, "online")))
    .limit(1);

  if (!centralWorker) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No worker available. Please connect a local worker or ensure the central worker is running.",
    });
  }

  // Central worker is online — return undefined to use the base queue
  // (central worker listens on unscoped queues)
  log.info(
    { orgId, policy, workerId: undefined, userId },
    "resolveWorkerForSession",
  );
  return undefined;
}
