import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock drizzle-orm operators
vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
}));

// Mock schema tables
vi.mock("../db/schema.js", () => ({
  roles: {
    id: "roles.id",
    maxWorkers: "roles.maxWorkers",
  },
}));

import { checkLimitFromRole } from "./checkLimitFromRole.js";

describe("checkLimitFromRole", () => {
  /**
   * Build a chainable mock DB.
   * select().from().where().limit() returns the role row.
   */
  function makeMockDb(roleRow: { limitValue: number | null } | undefined) {
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(() => Promise.resolve(roleRow ? [roleRow] : [])),
    };
    return db;
  }

  it("bypasses for admin users", async () => {
    const db = makeMockDb({ limitValue: 1 });
    const countQuery = vi.fn();
    await expect(
      checkLimitFromRole(db, "u1", "r1", "admin", "maxWorkers", countQuery),
    ).resolves.toBeUndefined();
    expect(db.select).not.toHaveBeenCalled();
    expect(countQuery).not.toHaveBeenCalled();
  });

  it("bypasses when roleId is null", async () => {
    const db = makeMockDb({ limitValue: 1 });
    const countQuery = vi.fn();
    await expect(
      checkLimitFromRole(db, "u2", null, "member", "maxWorkers", countQuery),
    ).resolves.toBeUndefined();
    expect(db.select).not.toHaveBeenCalled();
    expect(countQuery).not.toHaveBeenCalled();
  });

  it("bypasses when role limit is null (unlimited)", async () => {
    const db = makeMockDb({ limitValue: null });
    const countQuery = vi.fn();
    await expect(
      checkLimitFromRole(db, "u3", "r1", "member", "maxWorkers", countQuery),
    ).resolves.toBeUndefined();
    expect(countQuery).not.toHaveBeenCalled();
  });

  it("allows when count is below limit", async () => {
    const db = makeMockDb({ limitValue: 5 });
    const countQuery = vi.fn().mockResolvedValue(3);
    await expect(
      checkLimitFromRole(db, "u3", "r1", "member", "maxWorkers", countQuery),
    ).resolves.toBeUndefined();
    expect(countQuery).toHaveBeenCalledOnce();
  });

  it("throws FORBIDDEN when count >= limit", async () => {
    const db = makeMockDb({ limitValue: 3 });
    const countQuery = vi.fn().mockResolvedValue(3);
    await expect(
      checkLimitFromRole(db, "u3", "r1", "member", "maxWorkers", countQuery),
    ).rejects.toThrow("Worker limit reached (3/3)");
  });
});
