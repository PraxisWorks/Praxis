import { vi } from "vitest";

/**
 * Creates a mock database object with chainable methods that mirrors the
 * Drizzle query builder API. Uses a result queue to control sequential
 * query results (e.g., lookupUserId then fetch entity).
 */
export function createMockDb() {
  let resultQueue: unknown[] = [];

  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn(() => {
      const result = resultQueue.shift();
      return Promise.resolve(result ?? []);
    }),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    returning: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };

  function resetChains() {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockImplementation(() => {
      const result = resultQueue.shift();
      return Promise.resolve(result ?? []);
    });
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.onConflictDoUpdate.mockResolvedValue(undefined);
    mockDb.returning.mockResolvedValue([]);
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.delete.mockReturnThis();
  }

  return {
    mockDb,
    resultQueue,
    setResultQueue(queue: unknown[]) {
      resultQueue = queue;
      // Re-bind limit to read from the new queue reference
      mockDb.limit.mockImplementation(() => {
        const result = resultQueue.shift();
        return Promise.resolve(result ?? []);
      });
    },
    resetChains,
  };
}

/**
 * Creates a mock pubsub object.
 */
export function createMockPubsub() {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    close: vi.fn(),
  };
}

/**
 * Standard vi.mock blocks that must be called at the top level of test files.
 * These cannot be placed in a helper because vi.mock is hoisted by vitest.
 * Copy the following into each test file:
 *
 * vi.mock("../db/index.js", () => ({ ... }));
 * vi.mock("jose", () => ({ ... }));
 * vi.mock("../lib/logger.js", () => ({ ... }));
 * vi.mock("../jobs/index.js", () => ({ ... }));
 */
