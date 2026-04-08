import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
const mockLogger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
vi.mock("../../lib/logger.js", () => ({
  getLogger: vi.fn(() => mockLogger),
}));

// Mock Octokit
const mockCreateWebhook = vi.fn();
const mockDeleteWebhook = vi.fn();
const mockListDeployments = vi.fn();
const mockListDeploymentStatuses = vi.fn();

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(() => ({
    repos: {
      createWebhook: mockCreateWebhook,
      deleteWebhook: mockDeleteWebhook,
      listDeployments: mockListDeployments,
      listDeploymentStatuses: mockListDeploymentStatuses,
    },
  })),
}));

import { createGitHubAdapter } from "./github.js";

describe("createGitHubAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("registerWebhook", () => {
    it("returns success with hookId on success", async () => {
      mockCreateWebhook.mockResolvedValue({ data: { id: 42 } });
      const adapter = createGitHubAdapter({ token: "test-token" });
      const result = await adapter.registerWebhook({
        owner: "acme",
        repo: "api",
        url: "https://example.com/hook",
        secret: "s3cr3t",
        events: ["deployment_status"],
      });
      expect(result).toEqual({ success: true, hookId: 42 });
      expect(mockCreateWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: "acme",
          repo: "api",
        }),
      );
    });

    it("returns error on failure", async () => {
      mockCreateWebhook.mockRejectedValue(new Error("Not Found"));
      const adapter = createGitHubAdapter({ token: "test-token" });
      const result = await adapter.registerWebhook({
        owner: "acme",
        repo: "api",
        url: "https://example.com/hook",
        secret: "s3cr3t",
        events: ["deployment_status"],
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe("Not Found");
    });
  });

  describe("deleteWebhook", () => {
    it("returns success on delete", async () => {
      mockDeleteWebhook.mockResolvedValue({});
      const adapter = createGitHubAdapter({ token: "test-token" });
      const result = await adapter.deleteWebhook({
        owner: "acme",
        repo: "api",
        hookId: 42,
      });
      expect(result).toEqual({ success: true });
    });

    it("returns error on failure", async () => {
      mockDeleteWebhook.mockRejectedValue(new Error("Forbidden"));
      const adapter = createGitHubAdapter({ token: "test-token" });
      const result = await adapter.deleteWebhook({
        owner: "acme",
        repo: "api",
        hookId: 42,
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe("Forbidden");
    });
  });

  describe("listDeploymentStatuses", () => {
    it("returns statuses for each deployment", async () => {
      mockListDeployments.mockResolvedValue({
        data: [
          {
            id: 1,
            environment: "production",
            created_at: "2024-01-01T00:00:00Z",
          },
        ],
      });
      mockListDeploymentStatuses.mockResolvedValue({
        data: [
          {
            id: 10,
            state: "success",
            description: "Deployed",
            created_at: "2024-01-01T00:01:00Z",
          },
        ],
      });
      const adapter = createGitHubAdapter({ token: "test-token" });
      const result = await adapter.listDeploymentStatuses({
        owner: "acme",
        repo: "api",
      });
      expect(result.success).toBe(true);
      expect(result.statuses).toHaveLength(1);
      expect(result.statuses![0].state).toBe("success");
      expect(result.statuses![0].environment).toBe("production");
    });

    it("returns error on API failure", async () => {
      mockListDeployments.mockRejectedValue(new Error("Rate limited"));
      const adapter = createGitHubAdapter({ token: "test-token" });
      const result = await adapter.listDeploymentStatuses({
        owner: "acme",
        repo: "api",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("verifyWebhookSignature", () => {
    it("returns valid for correct signature", async () => {
      const adapter = createGitHubAdapter({ token: "test-token" });
      const crypto = await import("node:crypto");
      const secret = "test-secret";
      const payload = '{"test": true}';
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

    it("returns invalid for wrong signature", async () => {
      const adapter = createGitHubAdapter({ token: "test-token" });
      const result = await adapter.verifyWebhookSignature({
        payload: '{"test": true}',
        signature: "sha256=wrong",
        secret: "test-secret",
      });
      expect(result.valid).toBe(false);
    });
  });
});
