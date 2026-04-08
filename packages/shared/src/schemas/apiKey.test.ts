import { describe, it, expect } from "vitest";
import {
  ApiKeyStatusEnum,
  CreateApiKeySchema,
  ApiKeySchema,
} from "./apiKey.js";

describe("CreateApiKeySchema", () => {
  it("accepts valid input", () => {
    const result = CreateApiKeySchema.safeParse({
      label: "My Key",
      key: "sk-ant-abc123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing label", () => {
    const result = CreateApiKeySchema.safeParse({ key: "sk-ant-abc123" });
    expect(result.success).toBe(false);
  });

  it("rejects empty label", () => {
    const result = CreateApiKeySchema.safeParse({
      label: "",
      key: "sk-ant-abc123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects label over 100 characters", () => {
    const result = CreateApiKeySchema.safeParse({
      label: "a".repeat(101),
      key: "sk-ant-abc123",
    });
    expect(result.success).toBe(false);
  });

  it("accepts label at exactly 100 characters", () => {
    const result = CreateApiKeySchema.safeParse({
      label: "a".repeat(100),
      key: "sk-ant-abc123",
    });
    expect(result.success).toBe(true);
  });

  it("accepts label at exactly 1 character", () => {
    const result = CreateApiKeySchema.safeParse({
      label: "a",
      key: "sk-ant-abc123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects key without sk-ant- prefix", () => {
    const result = CreateApiKeySchema.safeParse({
      label: "My Key",
      key: "invalid-key-123",
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid key with sk-ant- prefix", () => {
    const result = CreateApiKeySchema.safeParse({
      label: "My Key",
      key: "sk-ant-api03-abcdef1234567890",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing key", () => {
    const result = CreateApiKeySchema.safeParse({ label: "My Key" });
    expect(result.success).toBe(false);
  });
});

describe("ApiKeyStatusEnum", () => {
  it("accepts valid statuses", () => {
    expect(ApiKeyStatusEnum.safeParse("active").success).toBe(true);
    expect(ApiKeyStatusEnum.safeParse("provisioning").success).toBe(true);
    expect(ApiKeyStatusEnum.safeParse("error").success).toBe(true);
    expect(ApiKeyStatusEnum.safeParse("revoked").success).toBe(true);
  });

  it("rejects invalid status", () => {
    expect(ApiKeyStatusEnum.safeParse("deleted").success).toBe(false);
    expect(ApiKeyStatusEnum.safeParse("").success).toBe(false);
    expect(ApiKeyStatusEnum.safeParse(123).success).toBe(false);
  });
});

describe("ApiKeySchema", () => {
  const validApiKey = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    userId: "660e8400-e29b-41d4-a716-446655440000",
    label: "Production Key",
    keyLastFour: "ab12",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("accepts valid full object", () => {
    const result = ApiKeySchema.safeParse(validApiKey);
    expect(result.success).toBe(true);
  });

  it("defaults status to active", () => {
    const { status, ...withoutStatus } = validApiKey;
    const result = ApiKeySchema.safeParse(withoutStatus);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("active");
    }
  });

  it("rejects missing required fields", () => {
    const result = ApiKeySchema.safeParse({ label: "Production Key" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid uuid for id", () => {
    const result = ApiKeySchema.safeParse({
      ...validApiKey,
      id: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid uuid for userId", () => {
    const result = ApiKeySchema.safeParse({
      ...validApiKey,
      userId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid status", () => {
    const result = ApiKeySchema.safeParse({
      ...validApiKey,
      status: "deleted",
    });
    expect(result.success).toBe(false);
  });

  it("rejects keyLastFour with wrong length", () => {
    const result = ApiKeySchema.safeParse({
      ...validApiKey,
      keyLastFour: "ab",
    });
    expect(result.success).toBe(false);
  });

  it("rejects keyLastFour over 4 characters", () => {
    const result = ApiKeySchema.safeParse({
      ...validApiKey,
      keyLastFour: "abcde",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-date for createdAt", () => {
    const result = ApiKeySchema.safeParse({
      ...validApiKey,
      createdAt: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-date for updatedAt", () => {
    const result = ApiKeySchema.safeParse({
      ...validApiKey,
      updatedAt: "not-a-date",
    });
    expect(result.success).toBe(false);
  });
});
