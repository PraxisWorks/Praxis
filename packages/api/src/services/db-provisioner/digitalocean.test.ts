import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDigitalOceanProvisioner } from "./digitalocean.js";

// ── Mocks ──────────────────────────────────────────────────────────

const mockExecute = vi.fn().mockResolvedValue(undefined);

vi.mock("../../db/index.js", () => ({
  getDb: () => ({ execute: mockExecute }),
  getConnectionString: () => "postgresql://admin:secret@db-host:25060/defaultdb?sslmode=require",
}));

vi.mock("../../lib/env.js", () => ({
  getEnv: () => ({ DB_PUBLIC_PORT: "25061" }),
}));

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
};

vi.mock("../../lib/logger.js", () => ({
  getLogger: () => mockLogger,
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Helpers ────────────────────────────────────────────────────────

const CONFIG = { apiToken: "do-token-123", clusterId: "cluster-abc" };
const USER_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const ROLE_NAME = "praxis_worker_a1b2c3d4_e5f6_7890_abcd_ef1234567890";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function emptyResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(""),
  } as unknown as Response;
}

// ── Tests ──────────────────────────────────────────────────────────

describe("DigitalOceanProvisioner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createUser", () => {
    it("creates a DO user and returns databaseUrl with correct credentials", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(201, { user: { name: ROLE_NAME, password: "gen-pass-1" } }),
      );

      const provisioner = createDigitalOceanProvisioner(CONFIG);
      const result = await provisioner.createUser(USER_ID);

      // Verify DO API call
      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.digitalocean.com/v2/databases/cluster-abc/users`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: ROLE_NAME }),
        }),
      );

      // Verify connection string has correct credentials and public port
      const url = new URL(result.databaseUrl);
      expect(url.username).toBe(ROLE_NAME);
      expect(url.password).toBe("gen-pass-1");
      expect(url.port).toBe("25061");

      // Verify SQL grants were executed
      expect(mockExecute).toHaveBeenCalled();
      const calls = mockExecute.mock.calls.map((c: unknown[]) => c[0]);
      expect(calls.some((sql: string) => sql.includes("ALTER ROLE"))).toBe(true);
      expect(calls.some((sql: string) => sql.includes("GRANT USAGE ON SCHEMA public"))).toBe(true);

      // Verify logger
      expect(mockLogger.info).toHaveBeenCalledWith(
        { roleName: ROLE_NAME, userId: USER_ID },
        "Provisioned DO database user",
      );
    });

    it("uses publicHost when provided", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(201, { user: { name: ROLE_NAME, password: "gen-pass-2" } }),
      );

      const provisioner = createDigitalOceanProvisioner(CONFIG);
      const result = await provisioner.createUser(USER_ID, "public.db.example.com");

      const url = new URL(result.databaseUrl);
      expect(url.hostname).toBe("public.db.example.com");
    });

    it("resets auth when user already exists (409)", async () => {
      // First call: 409 conflict
      mockFetch.mockResolvedValueOnce(
        jsonResponse(409, { id: "already_exists", message: "user exists" }),
      );
      // Second call: reset_auth succeeds
      mockFetch.mockResolvedValueOnce(
        jsonResponse(200, { user: { name: ROLE_NAME, password: "reset-pass-1" } }),
      );

      const provisioner = createDigitalOceanProvisioner(CONFIG);
      const result = await provisioner.createUser(USER_ID);

      // Verify reset_auth call
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1][0]).toBe(
        `https://api.digitalocean.com/v2/databases/cluster-abc/users/${ROLE_NAME}/reset_auth`,
      );
      expect(mockFetch.mock.calls[1][1]).toMatchObject({ method: "POST" });

      const url = new URL(result.databaseUrl);
      expect(url.password).toBe("reset-pass-1");
    });

    it("throws when API returns 500", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(500, { id: "server_error", message: "internal error" }),
      );

      const provisioner = createDigitalOceanProvisioner(CONFIG);
      await expect(provisioner.createUser(USER_ID)).rejects.toThrow(
        /Failed to create DO user.*500/,
      );
    });

    it("throws when 409 + reset_auth also fails", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(409, { message: "exists" }),
      );
      mockFetch.mockResolvedValueOnce(
        jsonResponse(500, { message: "reset failed" }),
      );

      const provisioner = createDigitalOceanProvisioner(CONFIG);
      await expect(provisioner.createUser(USER_ID)).rejects.toThrow(
        /Failed to reset auth.*500/,
      );
    });

    it("grants SQL permissions via db.execute", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(201, { user: { name: ROLE_NAME, password: "p" } }),
      );

      const provisioner = createDigitalOceanProvisioner(CONFIG);
      await provisioner.createUser(USER_ID);

      const calls = mockExecute.mock.calls.map((c: unknown[]) => c[0] as string);

      // public schema grants
      expect(calls).toEqual(
        expect.arrayContaining([
          expect.stringContaining("GRANT USAGE ON SCHEMA public"),
          expect.stringContaining("GRANT ALL ON ALL TABLES IN SCHEMA public"),
          expect.stringContaining("GRANT ALL ON ALL SEQUENCES IN SCHEMA public"),
          expect.stringContaining("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES"),
          expect.stringContaining("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES"),
        ]),
      );

      // pgboss grants
      expect(calls).toEqual(
        expect.arrayContaining([
          expect.stringContaining("GRANT USAGE, CREATE ON SCHEMA pgboss"),
          expect.stringContaining("GRANT ALL ON ALL TABLES IN SCHEMA pgboss"),
        ]),
      );
    });

    it("treats pgboss grant failure as non-fatal", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(201, { user: { name: ROLE_NAME, password: "p" } }),
      );

      // Make pgboss grants fail. The call order is:
      //   1: ALTER ROLE SET app.user_id (may succeed or fail)
      //   2-6: 5 public schema grants
      //   7+: pgboss grants
      let callCount = 0;
      mockExecute.mockImplementation(() => {
        callCount++;
        if (callCount === 7) {
          throw new Error("schema pgboss does not exist");
        }
        return Promise.resolve(undefined);
      });

      const provisioner = createDigitalOceanProvisioner(CONFIG);
      const result = await provisioner.createUser(USER_ID);

      // Should still succeed
      expect(result.databaseUrl).toBeTruthy();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ roleName: ROLE_NAME }),
        "Failed to grant pgboss schema access (non-fatal)",
      );
    });

    it("succeeds when ALTER ROLE SET app.user_id is denied (managed Postgres)", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(201, { user: { name: ROLE_NAME, password: "managed-pass" } }),
      );

      // First db.execute call is ALTER ROLE SET — reject it
      let callCount = 0;
      mockExecute.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error('permission denied to set parameter "app.user_id"');
        }
        return Promise.resolve(undefined);
      });

      const provisioner = createDigitalOceanProvisioner(CONFIG);
      const result = await provisioner.createUser(USER_ID);

      // Should still succeed — the worker's onconnect hook handles it
      expect(result.databaseUrl).toBeTruthy();
      const url = new URL(result.databaseUrl);
      expect(url.password).toBe("managed-pass");

      // Verify it logged the info message
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ roleName: ROLE_NAME }),
        "ALTER ROLE SET app.user_id not permitted (managed DB) — relying on client-side set_config",
      );
    });
  });

  describe("deleteUser", () => {
    it("succeeds on 204", async () => {
      mockFetch.mockResolvedValueOnce(emptyResponse(204));

      const provisioner = createDigitalOceanProvisioner(CONFIG);
      await expect(provisioner.deleteUser!(USER_ID)).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.digitalocean.com/v2/databases/cluster-abc/users/${ROLE_NAME}`,
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("succeeds on 404 (already gone)", async () => {
      mockFetch.mockResolvedValueOnce(emptyResponse(404));

      const provisioner = createDigitalOceanProvisioner(CONFIG);
      await expect(provisioner.deleteUser!(USER_ID)).resolves.toBeUndefined();
    });

    it("logs warning on API error but does not throw", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(500, { message: "server error" }),
      );

      const provisioner = createDigitalOceanProvisioner(CONFIG);
      await expect(provisioner.deleteUser!(USER_ID)).resolves.toBeUndefined();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ roleName: ROLE_NAME, status: 500 }),
        "Failed to delete DO database user (non-fatal)",
      );
    });
  });
});
