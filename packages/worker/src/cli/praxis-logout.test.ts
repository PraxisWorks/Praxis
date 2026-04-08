import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockReadConfig = vi.fn();
const mockSecureDeleteConfig = vi.fn();
const mockReadPidFile = vi.fn();
const mockDeletePidFile = vi.fn();

vi.mock("./praxis-config.js", () => ({
  readConfig: (...args: unknown[]) => mockReadConfig(...args),
  secureDeleteConfig: (...args: unknown[]) => mockSecureDeleteConfig(...args),
  readPidFile: (...args: unknown[]) => mockReadPidFile(...args),
  deletePidFile: (...args: unknown[]) => mockDeletePidFile(...args),
}));

import { runLogout } from "./praxis-logout.js";

describe("runLogout", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    mockReadConfig.mockReset();
    mockSecureDeleteConfig.mockReset();
    mockReadPidFile.mockReset();
    mockDeletePidFile.mockReset();
    mockSecureDeleteConfig.mockResolvedValue(undefined);
    mockDeletePidFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints 'Not logged in.' when no config exists", async () => {
    mockReadConfig.mockResolvedValue(null);

    await runLogout();

    expect(consoleSpy).toHaveBeenCalledWith("Not logged in.");
    expect(mockSecureDeleteConfig).not.toHaveBeenCalled();
  });

  it("securely deletes config when logged in with no running worker", async () => {
    mockReadConfig.mockResolvedValue({
      workerId: "w-1",
      workerName: "my-worker",
      apiUrl: "https://api.example.com",
      userId: "u-1",
    });
    mockReadPidFile.mockResolvedValue(null);

    await runLogout();

    expect(mockSecureDeleteConfig).toHaveBeenCalledOnce();
    expect(consoleSpy).toHaveBeenCalledWith(
      "Logged out worker 'my-worker' (w-1).",
    );
    expect(consoleSpy).toHaveBeenCalledWith("Config file securely deleted.");
  });

  it("sends SIGTERM when worker is running", async () => {
    mockReadConfig.mockResolvedValue({
      workerId: "w-2",
      workerName: "running-worker",
      apiUrl: "https://api.example.com",
      userId: "u-2",
    });
    mockReadPidFile.mockResolvedValue(9999);

    // First call (signal 0) succeeds — process exists
    // Second call (SIGTERM) succeeds
    killSpy.mockImplementation(() => true);

    // Override setTimeout to resolve immediately
    vi.useFakeTimers();

    const promise = runLogout();
    await vi.advanceTimersByTimeAsync(2000);
    await promise;

    vi.useRealTimers();

    expect(killSpy).toHaveBeenCalledWith(9999, 0);
    expect(killSpy).toHaveBeenCalledWith(9999, "SIGTERM");
    expect(mockDeletePidFile).toHaveBeenCalledOnce();
    expect(mockSecureDeleteConfig).toHaveBeenCalledOnce();
  });

  it("handles case where process no longer exists", async () => {
    mockReadConfig.mockResolvedValue({
      workerId: "w-3",
      workerName: "dead-worker",
      apiUrl: "https://api.example.com",
      userId: "u-3",
    });
    mockReadPidFile.mockResolvedValue(8888);

    // Signal 0 throws — process doesn't exist
    killSpy.mockImplementation(() => {
      throw new Error("ESRCH");
    });

    await runLogout();

    // Should still clean up PID file and config
    expect(mockDeletePidFile).toHaveBeenCalledOnce();
    expect(mockSecureDeleteConfig).toHaveBeenCalledOnce();
    expect(consoleSpy).toHaveBeenCalledWith(
      "Logged out worker 'dead-worker' (w-3).",
    );
  });
});
