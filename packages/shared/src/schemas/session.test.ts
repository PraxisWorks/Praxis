import { describe, it, expect } from "vitest";
import {
  SessionTypeSchema,
  SessionStatusSchema,
  SessionEntityTypeSchema,
  CreateSessionSchema,
  SessionSchema,
  UpdateSessionStatusSchema,
  PauseResumeSessionSchema,
  SessionListInputSchema,
  ListOpenQuestionsInputSchema,
  StartWorkSessionSchema,
} from "./session.js";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("SessionTypeSchema", () => {
  it("accepts all valid types", () => {
    for (const type of ["spec", "architecture", "working", "debug"]) {
      expect(SessionTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it("rejects invalid type", () => {
    expect(SessionTypeSchema.safeParse("chat").success).toBe(false);
  });
});

describe("SessionStatusSchema", () => {
  it("accepts all valid statuses", () => {
    for (const status of ["active", "paused", "completed", "error"]) {
      expect(SessionStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("rejects invalid status", () => {
    expect(SessionStatusSchema.safeParse("running").success).toBe(false);
  });

  it("accepts scheduled status", () => {
    expect(SessionStatusSchema.safeParse("scheduled").success).toBe(true);
  });
});

describe("SessionEntityTypeSchema", () => {
  it("accepts all valid entity types", () => {
    for (const type of ["repo", "idea", "epic", "task"]) {
      expect(SessionEntityTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it("rejects invalid entity type", () => {
    expect(SessionEntityTypeSchema.safeParse("user").success).toBe(false);
  });
});

describe("CreateSessionSchema", () => {
  it("accepts valid input with required fields only", () => {
    const result = CreateSessionSchema.safeParse({
      repoId: VALID_UUID,
      type: "spec",
      title: "Spec Session",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid input with all fields", () => {
    const result = CreateSessionSchema.safeParse({
      repoId: VALID_UUID,
      type: "architecture",
      entityType: "idea",
      entityId: "660e8400-e29b-41d4-a716-446655440000",
      title: "Architecture Session",
      prompt: "Custom prompt text",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing repoId", () => {
    const result = CreateSessionSchema.safeParse({
      type: "spec",
      title: "Session",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid type", () => {
    const result = CreateSessionSchema.safeParse({
      repoId: VALID_UUID,
      type: "invalid",
      title: "Session",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty title", () => {
    const result = CreateSessionSchema.safeParse({
      repoId: VALID_UUID,
      type: "spec",
      title: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("SessionSchema", () => {
  it("accepts valid session with all fields", () => {
    const result = SessionSchema.safeParse({
      id: VALID_UUID,
      repoId: "660e8400-e29b-41d4-a716-446655440000",
      userId: "770e8400-e29b-41d4-a716-446655440000",
      type: "working",
      entityType: "task",
      entityId: "880e8400-e29b-41d4-a716-446655440000",
      title: "Working on auth",
      status: "active",
      metadata: { phase: "implementation" },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it("defaults status to active", () => {
    const result = SessionSchema.safeParse({
      id: VALID_UUID,
      repoId: "660e8400-e29b-41d4-a716-446655440000",
      userId: "770e8400-e29b-41d4-a716-446655440000",
      type: "spec",
      title: "Spec Session",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("active");
      expect(result.data.metadata).toBeNull();
    }
  });
});

describe("UpdateSessionStatusSchema", () => {
  it("accepts valid status update", () => {
    const result = UpdateSessionStatusSchema.safeParse({
      id: VALID_UUID,
      status: "paused",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = UpdateSessionStatusSchema.safeParse({
      id: VALID_UUID,
      status: "stopped",
    });
    expect(result.success).toBe(false);
  });
});

describe("PauseResumeSessionSchema", () => {
  it("accepts valid input with sessionId only", () => {
    const result = PauseResumeSessionSchema.safeParse({
      sessionId: VALID_UUID,
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid input with sessionId and message", () => {
    const result = PauseResumeSessionSchema.safeParse({
      sessionId: VALID_UUID,
      message: "Pausing for review",
    });
    expect(result.success).toBe(true);
  });

  it("rejects message that is too long", () => {
    const result = PauseResumeSessionSchema.safeParse({
      sessionId: VALID_UUID,
      message: "a".repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it("accepts when message is undefined", () => {
    const result = PauseResumeSessionSchema.safeParse({
      sessionId: VALID_UUID,
      message: undefined,
    });
    expect(result.success).toBe(true);
  });
});

describe("SessionListInputSchema", () => {
  it("accepts valid input with array filters and orgIds", () => {
    const result = SessionListInputSchema.safeParse({
      typeFilter: ["working", "debug"],
      statusFilter: ["active", "paused"],
      orgIds: [VALID_UUID, "660e8400-e29b-41d4-a716-446655440000"],
      limit: 25,
    });
    expect(result.success).toBe(true);
  });

  it("accepts single-item array filters", () => {
    const result = SessionListInputSchema.safeParse({
      typeFilter: ["spec"],
      statusFilter: ["active"],
      limit: 10,
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty arrays for typeFilter and statusFilter", () => {
    const result = SessionListInputSchema.safeParse({
      typeFilter: [],
      statusFilter: [],
    });
    expect(result.success).toBe(true);
  });

  it("accepts omitted filters (optional)", () => {
    const result = SessionListInputSchema.safeParse({
      limit: 10,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid enum values in typeFilter array", () => {
    const result = SessionListInputSchema.safeParse({
      typeFilter: ["spec", "invalid"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid enum values in statusFilter array", () => {
    const result = SessionListInputSchema.safeParse({
      statusFilter: ["active", "stopped"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects typeFilter array exceeding max 5", () => {
    const result = SessionListInputSchema.safeParse({
      typeFilter: ["spec", "architecture", "working", "debug", "repo", "spec"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects statusFilter array exceeding max 5", () => {
    const result = SessionListInputSchema.safeParse({
      statusFilter: ["active", "paused", "completed", "error", "scheduled", "active"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts empty array for orgIds", () => {
    const result = SessionListInputSchema.safeParse({
      orgIds: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects orgIds with non-UUID strings", () => {
    const result = SessionListInputSchema.safeParse({
      orgIds: ["not-a-uuid"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects orgIds array exceeding max 50", () => {
    const result = SessionListInputSchema.safeParse({
      orgIds: Array.from({ length: 51 }, () => VALID_UUID),
    });
    expect(result.success).toBe(false);
  });
});

describe("ListOpenQuestionsInputSchema", () => {
  it("accepts empty object (all fields optional)", () => {
    const result = ListOpenQuestionsInputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts valid repoId UUID", () => {
    const result = ListOpenQuestionsInputSchema.safeParse({
      repoId: VALID_UUID,
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid sessionId UUID", () => {
    const result = ListOpenQuestionsInputSchema.safeParse({
      sessionId: VALID_UUID,
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid olderThanMinutes positive integer", () => {
    const result = ListOpenQuestionsInputSchema.safeParse({
      olderThanMinutes: 5,
    });
    expect(result.success).toBe(true);
  });

  it("accepts all fields together", () => {
    const result = ListOpenQuestionsInputSchema.safeParse({
      repoId: VALID_UUID,
      sessionId: VALID_UUID,
      olderThanMinutes: 10,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid repoId (non-UUID string)", () => {
    const result = ListOpenQuestionsInputSchema.safeParse({
      repoId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid sessionId (non-UUID string)", () => {
    const result = ListOpenQuestionsInputSchema.safeParse({
      sessionId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative olderThanMinutes", () => {
    const result = ListOpenQuestionsInputSchema.safeParse({
      olderThanMinutes: -5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer olderThanMinutes", () => {
    const result = ListOpenQuestionsInputSchema.safeParse({
      olderThanMinutes: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

describe("StartWorkSessionSchema", () => {
  it("accepts valid input without scheduledFor", () => {
    const result = StartWorkSessionSchema.safeParse({
      repoId: VALID_UUID,
      entityType: "task",
      entityId: "550e8400-e29b-41d4-a716-446655440001",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid input with scheduledFor", () => {
    const future = new Date(Date.now() + 3600000).toISOString();
    const result = StartWorkSessionSchema.safeParse({
      repoId: VALID_UUID,
      entityType: "task",
      entityId: "550e8400-e29b-41d4-a716-446655440001",
      scheduledFor: future,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid scheduledFor format", () => {
    const result = StartWorkSessionSchema.safeParse({
      repoId: VALID_UUID,
      entityType: "task",
      entityId: "550e8400-e29b-41d4-a716-446655440001",
      scheduledFor: "not-a-date",
    });
    expect(result.success).toBe(false);
  });
});
