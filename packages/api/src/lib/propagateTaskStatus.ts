import { eq, and, isNull } from "drizzle-orm";
import { syncChannel, type SyncEvent } from "@praxis2/shared";
import { tasks, ideas } from "../db/schema.js";
import type { Context } from "../context.js";

export type Logger = {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
  child: (bindings: Record<string, unknown>) => Logger;
};

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

/**
 * Walk UP the task tree, setting each ancestor to `in_progress`
 * until we reach one that is already `in_progress` (or beyond).
 * When the top-level task is reached and it has an ideaId, also
 * move the idea from `planned` to `in_progress`.
 */
export async function propagateInProgressUp(
  db: Context["db"],
  pubsub: Context["pubsub"],
  parentId: string | null,
  ideaId: string | null,
  logger: Logger = noopLogger,
): Promise<void> {
  logger.info({ parentId, ideaId, fn: "propagateInProgressUp" }, "Propagating in_progress status up");

  if (parentId === null) {
    // Reached the top of the tree -- propagate to the idea if applicable
    if (ideaId) {
      const [idea] = await db
        .select()
        .from(ideas)
        .where(eq(ideas.id, ideaId))
        .limit(1);

      if (idea && idea.status !== "in_progress" && idea.status !== "complete" && idea.status !== "dismissed" && idea.status !== "archived") {
        logger.info({ ideaId, fromStatus: idea.status, toStatus: "in_progress" }, "Updating idea to in_progress");

        const [updatedIdea] = await db
          .update(ideas)
          .set({ status: "in_progress", updatedAt: new Date() })
          .where(eq(ideas.id, ideaId))
          .returning();

        await pubsub.publish(syncChannel("idea"), {
          action: "updated",
          data: updatedIdea,
          timestamp: Date.now(),
        } satisfies SyncEvent<typeof updatedIdea>);
      }
    }
    return;
  }

  const [parent] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, parentId))
    .limit(1);

  if (!parent) return;

  // Stop if parent is already in_progress or beyond
  if (
    parent.status === "in_progress" ||
    parent.status === "complete" ||
    parent.status === "archived"
  ) {
    logger.info({ parentId, parentStatus: parent.status }, "Stopping propagation - parent already at or beyond in_progress");
    return;
  }

  logger.info({ parentId, fromStatus: parent.status, toStatus: "in_progress" }, "Updating parent task to in_progress");

  const now = new Date();
  const [updatedParent] = await db
    .update(tasks)
    .set({ status: "in_progress", statusChangedAt: now, updatedAt: now })
    .where(eq(tasks.id, parentId))
    .returning();

  await pubsub.publish(syncChannel("task"), {
    action: "updated",
    data: updatedParent,
    timestamp: Date.now(),
  } satisfies SyncEvent<typeof updatedParent>);

  // Continue walking up
  await propagateInProgressUp(db, pubsub, parent.parentId, parent.ideaId ?? ideaId, logger);
}

/**
 * Check whether all sibling tasks are terminal (`complete` | `archived`).
 * If so, mark the parent as `complete` and recurse upward.
 * When parentId is null, check all top-level tasks for the idea instead.
 */
export async function propagateCompleteUp(
  db: Context["db"],
  pubsub: Context["pubsub"],
  parentId: string | null,
  ideaId: string | null,
  logger: Logger = noopLogger,
): Promise<void> {
  logger.info({ parentId, ideaId, fn: "propagateCompleteUp" }, "Propagating complete status up");

  if (parentId === null) {
    // Idea-level completion check
    if (!ideaId) return;

    const topLevelTasks = await db
      .select({ status: tasks.status })
      .from(tasks)
      .where(and(eq(tasks.ideaId, ideaId), isNull(tasks.parentId)));

    const allTerminal =
      topLevelTasks.length > 0 &&
      topLevelTasks.every(
        (b) => b.status === "complete" || b.status === "archived",
      );

    if (!allTerminal) {
      logger.info({ ideaId, nonTerminal: topLevelTasks.filter(b => b.status !== "complete" && b.status !== "archived").length }, "Not all top-level tasks terminal, skipping idea completion");
      return;
    }

    logger.info({ ideaId, topLevelCount: topLevelTasks.length }, "All top-level tasks terminal, marking idea complete");

    const [updatedIdea] = await db
      .update(ideas)
      .set({ status: "complete", updatedAt: new Date() })
      .where(eq(ideas.id, ideaId))
      .returning();

    await pubsub.publish(syncChannel("idea"), {
      action: "updated",
      data: updatedIdea,
      timestamp: Date.now(),
    } satisfies SyncEvent<typeof updatedIdea>);

    return;
  }

  // Parent-level completion check
  const children = await db
    .select({ status: tasks.status })
    .from(tasks)
    .where(eq(tasks.parentId, parentId));

  const allTerminal =
    children.length > 0 &&
    children.every(
      (c) => c.status === "complete" || c.status === "archived",
    );

  if (!allTerminal) {
    logger.info({ parentId, nonTerminal: children.filter(c => c.status !== "complete" && c.status !== "archived").length }, "Not all children terminal, skipping parent completion");
    return;
  }

  logger.info({ parentId, childCount: children.length }, "All children terminal, marking parent complete");

  const now = new Date();
  const [updatedParent] = await db
    .update(tasks)
    .set({ status: "complete", statusChangedAt: now, updatedAt: now })
    .where(eq(tasks.id, parentId))
    .returning();

  await pubsub.publish(syncChannel("task"), {
    action: "updated",
    data: updatedParent,
    timestamp: Date.now(),
  } satisfies SyncEvent<typeof updatedParent>);

  // Recurse upward with the parent's own parentId / ideaId
  await propagateCompleteUp(
    db,
    pubsub,
    updatedParent.parentId,
    updatedParent.ideaId ?? ideaId,
    logger,
  );
}
