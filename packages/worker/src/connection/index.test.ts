import { describe, it, expect, vi } from "vitest";
import type { WorkerConnection } from "./types.js";

// ── Mock the DB connection implementation ──

const fakeDbConnection = { close: vi.fn() } as unknown as WorkerConnection;

vi.mock("./db-connection.js", () => ({
  createDbConnection: vi.fn(() => fakeDbConnection),
}));

// Import after mocks are set up
import { createWorkerConnection } from "./index.js";
import { createDbConnection } from "./db-connection.js";

describe("createWorkerConnection", () => {
  it("returns a DbConnection", () => {
    const config = { connectionString: "postgres://localhost/test" };
    const result = createWorkerConnection(config as any);

    expect(createDbConnection).toHaveBeenCalledWith(config);
    expect(result).toBe(fakeDbConnection);
  });
});
