import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
};

vi.mock("../../lib/logger.js", () => ({
  getLogger: vi.fn(() => mockLogger),
}));

import { createConsolePodProvisionerAdapter } from "./console.js";
import {
  getPodProvisionerAdapter,
  resetPodProvisionerAdapter,
} from "./index.js";

describe("createConsolePodProvisionerAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createPod returns podName and status", async () => {
    const adapter = createConsolePodProvisionerAdapter();
    const result = await adapter.createPod({
      name: "test-pod",
      namespace: "default",
      template: "worker-v1",
      secrets: { API_KEY: "sk-123" },
    });

    expect(result).toEqual({ podName: "test-pod", status: "Running" });
    expect(mockLogger.info).toHaveBeenCalledWith(
      { name: "test-pod", namespace: "default", template: "worker-v1" },
      expect.stringContaining("console adapter"),
    );
  });

  it("deletePod returns success", async () => {
    const adapter = createConsolePodProvisionerAdapter();
    const result = await adapter.deletePod({
      name: "test-pod",
      namespace: "default",
    });

    expect(result).toEqual({ success: true });
    expect(mockLogger.info).toHaveBeenCalledWith(
      { name: "test-pod", namespace: "default" },
      expect.stringContaining("console adapter"),
    );
  });

  it("getPodStatus returns status and ready", async () => {
    const adapter = createConsolePodProvisionerAdapter();
    const result = await adapter.getPodStatus({
      name: "test-pod",
      namespace: "default",
    });

    expect(result).toEqual({ status: "Running", ready: true });
    expect(mockLogger.info).toHaveBeenCalledWith(
      { name: "test-pod", namespace: "default" },
      expect.stringContaining("console adapter"),
    );
  });
});

describe("getPodProvisionerAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPodProvisionerAdapter();
  });

  afterEach(() => {
    resetPodProvisionerAdapter();
  });

  it("defaults to console adapter when POD_PROVISIONER_PROVIDER is not set", () => {
    delete process.env.POD_PROVISIONER_PROVIDER;

    const adapter = getPodProvisionerAdapter();
    expect(adapter).toBeDefined();
    expect(adapter.createPod).toBeTypeOf("function");
    expect(adapter.deletePod).toBeTypeOf("function");
    expect(adapter.getPodStatus).toBeTypeOf("function");
  });

  it("returns same instance on subsequent calls (singleton)", () => {
    delete process.env.POD_PROVISIONER_PROVIDER;

    const first = getPodProvisionerAdapter();
    const second = getPodProvisionerAdapter();
    expect(first).toBe(second);
  });

  it("returns fresh instance after reset", () => {
    delete process.env.POD_PROVISIONER_PROVIDER;

    const first = getPodProvisionerAdapter();
    resetPodProvisionerAdapter();
    const second = getPodProvisionerAdapter();
    expect(first).not.toBe(second);
  });
});
