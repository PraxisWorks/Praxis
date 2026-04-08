import { describe, it, expect, vi, beforeEach } from "vitest";
import type { readFile as ReadFileFn } from "node:fs/promises";
import type { existsSync as ExistsSyncFn } from "node:fs";
import { SYSTEM_INSTRUCTION_DEFAULTS } from "./prompt-defaults.js";

vi.mock("node:fs/promises");
vi.mock("node:fs");

describe("loadSkillDefaults", () => {
  let readFile: typeof ReadFileFn;
  let existsSync: typeof ExistsSyncFn;
  let loadSkillDefaults: () => Promise<Record<string, string>>;

  beforeEach(async () => {
    vi.resetModules();

    // Re-import mocked modules after reset
    const fsPromises = await import("node:fs/promises");
    const fs = await import("node:fs");
    readFile = fsPromises.readFile as unknown as typeof ReadFileFn;
    existsSync = fs.existsSync as unknown as typeof ExistsSyncFn;

    // Re-import the module under test (fresh cache each time)
    const mod = await import("./skill-loader.js");
    loadSkillDefaults = mod.loadSkillDefaults;
  });

  it("loads all 5 skill files from disk", async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    const fileContents: Record<string, string> = {
      "spec-workshop.md": "# Spec Workshop",
      "architect-workshop.md": "# Architect Workshop",
      "debug.md": "# Debug",
      "working.md": "# Working",
      "repo-chat.md": "# Repo Chat",
    };

    vi.mocked(readFile).mockImplementation(async (path) => {
      const filename = String(path).split("/").pop()!;
      if (filename in fileContents) return fileContents[filename];
      throw new Error(`ENOENT: ${path}`);
    });

    const result = await loadSkillDefaults();

    expect(Object.keys(result)).toHaveLength(5);
    expect(result.spec).toBe("# Spec Workshop");
    expect(result.architecture).toBe("# Architect Workshop");
    expect(result.debug).toBe("# Debug");
    expect(result.working).toBe("# Working");
    expect(result.repo).toBe("# Repo Chat");
  });

  it("falls back to SYSTEM_INSTRUCTION_DEFAULTS for missing files", async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    vi.mocked(readFile).mockImplementation(async (path) => {
      const filename = String(path).split("/").pop()!;
      if (filename === "debug.md") throw new Error("ENOENT");
      return `content-of-${filename}`;
    });

    const result = await loadSkillDefaults();

    expect(result.spec).toBe("content-of-spec-workshop.md");
    expect(result.architecture).toBe("content-of-architect-workshop.md");
    expect(result.debug).toBe(SYSTEM_INSTRUCTION_DEFAULTS.debug);
    expect(result.working).toBe("content-of-working.md");
    expect(result.repo).toBe("content-of-repo-chat.md");
  });

  it("falls back entirely when skills dir is missing", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));

    const result = await loadSkillDefaults();

    expect(Object.keys(result)).toHaveLength(5);
    for (const key of ["spec", "architecture", "debug", "working", "repo"]) {
      expect(result[key]).toBe(SYSTEM_INSTRUCTION_DEFAULTS[key]);
    }
  });

  it("returns cached result on second call without re-reading", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFile).mockResolvedValue("cached-content");

    const first = await loadSkillDefaults();

    // Clear call counts after first load, then call again
    vi.mocked(readFile).mockClear();
    const second = await loadSkillDefaults();

    expect(first).toBe(second);
    // readFile should not be called again due to caching
    expect(readFile).toHaveBeenCalledTimes(0);
  });
});
