import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Mock node:fs/promises before any imports that use it
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockChmod = vi.fn().mockResolvedValue(undefined);
const mockReadFile = vi.fn();
const mockUnlink = vi.fn().mockResolvedValue(undefined);
const mockStat = vi.fn();

vi.mock("node:fs/promises", () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  chmod: (...args: unknown[]) => mockChmod(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
  stat: (...args: unknown[]) => mockStat(...args),
}));

// Mock node:os to return a fixed home directory
vi.mock("node:os", () => ({
  homedir: () => "/mock-home",
}));

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("parseFlags", () => {
  it("parses --key value pairs from argv", async () => {
    const { parseFlags } = await import("./praxis-login.js");
    const result = parseFlags([
      "--token", "abc123",
      "--name", "My Laptop",
      "--url", "https://api.example.com",
    ]);
    expect(result).toEqual({
      token: "abc123",
      name: "My Laptop",
      url: "https://api.example.com",
    });
  });

  it("returns empty object for no flags", async () => {
    const { parseFlags } = await import("./praxis-login.js");
    expect(parseFlags([])).toEqual({});
  });

  it("treats flags without values as boolean 'true'", async () => {
    const { parseFlags } = await import("./praxis-login.js");
    const result = parseFlags(["--db"]);
    expect(result).toEqual({ db: "true" });
  });
});

describe("getConfigPath", () => {
  it("returns path under ~/.praxis/", async () => {
    const { getConfigPath } = await import("./praxis-login.js");
    expect(getConfigPath()).toBe(join("/mock-home", ".praxis", "config.json"));
  });
});

describe("praxisLogin", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockMkdir.mockClear();
    mockWriteFile.mockClear();
    mockChmod.mockClear();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exits with error if required flags are missing", async () => {
    const { praxisLogin } = await import("./praxis-login.js");
    await expect(praxisLogin(["--token", "abc"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("creates config file on success", async () => {
    const { praxisLogin } = await import("./praxis-login.js");

    mockFetch.mockResolvedValue({
      status: 201,
      json: async () => ({
        workerId: "wk-123",
        workerName: "My Laptop",
        userId: "usr-456",
        databaseUrl: "postgresql://localhost/test",
      }),
    });

    await praxisLogin([
      "--token", "abc123",
      "--name", "My Laptop",
      "--url", "https://api.example.com",
    ]);

    // Should create directory
    expect(mockMkdir).toHaveBeenCalledWith(
      join("/mock-home", ".praxis"),
      { recursive: true },
    );

    // Should write config with databaseUrl
    const writtenContent = mockWriteFile.mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed).toEqual({
      workerId: "wk-123",
      workerName: "My Laptop",
      apiUrl: "https://api.example.com",
      userId: "usr-456",
      databaseUrl: "postgresql://localhost/test",
    });

    // Should set permissions to 0o600
    expect(mockChmod).toHaveBeenCalledWith(
      join("/mock-home", ".praxis", "config.json"),
      0o600,
    );

    // Should print success message
    expect(consoleSpy).toHaveBeenCalledWith(
      "Logged in as 'My Laptop' (worker: wk-123)",
    );
  });

  it("exits with error on non-201 response", async () => {
    const { praxisLogin } = await import("./praxis-login.js");

    mockFetch.mockResolvedValue({
      status: 401,
      json: async () => ({ error: "Invalid or expired token" }),
    });

    await expect(
      praxisLogin([
        "--token", "bad-token",
        "--name", "My Laptop",
        "--url", "https://api.example.com",
      ]),
    ).rejects.toThrow("process.exit");

    expect(consoleErrorSpy).toHaveBeenCalledWith("Error: Invalid or expired token");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with error on network failure", async () => {
    const { praxisLogin } = await import("./praxis-login.js");

    mockFetch.mockRejectedValue(new Error("Connection refused"));

    await expect(
      praxisLogin([
        "--token", "abc",
        "--name", "Test",
        "--url", "https://down.example.com",
      ]),
    ).rejects.toThrow("process.exit");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to connect"),
    );
  });
});

describe("praxisStatus", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockReadFile.mockReset();
    mockStat.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows 'Not logged in' when config does not exist", async () => {
    const { praxisStatus } = await import("./praxis-status.js");

    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    await praxisStatus([]);

    expect(consoleSpy).toHaveBeenCalledWith("Not logged in");
  });

  it("reads config and shows worker info", async () => {
    const { praxisStatus } = await import("./praxis-status.js");

    const config = {
      workerId: "wk-123",
      workerName: "My Laptop",
      apiUrl: "https://api.example.com",
      userId: "usr-456",
    };

    // First call: config.json, second call: worker.pid
    mockReadFile
      .mockResolvedValueOnce(JSON.stringify(config))
      .mockRejectedValueOnce(new Error("ENOENT")); // no PID file

    mockStat.mockResolvedValue({ mode: 0o100600 });

    await praxisStatus([]);

    expect(consoleSpy).toHaveBeenCalledWith("Worker ID:   wk-123");
    expect(consoleSpy).toHaveBeenCalledWith("Worker Name: My Laptop");
    expect(consoleSpy).toHaveBeenCalledWith("API URL:     https://api.example.com");
    expect(consoleSpy).toHaveBeenCalledWith("Status:      Stopped");
  });

  it("warns when config permissions are too open", async () => {
    const { praxisStatus } = await import("./praxis-status.js");

    const config = {
      workerId: "wk-123",
      workerName: "My Laptop",
      apiUrl: "https://api.example.com",
      userId: "usr-456",
    };

    mockReadFile
      .mockResolvedValueOnce(JSON.stringify(config))
      .mockRejectedValueOnce(new Error("ENOENT"));

    // 0o644 instead of 0o600
    mockStat.mockResolvedValue({ mode: 0o100644 });

    await praxisStatus([]);

    expect(consoleSpy).toHaveBeenCalledWith(
      "Warning: Config file permissions are too open",
    );
  });
});

describe("praxisStop", () => {
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
    mockReadFile.mockReset();
    mockUnlink.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints message when no PID file exists", async () => {
    const { praxisStop } = await import("./praxis-stop.js");

    // Config exists, PID file does not
    mockReadFile
      .mockResolvedValueOnce(JSON.stringify({ workerId: "wk-123" }))
      .mockRejectedValueOnce(new Error("ENOENT"));

    await praxisStop([]);

    expect(consoleSpy).toHaveBeenCalledWith("No worker process running");
  });

  it("prints message when PID file has invalid content", async () => {
    const { praxisStop } = await import("./praxis-stop.js");

    mockReadFile
      .mockResolvedValueOnce(JSON.stringify({ workerId: "wk-123" }))
      .mockResolvedValueOnce("not-a-number");

    await praxisStop([]);

    expect(consoleSpy).toHaveBeenCalledWith("No worker process running");
  });

  it("sends SIGTERM when process is running", async () => {
    const { praxisStop } = await import("./praxis-stop.js");

    mockReadFile
      .mockResolvedValueOnce(JSON.stringify({ workerId: "wk-123" }))
      .mockResolvedValueOnce("12345");

    // signal 0 check succeeds (process exists)
    killSpy.mockImplementation(() => true);

    await praxisStop([]);

    // First call: signal 0 check, second call: SIGTERM
    expect(killSpy).toHaveBeenCalledWith(12345, 0);
    expect(killSpy).toHaveBeenCalledWith(12345, "SIGTERM");
    expect(consoleSpy).toHaveBeenCalledWith("Stopping worker (PID 12345)...");
  });

  it("prints not running when process does not exist", async () => {
    const { praxisStop } = await import("./praxis-stop.js");

    mockReadFile
      .mockResolvedValueOnce(JSON.stringify({ workerId: "wk-123" }))
      .mockResolvedValueOnce("99999");

    // signal 0 check fails (process doesn't exist)
    killSpy.mockImplementation(() => {
      throw new Error("ESRCH");
    });

    await praxisStop([]);

    expect(consoleSpy).toHaveBeenCalledWith("No worker process running");
  });

  it("exits with error when not logged in", async () => {
    const { praxisStop } = await import("./praxis-stop.js");

    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    await expect(praxisStop([])).rejects.toThrow("process.exit");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Not logged in. Run `praxis login` first.",
    );
  });
});

// ── px-domain routing (subprocess tests) ──────────────────────────
describe("px-domain command routing", () => {
  const praxisPath = join(__dirname, "praxis.ts");

  async function runPraxis(
    args: string[],
    envOverrides: Record<string, string | undefined> = {},
  ) {
    const env = { ...process.env, ...envOverrides };
    // Remove DATABASE_URL unless explicitly provided
    if (!("DATABASE_URL" in envOverrides)) {
      delete env.DATABASE_URL;
    }
    try {
      const { stdout, stderr } = await execFileAsync(
        "npx",
        ["tsx", praxisPath, ...args],
        { env, timeout: 15_000 },
      );
      return { stdout, stderr, exitCode: 0 };
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
        exitCode: err.code ?? 1,
      };
    }
  }

  it("auth guard exits with 'Not logged in' when no config exists", async () => {
    const result = await runPraxis(["task", "start", "foo"], {
      DATABASE_URL: undefined,
      HOME: "/tmp/praxis-test-no-home",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Not logged in");
  }, 20_000);

  it("help text includes session commands", async () => {
    const result = await runPraxis(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Session commands");
    expect(result.stdout).toContain("praxis task");
  }, 20_000);

  it("unknown command exits with non-zero code", async () => {
    const result = await runPraxis(["bogus"]);
    expect(result.exitCode).not.toBe(0);
  }, 20_000);

  it("auth guard rejects when config has no databaseUrl", async () => {
    // Use real fs (not mocked) to create temp fixtures for the subprocess
    const realFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const { mkdtemp, mkdir: mkdirFs, writeFile: writeFileFs, rm: rmFs } = realFs;
    const realOs = await vi.importActual<typeof import("node:os")>("node:os");
    const { tmpdir } = realOs;
    const { join: joinPath } = await import("node:path");
    const tempHome = await mkdtemp(joinPath(tmpdir(), "praxis-test-nodb-"));
    const praxisDir = joinPath(tempHome, ".praxis");
    await mkdirFs(praxisDir, { recursive: true });
    await writeFileFs(
      joinPath(praxisDir, "config.json"),
      JSON.stringify({
        workerId: "w-1",
        workerName: "test",
        apiUrl: "https://api.example.com",
        userId: "u-1",
      }),
    );

    try {
      const result = await runPraxis(["epic", "complete", "fake-id"], {
        DATABASE_URL: undefined,
        HOME: tempHome,
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("logged in");
    } finally {
      await rmFs(tempHome, { recursive: true, force: true });
    }
  }, 20_000);
});
