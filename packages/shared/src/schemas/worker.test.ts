import { describe, it, expect } from "vitest";
import {
  WorkerStatusSchema,
  CreateWorkerSchema,
  WorkerSchema,
  UpdateWorkerSchema,
  CreateWorkerTokenSchema,
  WorkerTokenSchema,
  RepoInitSettingsSchema,
  RepoInitModeSchema,
} from "./worker.js";

describe("WorkerStatusSchema", () => {
  it("accepts valid statuses", () => {
    expect(WorkerStatusSchema.safeParse("online").success).toBe(true);
    expect(WorkerStatusSchema.safeParse("offline").success).toBe(true);
  });

  it("rejects invalid status", () => {
    expect(WorkerStatusSchema.safeParse("busy").success).toBe(false);
    expect(WorkerStatusSchema.safeParse("").success).toBe(false);
    expect(WorkerStatusSchema.safeParse(123).success).toBe(false);
  });
});

describe("CreateWorkerSchema", () => {
  it("accepts valid input", () => {
    const result = CreateWorkerSchema.safeParse({ name: "My Worker" });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = CreateWorkerSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing name", () => {
    const result = CreateWorkerSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects name over 100 characters", () => {
    const result = CreateWorkerSchema.safeParse({ name: "a".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("accepts name at exactly 100 characters", () => {
    const result = CreateWorkerSchema.safeParse({ name: "a".repeat(100) });
    expect(result.success).toBe(true);
  });

  it("accepts name at exactly 1 character", () => {
    const result = CreateWorkerSchema.safeParse({ name: "a" });
    expect(result.success).toBe(true);
  });
});

describe("WorkerSchema", () => {
  const validWorker = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    userId: "660e8400-e29b-41d4-a716-446655440000",
    name: "My Worker",
    status: "online",
    lastSeenAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("accepts valid worker with all fields", () => {
    const result = WorkerSchema.safeParse(validWorker);
    expect(result.success).toBe(true);
  });

  it("defaults status to offline", () => {
    const { status, ...withoutStatus } = validWorker;
    const result = WorkerSchema.safeParse(withoutStatus);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("offline");
    }
  });

  it("rejects invalid uuid for id", () => {
    const result = WorkerSchema.safeParse({ ...validWorker, id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid uuid for userId", () => {
    const result = WorkerSchema.safeParse({
      ...validWorker,
      userId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid status", () => {
    const result = WorkerSchema.safeParse({
      ...validWorker,
      status: "busy",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-date for lastSeenAt", () => {
    const result = WorkerSchema.safeParse({
      ...validWorker,
      lastSeenAt: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-date for createdAt", () => {
    const result = WorkerSchema.safeParse({
      ...validWorker,
      createdAt: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-date for updatedAt", () => {
    const result = WorkerSchema.safeParse({
      ...validWorker,
      updatedAt: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const result = WorkerSchema.safeParse({ name: "My Worker" });
    expect(result.success).toBe(false);
  });
});

describe("UpdateWorkerSchema", () => {
  it("accepts partial input with just name", () => {
    const result = UpdateWorkerSchema.safeParse({ name: "New Name" });
    expect(result.success).toBe(true);
  });

  it("accepts empty object (no changes)", () => {
    const result = UpdateWorkerSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("still validates constraints on provided fields", () => {
    const result = UpdateWorkerSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects name over 100 characters", () => {
    const result = UpdateWorkerSchema.safeParse({ name: "a".repeat(101) });
    expect(result.success).toBe(false);
  });
});

describe("CreateWorkerTokenSchema", () => {
  it("accepts empty object", () => {
    const result = CreateWorkerTokenSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("WorkerTokenSchema", () => {
  const validToken = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    userId: "660e8400-e29b-41d4-a716-446655440000",
    tokenHash: "abc123hash",
    expiresAt: new Date(),
    used: false,
    createdAt: new Date(),
  };

  it("accepts valid token with all fields", () => {
    const result = WorkerTokenSchema.safeParse(validToken);
    expect(result.success).toBe(true);
  });

  it("defaults used to false", () => {
    const { used, ...withoutUsed } = validToken;
    const result = WorkerTokenSchema.safeParse(withoutUsed);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.used).toBe(false);
    }
  });

  it("accepts used as true", () => {
    const result = WorkerTokenSchema.safeParse({ ...validToken, used: true });
    expect(result.success).toBe(true);
  });

  it("rejects invalid uuid for id", () => {
    const result = WorkerTokenSchema.safeParse({
      ...validToken,
      id: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid uuid for userId", () => {
    const result = WorkerTokenSchema.safeParse({
      ...validToken,
      userId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-date for expiresAt", () => {
    const result = WorkerTokenSchema.safeParse({
      ...validToken,
      expiresAt: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-date for createdAt", () => {
    const result = WorkerTokenSchema.safeParse({
      ...validToken,
      createdAt: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing tokenHash", () => {
    const { tokenHash, ...withoutHash } = validToken;
    const result = WorkerTokenSchema.safeParse(withoutHash);
    expect(result.success).toBe(false);
  });

  it("rejects non-boolean for used", () => {
    const result = WorkerTokenSchema.safeParse({
      ...validToken,
      used: "yes",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const result = WorkerTokenSchema.safeParse({ tokenHash: "abc123" });
    expect(result.success).toBe(false);
  });
});

describe("RepoInitModeSchema", () => {
  it("accepts 'ruflo'", () => {
    expect(RepoInitModeSchema.safeParse("ruflo").success).toBe(true);
  });

  it("accepts 'custom'", () => {
    expect(RepoInitModeSchema.safeParse("custom").success).toBe(true);
  });

  it("rejects invalid modes", () => {
    expect(RepoInitModeSchema.safeParse("other").success).toBe(false);
    expect(RepoInitModeSchema.safeParse("").success).toBe(false);
  });
});

describe("RepoInitSettingsSchema", () => {
  it("accepts ruflo mode with no scripts", () => {
    const result = RepoInitSettingsSchema.safeParse({ mode: "ruflo" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe("ruflo");
      expect(result.data.scripts).toEqual([]);
    }
  });

  it("accepts custom mode with scripts", () => {
    const result = RepoInitSettingsSchema.safeParse({
      mode: "custom",
      scripts: ["/usr/local/bin/setup.sh", "~/scripts/init.sh"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe("custom");
      expect(result.data.scripts).toEqual(["/usr/local/bin/setup.sh", "~/scripts/init.sh"]);
    }
  });

  it("defaults scripts to empty array when omitted", () => {
    const result = RepoInitSettingsSchema.safeParse({ mode: "custom" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scripts).toEqual([]);
    }
  });

  it("rejects missing mode", () => {
    const result = RepoInitSettingsSchema.safeParse({ scripts: [] });
    expect(result.success).toBe(false);
  });

  it("rejects invalid mode", () => {
    const result = RepoInitSettingsSchema.safeParse({ mode: "docker" });
    expect(result.success).toBe(false);
  });

  it("rejects non-string script entries", () => {
    const result = RepoInitSettingsSchema.safeParse({ mode: "custom", scripts: [123] });
    expect(result.success).toBe(false);
  });
});
