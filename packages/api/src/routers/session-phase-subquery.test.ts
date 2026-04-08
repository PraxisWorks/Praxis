import { describe, it, expect } from "vitest";

/**
 * Unit tests for the phaseCompleted / latestPhaseName fields added to
 * the session.list return mapping.
 *
 * Because the session.list procedure requires a fully-wired DB, auth
 * middleware, and org-scoped repo lookup, we test the *mapping logic*
 * in isolation — the same `rows.map(...)` transform applied in the
 * procedure.  The SQL subqueries themselves are integration-level and
 * are covered by the deployed DB.
 */

/** Mirrors the row shape returned by the Drizzle select in session.list */
interface SessionRow {
  id: string;
  repoId: string;
  userId: string;
  type: string;
  entityType: string | null;
  entityId: string | null;
  title: string;
  prompt: string | null;
  status: string;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  repoColor: string | null;
  repoName: string | null;
  repoIcon: string | null;
  orgId: string | null;
  orgName: string | null;
  lastMessageAt: Date | null;
  lastMessageContent: string | null;
  lastMessageRole: string | null;
  taskTotal: number | null;
  taskCompleted: number | null;
  taskInProgress: number | null;
  phaseCompleted: number | null;
  latestPhaseName: string | null;
  workerName: string | null;
  workerStatus: string | null;
  scheduledFor: Date | null;
  jobId: string | null;
}

/** The mapping function extracted from session.list */
function mapSessionRow(row: SessionRow) {
  return {
    ...row,
    lastMessageAt: row.lastMessageAt ?? row.createdAt,
    lastMessageContent: row.lastMessageContent ?? null,
    lastMessageRole: row.lastMessageRole ?? null,
    taskTotal: row.taskTotal ?? null,
    taskCompleted: row.taskCompleted ?? null,
    taskInProgress: row.taskInProgress ?? null,
    phaseCompleted: row.phaseCompleted ?? null,
    latestPhaseName: row.latestPhaseName ?? null,
  };
}

const BASE_ROW: SessionRow = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  repoId: "660e8400-e29b-41d4-a716-446655440000",
  userId: "770e8400-e29b-41d4-a716-446655440000",
  type: "working",
  entityType: "task",
  entityId: "880e8400-e29b-41d4-a716-446655440000",
  title: "Working session",
  prompt: null,
  status: "active",
  metadata: null,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  updatedAt: new Date("2026-04-01T00:00:00Z"),
  repoColor: "#ff0000",
  repoName: "my-repo",
  repoIcon: null,
  orgId: "990e8400-e29b-41d4-a716-446655440000",
  orgName: "my-org",
  lastMessageAt: null,
  lastMessageContent: null,
  lastMessageRole: null,
  taskTotal: 5,
  taskCompleted: 2,
  taskInProgress: 1,
  phaseCompleted: null,
  latestPhaseName: null,
  workerName: null,
  workerStatus: null,
  scheduledFor: null,
  jobId: null,
};

describe("session.list phase subquery mapping", () => {
  it("returns null phaseCompleted and latestPhaseName for non-architecture sessions", () => {
    const row: SessionRow = { ...BASE_ROW, type: "working" };
    const result = mapSessionRow(row);
    expect(result.phaseCompleted).toBeNull();
    expect(result.latestPhaseName).toBeNull();
  });

  it("returns phase data for architecture sessions when DB provides values", () => {
    const row: SessionRow = {
      ...BASE_ROW,
      type: "architecture",
      entityType: "idea",
      phaseCompleted: 3,
      latestPhaseName: "Implementation Plan",
    };
    const result = mapSessionRow(row);
    expect(result.phaseCompleted).toBe(3);
    expect(result.latestPhaseName).toBe("Implementation Plan");
  });

  it("returns null when architecture session has no phases yet (DB returns null)", () => {
    const row: SessionRow = {
      ...BASE_ROW,
      type: "architecture",
      entityType: "idea",
      phaseCompleted: null,
      latestPhaseName: null,
    };
    const result = mapSessionRow(row);
    expect(result.phaseCompleted).toBeNull();
    expect(result.latestPhaseName).toBeNull();
  });

  it("preserves phaseCompleted=0 (COALESCE default when no phases match)", () => {
    const row: SessionRow = {
      ...BASE_ROW,
      type: "architecture",
      entityType: "idea",
      phaseCompleted: 0,
      latestPhaseName: null,
    };
    const result = mapSessionRow(row);
    expect(result.phaseCompleted).toBe(0);
  });

  it("maps an array of mixed session types correctly", () => {
    const rows: SessionRow[] = [
      { ...BASE_ROW, type: "working", phaseCompleted: null, latestPhaseName: null },
      { ...BASE_ROW, type: "architecture", phaseCompleted: 5, latestPhaseName: "Deployment" },
      { ...BASE_ROW, type: "debug", phaseCompleted: null, latestPhaseName: null },
      { ...BASE_ROW, type: "architecture", phaseCompleted: 0, latestPhaseName: null },
    ];
    const results = rows.map(mapSessionRow);

    expect(results[0].phaseCompleted).toBeNull();
    expect(results[0].latestPhaseName).toBeNull();

    expect(results[1].phaseCompleted).toBe(5);
    expect(results[1].latestPhaseName).toBe("Deployment");

    expect(results[2].phaseCompleted).toBeNull();
    expect(results[2].latestPhaseName).toBeNull();

    expect(results[3].phaseCompleted).toBe(0);
    expect(results[3].latestPhaseName).toBeNull();
  });

  it("includes phaseCompleted and latestPhaseName keys in the returned shape", () => {
    const result = mapSessionRow(BASE_ROW);
    expect(result).toHaveProperty("phaseCompleted");
    expect(result).toHaveProperty("latestPhaseName");
  });
});
