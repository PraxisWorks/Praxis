import { describe, it, expect, vi, beforeEach } from "vitest";
import { deriveRoleName, provisionDbRole } from "./provisionDbRole.js";

// ---------------------------------------------------------------------------
// Tests: deriveRoleName
// ---------------------------------------------------------------------------

describe("deriveRoleName", () => {
  it("strips dashes from UUID and prepends prefix", () => {
    const result = deriveRoleName("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(result).toBe("praxis_user_a1b2c3d4e5f67890abcdef1234567890");
  });

  it("handles UUIDs without dashes (no-op)", () => {
    const result = deriveRoleName("abcdef1234567890abcdef1234567890");
    expect(result).toBe("praxis_user_abcdef1234567890abcdef1234567890");
  });

  it("returns consistent results for the same input", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    expect(deriveRoleName(id)).toBe(deriveRoleName(id));
  });
});

// ---------------------------------------------------------------------------
// Tests: provisionDbRole
// ---------------------------------------------------------------------------

describe("provisionDbRole", () => {
  let mockSql: { unsafe: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSql = {
      unsafe: vi.fn().mockResolvedValue([]),
    };
  });

  it("calls sql.unsafe twice (CREATE ROLE + GRANT)", async () => {
    await provisionDbRole(mockSql as any, "a1b2c3d4-e5f6-7890-abcd-ef1234567890");

    expect(mockSql.unsafe).toHaveBeenCalledTimes(2);
  });

  it("creates role with correct name in DO block", async () => {
    await provisionDbRole(mockSql as any, "a1b2c3d4-e5f6-7890-abcd-ef1234567890");

    const createCall = mockSql.unsafe.mock.calls[0][0] as string;
    expect(createCall).toContain("praxis_user_a1b2c3d4e5f67890abcdef1234567890");
    expect(createCall).toContain("DO $$");
    expect(createCall).toContain("CREATE ROLE");
    expect(createCall).toContain("pg_roles");
  });

  it("grants DML privileges on all application tables", async () => {
    await provisionDbRole(mockSql as any, "a1b2c3d4-e5f6-7890-abcd-ef1234567890");

    const grantCall = mockSql.unsafe.mock.calls[1][0] as string;
    expect(grantCall).toContain("GRANT SELECT, INSERT, UPDATE, DELETE");
    expect(grantCall).toContain("praxis_user_a1b2c3d4e5f67890abcdef1234567890");

    // Verify key tables are included
    const expectedTables = [
      "users", "notifications", "push_tokens", "repos", "specs",
      "ideas", "sessions", "session_messages", "session_attachments",
      "idea_attachments", "idea_phases", "plans", "tasks",
      "task_dependencies", "deployments", "workers", "worker_tokens",
    ];
    for (const table of expectedTables) {
      expect(grantCall).toContain(table);
    }
  });

  it("is safe to call multiple times (idempotent)", async () => {
    const userId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    await provisionDbRole(mockSql as any, userId);
    await provisionDbRole(mockSql as any, userId);

    // Each call produces 2 sql.unsafe invocations
    expect(mockSql.unsafe).toHaveBeenCalledTimes(4);

    // Both CREATE ROLE calls use the same role name
    const firstCreate = mockSql.unsafe.mock.calls[0][0] as string;
    const secondCreate = mockSql.unsafe.mock.calls[2][0] as string;
    expect(firstCreate).toBe(secondCreate);
  });

  it("propagates sql errors", async () => {
    mockSql.unsafe.mockRejectedValueOnce(new Error("connection refused"));

    await expect(
      provisionDbRole(mockSql as any, "some-id"),
    ).rejects.toThrow("connection refused");
  });
});
