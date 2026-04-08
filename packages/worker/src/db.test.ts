import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock postgres and drizzle-orm before importing db module
const mockEnd = vi.fn().mockResolvedValue(undefined);
const mockSql = Object.assign(vi.fn(), { end: mockEnd });
const mockPostgres = vi.fn().mockReturnValue(mockSql);
const mockDrizzle = vi.fn().mockReturnValue({ query: {} });

vi.mock("postgres", () => ({
  default: mockPostgres,
}));

vi.mock("drizzle-orm/postgres-js", () => ({
  drizzle: mockDrizzle,
}));

// Import after mocks
const { initDb, getDb, closeDb } = await import("./db.js");

describe("db", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a drizzle instance via initDb", () => {
    const db = initDb("postgres://localhost:5432/test");
    expect(mockPostgres).toHaveBeenCalledWith("postgres://localhost:5432/test", {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
    expect(mockDrizzle).toHaveBeenCalledWith(mockSql);
    expect(db).toEqual({ query: {} });
  });

  it("getDb returns the initialized instance", () => {
    initDb("postgres://localhost:5432/test");
    const db = getDb();
    expect(db).toEqual({ query: {} });
  });

  it("closeDb ends the connection", async () => {
    initDb("postgres://localhost:5432/test");
    await closeDb();
    expect(mockEnd).toHaveBeenCalled();
  });
});
