import { describe, it, expect } from "vitest";
import { RegisterDeploymentSchema, DeploymentSchema, ServiceSchema } from "./deployment.js";

describe("ServiceSchema", () => {
  it("accepts valid services", () => {
    expect(ServiceSchema.safeParse("api").success).toBe(true);
    expect(ServiceSchema.safeParse("worker").success).toBe(true);
    expect(ServiceSchema.safeParse("web").success).toBe(true);
    expect(ServiceSchema.safeParse("mobile").success).toBe(true);
  });

  it("accepts mobile service in RegisterDeploymentSchema", () => {
    const result = RegisterDeploymentSchema.safeParse({
      service: "mobile",
      gitSha: "abc1234",
      deployedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid service", () => {
    expect(ServiceSchema.safeParse("invalid").success).toBe(false);
    expect(ServiceSchema.safeParse("").success).toBe(false);
  });
});

describe("RegisterDeploymentSchema", () => {
  it("accepts valid input", () => {
    const result = RegisterDeploymentSchema.safeParse({
      service: "api",
      gitSha: "abc1234",
      deployedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("accepts 40-char git SHA", () => {
    const result = RegisterDeploymentSchema.safeParse({
      service: "worker",
      gitSha: "a".repeat(40),
      deployedAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects git SHA shorter than 7 chars", () => {
    const result = RegisterDeploymentSchema.safeParse({
      service: "api",
      gitSha: "abc",
      deployedAt: new Date(),
    });
    expect(result.success).toBe(false);
  });

  it("rejects git SHA longer than 40 chars", () => {
    const result = RegisterDeploymentSchema.safeParse({
      service: "api",
      gitSha: "a".repeat(41),
      deployedAt: new Date(),
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing service", () => {
    const result = RegisterDeploymentSchema.safeParse({
      gitSha: "abc1234",
      deployedAt: new Date(),
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid service enum", () => {
    const result = RegisterDeploymentSchema.safeParse({
      service: "database",
      gitSha: "abc1234",
      deployedAt: new Date(),
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing gitSha", () => {
    const result = RegisterDeploymentSchema.safeParse({
      service: "api",
      deployedAt: new Date(),
    });
    expect(result.success).toBe(false);
  });

  it("coerces string dates to Date objects", () => {
    const result = RegisterDeploymentSchema.safeParse({
      service: "web",
      gitSha: "abc1234",
      deployedAt: "2026-02-28T14:30:00Z",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deployedAt).toBeInstanceOf(Date);
    }
  });
});

describe("DeploymentSchema", () => {
  it("accepts valid deployment", () => {
    const result = DeploymentSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      service: "api",
      gitSha: "abc1234",
      deployedAt: new Date(),
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing id", () => {
    const result = DeploymentSchema.safeParse({
      service: "api",
      gitSha: "abc1234",
      deployedAt: new Date(),
      createdAt: new Date(),
    });
    expect(result.success).toBe(false);
  });
});
