import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock drizzle-orm operators
vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
  and: (...args: unknown[]) => args,
  count: () => "count(*)",
  inArray: (col: unknown, vals: unknown[]) => ({ col, vals }),
}));

// Mock schema tables
vi.mock("../db/schema.js", () => ({
  roles: {
    id: "roles.id",
    maxActiveSessions: "roles.maxActiveSessions",
    maxOrgMemberships: "roles.maxOrgMemberships",
    maxReposPerOrg: "roles.maxReposPerOrg",
    maxIdeasPerRepo: "roles.maxIdeasPerRepo",
  },
  sessions: {
    userId: "sessions.userId",
    status: "sessions.status",
  },
  orgMembers: {
    userId: "orgMembers.userId",
  },
  repos: {
    orgId: "repos.orgId",
  },
  ideas: {
    repoId: "ideas.repoId",
  },
}));

// Mock logger
vi.mock("./logger.js", () => ({
  getLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

import { checkLimitFromRole } from "./checkLimit.js";
import type { RoleLimitType } from "./checkLimit.js";

describe("checkLimitFromRole", () => {
  const adminUser = { id: "u1", role: "admin", roleId: "r1" };
  const userNoRole = { id: "u2", role: "member", roleId: null };
  const userWithRole = { id: "u3", role: "member", roleId: "r1" };

  /**
   * Build a chainable mock DB.
   * - First chain (select/from/where/limit) returns the role row with limitValue.
   * - Second chain (select/from/where) returns the count row.
   */
  function makeMockDb(
    roleRow: { limitValue: number | null } | undefined,
    countValue = 0,
  ) {
    let callIndex = 0;
    const db = {
      select: vi.fn(() => {
        callIndex++;
        return db;
      }),
      from: vi.fn().mockReturnThis(),
      where: vi.fn(() => {
        // For the role lookup (first chain) we return via .limit()
        // For the count lookup (second chain) we resolve directly
        if (callIndex === 1) {
          return db;
        }
        // second chain — count query — no .limit() call, resolves as array
        return Promise.resolve([{ value: countValue }]);
      }),
      limit: vi.fn(() => {
        return Promise.resolve(roleRow ? [roleRow] : []);
      }),
    };
    return db;
  }

  it("bypasses for admin users", async () => {
    const db = makeMockDb({ limitValue: 1 });
    await expect(
      checkLimitFromRole(db, adminUser, "active_sessions"),
    ).resolves.toBeUndefined();
    expect(db.select).not.toHaveBeenCalled();
  });

  it("bypasses when user has no roleId", async () => {
    const db = makeMockDb({ limitValue: 1 });
    await expect(
      checkLimitFromRole(db, userNoRole, "active_sessions"),
    ).resolves.toBeUndefined();
    expect(db.select).not.toHaveBeenCalled();
  });

  it("bypasses when role not found", async () => {
    const db = makeMockDb(undefined);
    await expect(
      checkLimitFromRole(db, userWithRole, "active_sessions"),
    ).resolves.toBeUndefined();
  });

  it("bypasses when limit value is null (unlimited)", async () => {
    const db = makeMockDb({ limitValue: null });
    await expect(
      checkLimitFromRole(db, userWithRole, "active_sessions"),
    ).resolves.toBeUndefined();
  });

  it("allows when usage is below limit", async () => {
    const db = makeMockDb({ limitValue: 5 }, 3);
    await expect(
      checkLimitFromRole(db, userWithRole, "active_sessions"),
    ).resolves.toBeUndefined();
  });

  it("rejects when usage equals limit", async () => {
    const db = makeMockDb({ limitValue: 3 }, 3);
    await expect(
      checkLimitFromRole(db, userWithRole, "active_sessions"),
    ).rejects.toThrow("session limit reached");
  });

  it("rejects when usage exceeds limit", async () => {
    const db = makeMockDb({ limitValue: 3 }, 5);
    await expect(
      checkLimitFromRole(db, userWithRole, "active_sessions"),
    ).rejects.toThrow("session limit reached");
  });

  it("includes count in error message", async () => {
    const db = makeMockDb({ limitValue: 3 }, 3);
    await expect(
      checkLimitFromRole(db, userWithRole, "active_sessions"),
    ).rejects.toThrow("3/3");
  });

  it("checks org_memberships limit", async () => {
    const db = makeMockDb({ limitValue: 2 }, 2);
    await expect(
      checkLimitFromRole(db, userWithRole, "org_memberships"),
    ).rejects.toThrow("membership limit reached");
  });

  it("checks repos_per_org limit with scopeId", async () => {
    const db = makeMockDb({ limitValue: 1 }, 1);
    await expect(
      checkLimitFromRole(db, userWithRole, "repos_per_org", "org-123"),
    ).rejects.toThrow("Repo limit reached");
  });

  it("checks ideas_per_repo limit with scopeId", async () => {
    const db = makeMockDb({ limitValue: 5 }, 5);
    await expect(
      checkLimitFromRole(db, userWithRole, "ideas_per_repo", "repo-123"),
    ).rejects.toThrow("Idea limit reached");
  });

  it("throws Error when scopeId missing for repos_per_org", async () => {
    const db = makeMockDb({ limitValue: 5 }, 0);
    await expect(
      checkLimitFromRole(db, userWithRole, "repos_per_org"),
    ).rejects.toThrow("scopeId");
  });

  it("throws Error when scopeId missing for ideas_per_repo", async () => {
    const db = makeMockDb({ limitValue: 5 }, 0);
    await expect(
      checkLimitFromRole(db, userWithRole, "ideas_per_repo"),
    ).rejects.toThrow("scopeId");
  });
});
