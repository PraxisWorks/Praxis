import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getAuth0MgmtAdapter,
  setAuth0MgmtAdapter,
  resetAuth0MgmtAdapter,
} from "./index.js";
import type { Auth0MgmtAdapter } from "./types.js";

vi.mock("../../lib/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockEnv: Record<string, string | undefined> = {};

vi.mock("../../lib/env.js", () => ({
  getEnv: () => mockEnv,
}));

vi.mock("./auth0.js", () => ({
  createAuth0MgmtAdapter: vi.fn(() => ({ _type: "auth0" })),
}));

vi.mock("./console.js", () => ({
  createConsoleAuth0MgmtAdapter: vi.fn(() => ({ _type: "console" })),
}));

describe("Auth0 Management adapter factory", () => {
  beforeEach(() => {
    resetAuth0MgmtAdapter();
    Object.keys(mockEnv).forEach((k) => delete mockEnv[k]);
  });

  it("returns console adapter when AUTH0_MGMT_DOMAIN is not set", () => {
    const adapter = getAuth0MgmtAdapter();
    expect((adapter as unknown as { _type: string })._type).toBe("console");
  });

  it("returns auth0 adapter when AUTH0_MGMT_DOMAIN is set", () => {
    mockEnv.AUTH0_MGMT_DOMAIN = "test.auth0.com";
    mockEnv.AUTH0_MGMT_CLIENT_ID = "client-id";
    mockEnv.AUTH0_MGMT_CLIENT_SECRET = "client-secret";

    const adapter = getAuth0MgmtAdapter();
    expect((adapter as unknown as { _type: string })._type).toBe("auth0");
  });

  it("throws when domain is set but client credentials are missing", () => {
    mockEnv.AUTH0_MGMT_DOMAIN = "test.auth0.com";

    expect(() => getAuth0MgmtAdapter()).toThrow(
      "AUTH0_MGMT_DOMAIN is set but AUTH0_MGMT_CLIENT_ID and AUTH0_MGMT_CLIENT_SECRET are also required",
    );
  });

  it("returns cached instance on second call", () => {
    const adapter1 = getAuth0MgmtAdapter();
    const adapter2 = getAuth0MgmtAdapter();
    expect(adapter1).toBe(adapter2);
  });

  it("setAuth0MgmtAdapter overrides the instance", () => {
    const custom = { _type: "custom" } as unknown as Auth0MgmtAdapter;
    setAuth0MgmtAdapter(custom);
    expect(getAuth0MgmtAdapter()).toBe(custom);
  });

  it("resetAuth0MgmtAdapter clears the instance", () => {
    getAuth0MgmtAdapter(); // cache it
    resetAuth0MgmtAdapter();
    // Next call creates a new instance
    const adapter = getAuth0MgmtAdapter();
    expect((adapter as unknown as { _type: string })._type).toBe("console");
  });
});
