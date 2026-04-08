import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLogger = { info: vi.fn() };
vi.mock("../../lib/logger.js", () => ({
  getLogger: vi.fn(() => mockLogger),
}));

import { createConsoleGitHubAdapter } from "./console.js";

describe("createConsoleGitHubAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registerWebhook returns success with hookId", async () => {
    const adapter = createConsoleGitHubAdapter();
    const result = await adapter.registerWebhook({
      owner: "acme",
      repo: "api",
      url: "https://example.com/hook",
      secret: "s3cr3t",
      events: ["deployment_status"],
    });
    expect(result.success).toBe(true);
    expect(result.hookId).toBeDefined();
    expect(mockLogger.info).toHaveBeenCalled();
  });

  it("deleteWebhook returns success", async () => {
    const adapter = createConsoleGitHubAdapter();
    const result = await adapter.deleteWebhook({
      owner: "acme",
      repo: "api",
      hookId: 42,
    });
    expect(result).toEqual({ success: true });
  });

  it("listDeploymentStatuses returns empty array", async () => {
    const adapter = createConsoleGitHubAdapter();
    const result = await adapter.listDeploymentStatuses({
      owner: "acme",
      repo: "api",
    });
    expect(result).toEqual({ success: true, statuses: [] });
  });

  it("verifyWebhookSignature works with correct signature", async () => {
    const adapter = createConsoleGitHubAdapter();
    const crypto = await import("node:crypto");
    const secret = "test-secret";
    const payload = "test-payload";
    const sig =
      "sha256=" +
      crypto.createHmac("sha256", secret).update(payload).digest("hex");
    const result = await adapter.verifyWebhookSignature({
      payload,
      signature: sig,
      secret,
    });
    expect(result.valid).toBe(true);
  });

  it("verifyWebhookSignature rejects wrong signature", async () => {
    const adapter = createConsoleGitHubAdapter();
    const result = await adapter.verifyWebhookSignature({
      payload: "test-payload",
      signature: "sha256=wrong",
      secret: "test-secret",
    });
    expect(result.valid).toBe(false);
  });
});
