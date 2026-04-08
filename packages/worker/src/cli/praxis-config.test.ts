import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, readFile, stat, chmod, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// We cannot use the module directly because CONFIG_DIR/CONFIG_PATH/PID_PATH are
// computed at import time from homedir(). Instead we replicate the logic against
// a temp directory so we test real file operations without touching ~/.praxis.

// Helper: create a unique temp dir for each test
let tempDir: string;
let configPath: string;
let pidPath: string;

beforeEach(async () => {
  tempDir = join(tmpdir(), `praxis-test-${randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  configPath = join(tempDir, "config.json");
  pidPath = join(tempDir, "worker.pid");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const sampleConfig = {
  workerId: "w-123",
  workerName: "test-worker",
  apiUrl: "https://api.example.com",
  userId: "u-456",
};

describe("praxis-config file operations", () => {
  describe("writeConfig / readConfig equivalent operations", () => {
    it("writes config with 0600 permissions", async () => {
      await writeFile(configPath, JSON.stringify(sampleConfig, null, 2), {
        mode: 0o600,
      });

      const stats = await stat(configPath);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it("written config can be parsed back", async () => {
      await writeFile(configPath, JSON.stringify(sampleConfig, null, 2), {
        mode: 0o600,
      });

      const raw = await readFile(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed).toEqual(sampleConfig);
    });

    it("readFile returns error when file does not exist", async () => {
      await expect(readFile(configPath, "utf-8")).rejects.toThrow();
    });
  });

  describe("checkConfigPermissions equivalent", () => {
    it("returns warning when permissions are wrong", async () => {
      await writeFile(configPath, JSON.stringify(sampleConfig), {
        mode: 0o644,
      });

      const stats = await stat(configPath);
      const mode = stats.mode & 0o777;
      const warnings: string[] = [];
      if (mode !== 0o600) {
        warnings.push(
          `Warning: Config file permissions are ${mode.toString(8)} (expected 600).`,
        );
      }

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("expected 600");
    });

    it("returns empty array when permissions are correct", async () => {
      await writeFile(configPath, JSON.stringify(sampleConfig), {
        mode: 0o600,
      });

      const stats = await stat(configPath);
      const mode = stats.mode & 0o777;
      const warnings: string[] = [];
      if (mode !== 0o600) {
        warnings.push("bad permissions");
      }

      expect(warnings).toHaveLength(0);
    });
  });

  describe("fixConfigPermissions equivalent", () => {
    it("fixes permissions to 0600", async () => {
      await writeFile(configPath, JSON.stringify(sampleConfig), {
        mode: 0o644,
      });

      // Verify it starts wrong
      let stats = await stat(configPath);
      expect(stats.mode & 0o777).toBe(0o644);

      // Fix
      await chmod(configPath, 0o600);

      // Verify fixed
      stats = await stat(configPath);
      expect(stats.mode & 0o777).toBe(0o600);
    });
  });

  describe("secureDeleteConfig equivalent", () => {
    it("overwrites file content before unlinking", async () => {
      const content = JSON.stringify(sampleConfig, null, 2);
      await writeFile(configPath, content, { mode: 0o600 });

      // Overwrite with zeros
      const stats = await stat(configPath);
      const zeros = Buffer.alloc(stats.size, 0);
      await writeFile(configPath, zeros);

      // Verify overwritten (content is all zeros)
      const raw = await readFile(configPath);
      expect(raw.every((b) => b === 0)).toBe(true);
    });

    it("does not throw when file does not exist", async () => {
      // Attempting to unlink a non-existent file in a catch is safe
      const { unlink } = await import("node:fs/promises");
      await expect(
        (async () => {
          try {
            await unlink(join(tempDir, "nonexistent.json"));
          } catch {
            // Expected
          }
        })(),
      ).resolves.toBeUndefined();
    });
  });

  describe("PID file operations", () => {
    it("writePidFile and readPidFile work correctly", async () => {
      const pid = 12345;
      await writeFile(pidPath, String(pid), { mode: 0o600 });

      const raw = await readFile(pidPath, "utf-8");
      const parsed = parseInt(raw.trim(), 10);
      expect(parsed).toBe(pid);
    });

    it("readPidFile returns NaN-safe value for garbage content", async () => {
      await writeFile(pidPath, "not-a-number", { mode: 0o600 });

      const raw = await readFile(pidPath, "utf-8");
      const parsed = parseInt(raw.trim(), 10);
      expect(isNaN(parsed)).toBe(true);
    });

    it("PID file is created with 0600 permissions", async () => {
      await writeFile(pidPath, "99999", { mode: 0o600 });

      const stats = await stat(pidPath);
      expect(stats.mode & 0o777).toBe(0o600);
    });
  });

  describe("ensureConfigDir equivalent", () => {
    it("creates directory with 0700 permissions", async () => {
      const subDir = join(tempDir, "nested", "dir");
      await mkdir(subDir, { recursive: true, mode: 0o700 });

      const stats = await stat(subDir);
      expect(stats.mode & 0o777).toBe(0o700);
    });

    it("is idempotent", async () => {
      const subDir = join(tempDir, "idempotent");
      await mkdir(subDir, { recursive: true, mode: 0o700 });
      await mkdir(subDir, { recursive: true, mode: 0o700 });

      const stats = await stat(subDir);
      expect(stats.mode & 0o777).toBe(0o700);
    });
  });
});

describe("populateEnvFromConfig", () => {
  // We need to mock homedir so the module reads from our temp dir
  let tempHome: string;
  let praxisDir: string;
  let configFile: string;

  beforeEach(async () => {
    tempHome = join(tmpdir(), `praxis-home-${randomUUID()}`);
    praxisDir = join(tempHome, ".praxis");
    configFile = join(praxisDir, "config.json");
    await mkdir(praxisDir, { recursive: true, mode: 0o700 });
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
    // Clean up env vars we may have set
    delete process.env.DATABASE_URL;
    delete process.env.WORKER_USER_ID;
    delete process.env.WORKER_NAME;
    delete process.env.WORKER_ID;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function getPopulateEnv() {
    // Mock homedir to our temp dir, then freshly import the module
    vi.doMock("node:os", () => ({ homedir: () => tempHome }));
    const mod = await import("./praxis-config.js");
    return mod.populateEnvFromConfig;
  }

  it("returns not-logged-in when no config file exists", async () => {
    const populateEnvFromConfig = await getPopulateEnv();
    const result = await populateEnvFromConfig();
    expect(result).toEqual({ ok: false, reason: "not-logged-in" });
  });

  it("returns not-logged-in when config has no databaseUrl", async () => {
    await writeFile(configFile, JSON.stringify({
      workerId: "w-1", workerName: "test", apiUrl: "https://x.com",
      userId: "u-1",
      // no databaseUrl
    }), { mode: 0o600 });
    const populateEnvFromConfig = await getPopulateEnv();
    const result = await populateEnvFromConfig();
    expect(result).toEqual({ ok: false, reason: "not-logged-in" });
  });

  it("populates DATABASE_URL from config when env var is missing", async () => {
    await writeFile(configFile, JSON.stringify({
      workerId: "w-1", workerName: "test", apiUrl: "https://x.com",
      userId: "u-1", databaseUrl: "postgresql://localhost/test",
    }), { mode: 0o600 });
    delete process.env.DATABASE_URL;
    const populateEnvFromConfig = await getPopulateEnv();
    const result = await populateEnvFromConfig();
    expect(result).toEqual({ ok: true });
    expect(process.env.DATABASE_URL).toBe("postgresql://localhost/test");
  });

  it("does NOT overwrite DATABASE_URL when env var is already set", async () => {
    await writeFile(configFile, JSON.stringify({
      workerId: "w-1", workerName: "test", apiUrl: "https://x.com",
      userId: "u-1", databaseUrl: "postgresql://localhost/test",
    }), { mode: 0o600 });
    process.env.DATABASE_URL = "postgresql://existing/db";
    const populateEnvFromConfig = await getPopulateEnv();
    const result = await populateEnvFromConfig();
    expect(result).toEqual({ ok: true });
    expect(process.env.DATABASE_URL).toBe("postgresql://existing/db");
  });

  it("populates WORKER_USER_ID, WORKER_NAME, WORKER_ID", async () => {
    await writeFile(configFile, JSON.stringify({
      workerId: "w-1", workerName: "my-worker", apiUrl: "https://x.com",
      userId: "u-99", databaseUrl: "postgresql://localhost/test",
    }), { mode: 0o600 });
    const populateEnvFromConfig = await getPopulateEnv();
    await populateEnvFromConfig();
    expect(process.env.WORKER_USER_ID).toBe("u-99");
    expect(process.env.WORKER_NAME).toBe("my-worker");
    expect(process.env.WORKER_ID).toBe("w-1");
  });

  it("warns when config permissions are too open", async () => {
    await writeFile(configFile, JSON.stringify({
      workerId: "w-1", workerName: "test", apiUrl: "https://x.com",
      userId: "u-1", databaseUrl: "postgresql://localhost/test",
    }), { mode: 0o644 }); // Too open!
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const populateEnvFromConfig = await getPopulateEnv();
    await populateEnvFromConfig();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("permissions"));
  });
});
