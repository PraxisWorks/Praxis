import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock drizzle-orm operators to be identity functions
vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
  and: (...args: unknown[]) => args,
  isNull: (col: unknown) => ({ isNull: col }),
}));

// Mock schema tables
vi.mock("../db/schema.js", () => ({
  tasks: {
    id: "tasks.id",
    parentId: "tasks.parentId",
    ideaId: "tasks.ideaId",
    status: "tasks.status",
  },
  ideas: {
    id: "ideas.id",
    status: "ideas.status",
  },
}));

// Mock shared
vi.mock("@praxis2/shared", () => ({
  syncChannel: (entity: string) => `sync:${entity}`,
}));

import {
  propagateInProgressUp,
  propagateCompleteUp,
} from "./propagateTaskStatus.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type QueryResult = unknown[];

/**
 * Creates a mock DB object that returns results from `querySequence` in order.
 *
 * Each element in the sequence corresponds to one top-level db.select() or
 * db.update()...returning() call. The mock handles two chainable patterns:
 *
 *   db.select().from(T).where(W).limit(N)   -> resolves to querySequence[i]
 *   db.select({ ... }).from(T).where(W)     -> resolves to querySequence[i]
 *   db.update(T).set(V).where(W).returning() -> resolves to querySequence[i]
 */
function createMockDb(querySequence: QueryResult[]) {
  let queryIndex = 0;

  function nextResult(): QueryResult {
    const results = querySequence[queryIndex] ?? [];
    queryIndex++;
    return results;
  }

  const mockDb = {
    select: vi.fn().mockImplementation(() => {
      // Capture the result at select() time so that the chained .where()
      // returns the correct value regardless of whether .limit() is called.
      const results = nextResult();
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            // The result object is thenable (for `const x = await ...`) AND
            // has a .limit() method (for `.limit(1)`).
            const thenable = {
              limit: vi.fn().mockResolvedValue(results),
              // Make the where-result itself thenable for chains without .limit()
              then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
                Promise.resolve(results).then(resolve, reject),
            };
            return thenable;
          }),
        }),
      };
    }),

    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockImplementation(() => {
            const results = nextResult();
            return Promise.resolve(results);
          }),
        }),
      }),
    })),
  };

  return mockDb;
}

function createMockPubsub() {
  return { publish: vi.fn().mockResolvedValue(undefined) };
}

// ---------------------------------------------------------------------------
// Tests: propagateInProgressUp
// ---------------------------------------------------------------------------

describe("propagateInProgressUp", () => {
  let mockPubsub: ReturnType<typeof createMockPubsub>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPubsub = createMockPubsub();
  });

  it("walks up a 3-level hierarchy setting each to in_progress", async () => {
    // Chain: task -> parent (draft) -> grandparent (draft) -> idea (planned)
    //
    // Call starts at parent level (parentId = "parent").
    // Query sequence:
    //   1. select parent        -> draft task with grandparent
    //   2. update parent        -> returns updated parent
    //   3. select grandparent   -> draft task at top level with ideaId
    //   4. update grandparent   -> returns updated grandparent
    //   5. select idea          -> planned idea
    //   6. update idea          -> returns updated idea
    const db = createMockDb([
      // 1 - select parent
      [{ id: "parent", parentId: "grandparent", ideaId: null, status: "draft" }],
      // 2 - update parent
      [{ id: "parent", parentId: "grandparent", ideaId: null, status: "in_progress" }],
      // 3 - select grandparent
      [{ id: "grandparent", parentId: null, ideaId: "idea-1", status: "draft" }],
      // 4 - update grandparent
      [{ id: "grandparent", parentId: null, ideaId: "idea-1", status: "in_progress" }],
      // 5 - select idea
      [{ id: "idea-1", status: "planned" }],
      // 6 - update idea
      [{ id: "idea-1", status: "in_progress" }],
    ]);

    await propagateInProgressUp(db as any, mockPubsub as any, "parent", null);

    // 2 task updates + 1 idea update = 3 update calls
    expect(db.update).toHaveBeenCalledTimes(3);
    // 2 task publishes + 1 idea publish = 3 publish calls
    expect(mockPubsub.publish).toHaveBeenCalledTimes(3);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:task",
      expect.objectContaining({ action: "updated" }),
    );
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:idea",
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("updates idea at the top when parentId is null", async () => {
    const db = createMockDb([
      // 1 - select idea
      [{ id: "idea-1", status: "planned" }],
      // 2 - update idea
      [{ id: "idea-1", status: "in_progress" }],
    ]);

    await propagateInProgressUp(db as any, mockPubsub as any, null, "idea-1");

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(mockPubsub.publish).toHaveBeenCalledTimes(1);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:idea",
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("stops when parent is already in_progress", async () => {
    const db = createMockDb([
      // 1 - select parent -> already in_progress
      [{ id: "parent-1", parentId: null, ideaId: "idea-1", status: "in_progress" }],
    ]);

    await propagateInProgressUp(db as any, mockPubsub as any, "parent-1", null);

    expect(db.update).not.toHaveBeenCalled();
    expect(mockPubsub.publish).not.toHaveBeenCalled();
  });

  it("stops when parent is already complete", async () => {
    const db = createMockDb([
      [{ id: "parent-1", parentId: null, ideaId: "idea-1", status: "complete" }],
    ]);

    await propagateInProgressUp(db as any, mockPubsub as any, "parent-1", null);

    expect(db.update).not.toHaveBeenCalled();
    expect(mockPubsub.publish).not.toHaveBeenCalled();
  });

  it("stops when parent is already archived", async () => {
    const db = createMockDb([
      [{ id: "parent-1", parentId: null, ideaId: null, status: "archived" }],
    ]);

    await propagateInProgressUp(db as any, mockPubsub as any, "parent-1", null);

    expect(db.update).not.toHaveBeenCalled();
    expect(mockPubsub.publish).not.toHaveBeenCalled();
  });

  it("handles null ideaId gracefully (parentId=null, ideaId=null)", async () => {
    const db = createMockDb([]);

    await propagateInProgressUp(db as any, mockPubsub as any, null, null);

    expect(db.select).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(mockPubsub.publish).not.toHaveBeenCalled();
  });

  it("handles missing parent gracefully (empty select result)", async () => {
    const db = createMockDb([
      // select returns empty -> parent not found
      [],
    ]);

    await propagateInProgressUp(db as any, mockPubsub as any, "nonexistent", null);

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.update).not.toHaveBeenCalled();
    expect(mockPubsub.publish).not.toHaveBeenCalled();
  });

  it("does not update idea already in_progress", async () => {
    const db = createMockDb([
      // select idea -> already in_progress
      [{ id: "idea-1", status: "in_progress" }],
    ]);

    await propagateInProgressUp(db as any, mockPubsub as any, null, "idea-1");

    expect(db.update).not.toHaveBeenCalled();
    expect(mockPubsub.publish).not.toHaveBeenCalled();
  });

  it("does not update idea already complete", async () => {
    const db = createMockDb([
      [{ id: "idea-1", status: "complete" }],
    ]);

    await propagateInProgressUp(db as any, mockPubsub as any, null, "idea-1");

    expect(db.update).not.toHaveBeenCalled();
    expect(mockPubsub.publish).not.toHaveBeenCalled();
  });

  it("does not update idea already dismissed", async () => {
    const db = createMockDb([
      [{ id: "idea-1", status: "dismissed" }],
    ]);

    await propagateInProgressUp(db as any, mockPubsub as any, null, "idea-1");

    expect(db.update).not.toHaveBeenCalled();
    expect(mockPubsub.publish).not.toHaveBeenCalled();
  });

  it("does not update idea already archived", async () => {
    const db = createMockDb([
      [{ id: "idea-1", status: "archived" }],
    ]);

    await propagateInProgressUp(db as any, mockPubsub as any, null, "idea-1");

    expect(db.update).not.toHaveBeenCalled();
    expect(mockPubsub.publish).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: propagateCompleteUp
// ---------------------------------------------------------------------------

describe("propagateCompleteUp", () => {
  let mockPubsub: ReturnType<typeof createMockPubsub>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPubsub = createMockPubsub();
  });

  it("marks parent complete when all children are terminal", async () => {
    // Query sequence:
    //   1. select children of parent -> all terminal
    //   2. update parent -> returns updated parent (top-level, has ideaId)
    //   3. select top-level tasks for idea -> includes only the just-completed parent
    //   4. update idea -> returns updated idea
    const db = createMockDb([
      // 1 - select children of parent-1
      [{ status: "complete" }, { status: "archived" }],
      // 2 - update parent-1 to complete
      [{ id: "parent-1", parentId: null, ideaId: "idea-1", status: "complete" }],
      // 3 - select top-level tasks for idea-1
      [{ status: "complete" }],
      // 4 - update idea-1 to complete
      [{ id: "idea-1", status: "complete" }],
    ]);

    await propagateCompleteUp(db as any, mockPubsub as any, "parent-1", null);

    // 1 parent update + 1 idea update = 2
    expect(db.update).toHaveBeenCalledTimes(2);
    // 1 task publish + 1 idea publish = 2
    expect(mockPubsub.publish).toHaveBeenCalledTimes(2);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:task",
      expect.objectContaining({ action: "updated" }),
    );
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:idea",
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("does NOT mark parent when some children are non-terminal", async () => {
    const db = createMockDb([
      // children: one complete, one still in_progress
      [{ status: "complete" }, { status: "in_progress" }],
    ]);

    await propagateCompleteUp(db as any, mockPubsub as any, "parent-1", null);

    expect(db.update).not.toHaveBeenCalled();
    expect(mockPubsub.publish).not.toHaveBeenCalled();
  });

  it("recurses up to idea level and marks idea complete", async () => {
    // Chain: children all terminal -> parent complete -> top-level tasks all terminal -> idea complete
    const db = createMockDb([
      // 1 - select children of parent
      [{ status: "complete" }, { status: "complete" }],
      // 2 - update parent to complete -> parent is under grandparent
      [{ id: "parent", parentId: "grandparent", ideaId: null, status: "complete" }],
      // 3 - select children of grandparent
      [{ status: "complete" }],
      // 4 - update grandparent to complete -> top-level with ideaId
      [{ id: "grandparent", parentId: null, ideaId: "idea-1", status: "complete" }],
      // 5 - select top-level tasks for idea-1
      [{ status: "complete" }],
      // 6 - update idea-1 to complete
      [{ id: "idea-1", status: "complete" }],
    ]);

    await propagateCompleteUp(db as any, mockPubsub as any, "parent", null);

    // 2 task updates + 1 idea update
    expect(db.update).toHaveBeenCalledTimes(3);
    // 2 task publishes + 1 idea publish
    expect(mockPubsub.publish).toHaveBeenCalledTimes(3);
  });

  it("handles mixed complete/archived siblings as terminal", async () => {
    const db = createMockDb([
      // children: mix of complete and archived -> all terminal
      [{ status: "complete" }, { status: "archived" }, { status: "complete" }],
      // update parent -> top-level, no further parent
      [{ id: "parent-1", parentId: null, ideaId: null, status: "complete" }],
      // parentId is null and ideaId is null (from updatedParent.ideaId ?? ideaId)
      // so propagateCompleteUp returns early with no idea check
    ]);

    await propagateCompleteUp(db as any, mockPubsub as any, "parent-1", null);

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(mockPubsub.publish).toHaveBeenCalledTimes(1);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:task",
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("handles null parentId with ideaId -- all top-level tasks complete", async () => {
    const db = createMockDb([
      // 1 - select top-level tasks for idea-1 -> all complete
      [{ status: "complete" }, { status: "complete" }],
      // 2 - update idea to complete
      [{ id: "idea-1", status: "complete" }],
    ]);

    await propagateCompleteUp(db as any, mockPubsub as any, null, "idea-1");

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(mockPubsub.publish).toHaveBeenCalledTimes(1);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:idea",
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("handles no top-level tasks (empty array returns without update)", async () => {
    const db = createMockDb([
      // select top-level tasks -> empty
      [],
    ]);

    await propagateCompleteUp(db as any, mockPubsub as any, null, "idea-1");

    expect(db.update).not.toHaveBeenCalled();
    expect(mockPubsub.publish).not.toHaveBeenCalled();
  });

  it("does not complete idea when some top-level tasks are not terminal", async () => {
    const db = createMockDb([
      // one complete, one still in_progress
      [{ status: "complete" }, { status: "in_progress" }],
    ]);

    await propagateCompleteUp(db as any, mockPubsub as any, null, "idea-1");

    expect(db.update).not.toHaveBeenCalled();
    expect(mockPubsub.publish).not.toHaveBeenCalled();
  });

  it("returns early when parentId and ideaId are both null", async () => {
    const db = createMockDb([]);

    await propagateCompleteUp(db as any, mockPubsub as any, null, null);

    expect(db.select).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(mockPubsub.publish).not.toHaveBeenCalled();
  });

  it("does not complete parent when children exist but one is draft", async () => {
    const db = createMockDb([
      [{ status: "complete" }, { status: "draft" }],
    ]);

    await propagateCompleteUp(db as any, mockPubsub as any, "parent-1", null);

    expect(db.update).not.toHaveBeenCalled();
    expect(mockPubsub.publish).not.toHaveBeenCalled();
  });
});
