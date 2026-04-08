import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();
vi.mock("../../db/index.js", () => ({
  getDb: () => ({ execute: mockExecute }),
  getConnectionString: () => "postgresql://admin:secret@localhost:5432/praxis",
}));

const mockEnv: Record<string, string | undefined> = {};
vi.mock("../../lib/env.js", () => ({
  getEnv: () => mockEnv,
}));

const mockLogger = { info: vi.fn(), warn: vi.fn() };
vi.mock("../../lib/logger.js", () => ({
  getLogger: () => mockLogger,
}));

// Must import after mocks are declared
const { createSqlProvisioner } = await import("./sql.js");

describe("SqlProvisioner", () => {
  const provisioner = createSqlProvisioner({});
  const userId = "abc-def-123";
  const expectedRole = "praxis_worker_abc_def_123";

  beforeEach(() => {
    vi.clearAllMocks();
    delete mockEnv.DB_PUBLIC_PORT;
  });

  it("calls db.execute with CREATE ROLE SQL", async () => {
    await provisioner.createUser(userId);

    const createRoleCall = mockExecute.mock.calls[0][0] as string;
    expect(createRoleCall).toContain("CREATE ROLE");
    expect(createRoleCall).toContain(expectedRole);
    expect(createRoleCall).toContain("LOGIN NOBYPASSRLS");
  });

  it("calls db.execute with ALTER ROLE SET app.user_id", async () => {
    await provisioner.createUser(userId);

    const alterRoleCall = mockExecute.mock.calls[1][0] as string;
    expect(alterRoleCall).toContain(`ALTER ROLE "${expectedRole}" SET app.user_id = '${userId}'`);
  });

  it("calls db.execute with GRANT statements for public schema", async () => {
    await provisioner.createUser(userId);

    const calls = mockExecute.mock.calls.map((c) => c[0] as string);
    expect(calls).toContainEqual(expect.stringContaining(`GRANT USAGE ON SCHEMA public TO "${expectedRole}"`));
    expect(calls).toContainEqual(expect.stringContaining(`GRANT ALL ON ALL TABLES IN SCHEMA public TO "${expectedRole}"`));
    expect(calls).toContainEqual(expect.stringContaining(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "${expectedRole}"`));
    expect(calls).toContainEqual(expect.stringContaining(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${expectedRole}"`));
    expect(calls).toContainEqual(expect.stringContaining(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "${expectedRole}"`));
  });

  it("returns a valid databaseUrl with role name and password", async () => {
    const { databaseUrl } = await provisioner.createUser(userId);

    const url = new URL(databaseUrl);
    expect(url.username).toBe(expectedRole);
    expect(url.password).toHaveLength(64); // 32 bytes hex
    expect(url.hostname).toBe("localhost");
    expect(url.port).toBe("5432");
    expect(url.pathname).toBe("/praxis");
  });

  it("applies publicHost to the connection string when provided", async () => {
    const { databaseUrl } = await provisioner.createUser(userId, "db.example.com");

    const url = new URL(databaseUrl);
    expect(url.hostname).toBe("db.example.com");
  });

  it("applies DB_PUBLIC_PORT when set in env", async () => {
    mockEnv.DB_PUBLIC_PORT = "25060";

    const { databaseUrl } = await provisioner.createUser(userId);

    const url = new URL(databaseUrl);
    expect(url.port).toBe("25060");
  });

  it("succeeds when ALTER ROLE SET app.user_id is denied (managed Postgres)", async () => {
    let callCount = 0;
    mockExecute.mockImplementation(() => {
      callCount++;
      // Second call is ALTER ROLE SET app.user_id
      if (callCount === 2) {
        throw new Error('permission denied to set parameter "app.user_id"');
      }
      return Promise.resolve();
    });

    const { databaseUrl } = await provisioner.createUser(userId);

    expect(databaseUrl).toBeDefined();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ roleName: expectedRole }),
      "ALTER ROLE SET app.user_id not permitted (managed DB) — relying on client-side set_config",
    );
  });

  it("catches pgboss errors and logs them as warnings (non-fatal)", async () => {
    // Make the pgboss grant calls fail. The public schema grants (calls 0-6)
    // succeed, then the first pgboss call (call 7) throws.
    let callCount = 0;
    mockExecute.mockImplementation(() => {
      callCount++;
      // First 7 calls are: CREATE ROLE, ALTER ROLE SET, 5x public schema grants
      if (callCount > 7) {
        throw new Error("schema pgboss does not exist");
      }
      return Promise.resolve();
    });

    // Should not throw
    const { databaseUrl } = await provisioner.createUser(userId);

    expect(databaseUrl).toBeDefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ roleName: expectedRole }),
      "Failed to grant pgboss schema access (non-fatal)",
    );
  });
});
