import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock("../../lib/logger.js", () => ({
  getLogger: vi.fn(() => mockLogger),
}));

let mockEnv: Record<string, string | undefined> = {};
vi.mock("../../lib/env.js", () => ({
  getEnv: vi.fn(() => mockEnv),
}));

vi.mock("./github.js", () => ({
  createGitHubAdapter: vi.fn(() => ({ type: "github" })),
}));

import {
  getGitHubAdapter,
  resetGitHubAdapter,
  setGitHubAdapter,
} from "./index.js";

describe("getGitHubAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetGitHubAdapter();
    mockEnv = {};
  });

  afterEach(() => {
    resetGitHubAdapter();
  });

  it("returns null when no GITHUB_TOKEN", () => {
    const adapter = getGitHubAdapter();
    expect(adapter).toBeNull();
  });

  it("returns github adapter when GITHUB_TOKEN is set", () => {
    mockEnv = { GITHUB_TOKEN: "ghp_test123" };
    const adapter = getGitHubAdapter();
    expect((adapter as any).type).toBe("github");
  });

  it("returns cached instance on subsequent calls", () => {
    const first = getGitHubAdapter();
    const second = getGitHubAdapter();
    expect(first).toBe(second);
  });

  it("setGitHubAdapter overrides the instance", () => {
    const mock = { type: "mock" } as any;
    setGitHubAdapter(mock);
    expect(getGitHubAdapter()).toBe(mock);
  });
});
