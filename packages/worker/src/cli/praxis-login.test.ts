import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  chmod: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/mock-home"),
}));

import { praxisLogin } from "./praxis-login";

describe("praxisLogin error handling", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
  });

  it("shows error on 403 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 403,
        json: async () => ({ error: "Forbidden" }),
      }),
    );

    await expect(
      praxisLogin(["--token", "t", "--name", "n", "--url", "http://test"]),
    ).rejects.toThrow("exit");

    expect(consoleErrorSpy).toHaveBeenCalledWith("Error: Forbidden");
  });

  it("shows error on 500 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 500,
        json: async () => ({ error: "Internal server error" }),
      }),
    );

    await expect(
      praxisLogin(["--token", "t", "--name", "n", "--url", "http://test"]),
    ).rejects.toThrow("exit");

    expect(consoleErrorSpy).toHaveBeenCalledWith("Error: Internal server error");
  });

  it("does not error on successful login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 201,
        json: async () => ({
          workerId: "w1",
          workerName: "n",
          userId: "u1",
          databaseUrl: "postgres://localhost/test",
        }),
      }),
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await praxisLogin(["--token", "t", "--name", "n", "--url", "http://test"]);

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
