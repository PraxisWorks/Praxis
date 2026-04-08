import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock declarations BEFORE imports
vi.mock("node:os", () => ({
  homedir: () => "/mock-home",
  tmpdir: () => "/mock-tmp",
}));

const mockExecSync = vi.fn();
const mockSpawn = vi.fn();
vi.mock("node:child_process", () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

const mockReadPidFile = vi.fn();
const mockDeletePidFile = vi.fn();
vi.mock("./praxis-config.js", () => ({
  readPidFile: (...args: unknown[]) => mockReadPidFile(...args),
  deletePidFile: (...args: unknown[]) => mockDeletePidFile(...args),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { praxisUpdate, fetchLatestVersion } from "./praxis-update.js";

// ── helpers ──────────────────────────────────────────────────────────

function mockRegistryResponse(version: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ "dist-tags": { latest: version } }),
  };
}

/**
 * Set up mocks so that fetchLatestVersion succeeds with the given version.
 */
function setupFetchReturns(version: string) {
  mockFetch.mockResolvedValue(mockRegistryResponse(version));
}

// ── tests ────────────────────────────────────────────────────────────

describe("fetchLatestVersion", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns error on network failure", async () => {
    mockFetch.mockRejectedValue(new Error("Connection refused"));

    const result = await fetchLatestVersion();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Network error");
      expect(result.error).toContain("Connection refused");
    }
  });

  it("returns error on non-ok HTTP response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const result = await fetchLatestVersion();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("HTTP 500");
    }
  });

  it("rejects invalid version string from registry", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ "dist-tags": { latest: "$(evil-command)" } }),
    });

    const result = await fetchLatestVersion();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("invalid version string");
    }
  });

  it("returns version on success", async () => {
    mockFetch.mockResolvedValue(mockRegistryResponse("2.0.0"));

    const result = await fetchLatestVersion();

    expect(result).toEqual({ success: true, version: "2.0.0" });
  });
});

describe("praxisUpdate", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    mockFetch.mockReset();
    mockExecSync.mockReset();
    mockSpawn.mockReset();
    mockReadPidFile.mockReset();
    mockDeletePidFile.mockReset();
    mockDeletePidFile.mockResolvedValue(undefined);
    mockSpawn.mockReturnValue({ unref: vi.fn() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("--check flag prints versions without triggering install", async () => {
    setupFetchReturns("2.0.0");

    await praxisUpdate(["--check"]);

    expect(consoleSpy).toHaveBeenCalledWith("Current version: dev");
    expect(consoleSpy).toHaveBeenCalledWith("Latest version:  2.0.0");
    expect(consoleSpy).toHaveBeenCalledWith("Update available: dev -> 2.0.0");
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it("prints 'Already up to date' when versions match", async () => {
    vi.stubGlobal("__PRAXIS_VERSION__", "1.0.0");

    // Re-import the module so it picks up the new global
    vi.resetModules();
    const freshModule = await import("./praxis-update.js");

    mockFetch.mockResolvedValue(mockRegistryResponse("1.0.0"));

    await freshModule.praxisUpdate([]);

    expect(consoleSpy).toHaveBeenCalledWith("Already up to date.");
    expect(mockExecSync).not.toHaveBeenCalled();

    // Clean up
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("calls execSync with correct npm install command when update available", async () => {
    setupFetchReturns("2.0.0");
    mockReadPidFile.mockResolvedValue(null);

    await praxisUpdate([]);

    expect(mockExecSync).toHaveBeenCalledWith(
      "npm install -g @praxwork/cli@2.0.0",
      { stdio: "inherit" },
    );
    expect(consoleSpy).toHaveBeenCalledWith("Updated to v2.0.0.");
  });

  it("stops running worker before update and restarts after", async () => {
    setupFetchReturns("2.0.0");
    mockReadPidFile.mockResolvedValue(9999);
    // signal 0 check succeeds, SIGTERM succeeds
    killSpy.mockImplementation(() => true);

    await praxisUpdate([]);

    expect(killSpy).toHaveBeenCalledWith(9999, 0);
    expect(killSpy).toHaveBeenCalledWith(9999, "SIGTERM");
    expect(mockDeletePidFile).toHaveBeenCalled();
    expect(mockExecSync).toHaveBeenCalledWith(
      "npm install -g @praxwork/cli@2.0.0",
      { stdio: "inherit" },
    );
    expect(mockSpawn).toHaveBeenCalledWith("praxis", ["start"], {
      detached: true,
      stdio: "ignore",
    });
    expect(consoleSpy).toHaveBeenCalledWith("Worker restart initiated.");
  });

  it("updates without stop/restart when worker is not running", async () => {
    setupFetchReturns("2.0.0");
    mockReadPidFile.mockResolvedValue(null);

    await praxisUpdate([]);

    expect(killSpy).not.toHaveBeenCalled();
    expect(mockExecSync).toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("produces clear error on network failure", async () => {
    mockFetch.mockRejectedValue(new Error("Connection refused"));

    await expect(praxisUpdate([])).rejects.toThrow("process.exit");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Network error"),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("rejects invalid version string from registry", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ "dist-tags": { latest: "; rm -rf /" } }),
    });

    await expect(praxisUpdate([])).rejects.toThrow("process.exit");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("invalid version string"),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("produces clear error on npm install failure and does not restart", async () => {
    setupFetchReturns("2.0.0");
    mockReadPidFile.mockResolvedValue(null);
    mockExecSync.mockImplementation(() => {
      throw new Error("npm ERR! 404 Not Found");
    });

    await expect(praxisUpdate([])).rejects.toThrow("process.exit");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("npm install failed"),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "The previous version may still be installed. Try running the update again.",
    );
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
