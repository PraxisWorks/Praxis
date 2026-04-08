import { describe, it, expect } from "vitest";
import { CreateUserSchema, UserSchema, RoleSchema, UpdateUserRoleSchema, GetUserStatsInputSchema, UserStatsSchema } from "./user.js";

describe("CreateUserSchema", () => {
  it("accepts valid input", () => {
    const result = CreateUserSchema.safeParse({ name: "Alice", email: "alice@example.com" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = CreateUserSchema.safeParse({ name: "Alice", email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = CreateUserSchema.safeParse({ name: "", email: "alice@example.com" });
    expect(result.success).toBe(false);
  });
});

describe("UserSchema", () => {
  it("accepts valid user", () => {
    const result = UserSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      name: "Alice",
      email: "alice@example.com",
      role: "user",
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid uuid", () => {
    const result = UserSchema.safeParse({
      id: "not-a-uuid",
      name: "Alice",
      email: "alice@example.com",
      role: "user",
      createdAt: new Date(),
    });
    expect(result.success).toBe(false);
  });

  it("defaults role to user", () => {
    const result = UserSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      name: "Alice",
      email: "alice@example.com",
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe("user");
    }
  });
});

describe("RoleSchema", () => {
  it("accepts valid roles", () => {
    expect(RoleSchema.safeParse("user").success).toBe(true);
    expect(RoleSchema.safeParse("admin").success).toBe(true);
  });

  it("rejects invalid role", () => {
    expect(RoleSchema.safeParse("superadmin").success).toBe(false);
  });
});

describe("UpdateUserRoleSchema", () => {
  it("accepts valid input", () => {
    const result = UpdateUserRoleSchema.safeParse({ email: "a@b.com", role: "admin" });
    expect(result.success).toBe(true);
  });
});

describe("GetUserStatsInputSchema", () => {
  it("accepts valid UUID", () => {
    const result = GetUserStatsInputSchema.safeParse({
      userId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid UUID", () => {
    const result = GetUserStatsInputSchema.safeParse({
      userId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing userId", () => {
    const result = GetUserStatsInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("UserStatsSchema", () => {
  it("validates a correct stats object", () => {
    const result = UserStatsSchema.safeParse({
      totalSessions: 5,
      sessionsByType: { work: 3, debug: 2 },
      lastSessionAt: new Date(),
      lastLoginAt: new Date(),
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing fields", () => {
    const result = UserStatsSchema.safeParse({
      totalSessions: 5,
    });
    expect(result.success).toBe(false);
  });

  it("handles nullable fields correctly", () => {
    const result = UserStatsSchema.safeParse({
      totalSessions: 0,
      sessionsByType: {},
      lastSessionAt: null,
      lastLoginAt: null,
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lastSessionAt).toBeNull();
      expect(result.data.lastLoginAt).toBeNull();
    }
  });
});
