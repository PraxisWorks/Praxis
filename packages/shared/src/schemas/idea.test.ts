import { describe, it, expect } from "vitest";
import {
  IdeaStatusSchema,
  IdeaSourceSchema,
  IdeaSizeSchema,
  CreateIdeaSchema,
  IdeaSchema,
  UpdateIdeaSchema,
  ReorderIdeasSchema,
} from "./idea.js";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("IdeaStatusSchema", () => {
  it("accepts all valid statuses", () => {
    for (const status of ["new", "planning", "planned", "in_progress", "complete", "dismissed", "archived"]) {
      expect(IdeaStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("rejects invalid status", () => {
    expect(IdeaStatusSchema.safeParse("deleted").success).toBe(false);
  });
});

describe("IdeaSourceSchema", () => {
  it("accepts human and ai", () => {
    expect(IdeaSourceSchema.safeParse("human").success).toBe(true);
    expect(IdeaSourceSchema.safeParse("ai").success).toBe(true);
  });

  it("rejects invalid source", () => {
    expect(IdeaSourceSchema.safeParse("bot").success).toBe(false);
  });
});

describe("IdeaSizeSchema", () => {
  it("accepts all valid sizes", () => {
    for (const size of ["xs", "s", "m", "l", "xl"]) {
      expect(IdeaSizeSchema.safeParse(size).success).toBe(true);
    }
  });

  it("rejects invalid size", () => {
    expect(IdeaSizeSchema.safeParse("xxl").success).toBe(false);
    expect(IdeaSizeSchema.safeParse("medium").success).toBe(false);
  });
});

describe("CreateIdeaSchema", () => {
  it("accepts valid input with required fields only", () => {
    const result = CreateIdeaSchema.safeParse({
      repoId: VALID_UUID,
      title: "Add auth",
      description: "Implement authentication flow",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toBe("human");
      expect(result.data.tags).toEqual([]);
    }
  });

  it("accepts valid input with all fields", () => {
    const result = CreateIdeaSchema.safeParse({
      repoId: VALID_UUID,
      title: "Add auth",
      description: "Implement authentication flow",
      source: "ai",
      tags: ["auth", "security"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing repoId", () => {
    const result = CreateIdeaSchema.safeParse({
      title: "Add auth",
      description: "Desc",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid repoId", () => {
    const result = CreateIdeaSchema.safeParse({
      repoId: "not-a-uuid",
      title: "Add auth",
      description: "Desc",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty title", () => {
    const result = CreateIdeaSchema.safeParse({
      repoId: VALID_UUID,
      title: "",
      description: "Desc",
    });
    expect(result.success).toBe(false);
  });

  it("rejects title over 255 chars", () => {
    const result = CreateIdeaSchema.safeParse({
      repoId: VALID_UUID,
      title: "a".repeat(256),
      description: "Desc",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty description", () => {
    const result = CreateIdeaSchema.safeParse({
      repoId: VALID_UUID,
      title: "Add auth",
      description: "",
    });
    expect(result.success).toBe(false);
  });

  it("accepts create with optional size", () => {
    const result = CreateIdeaSchema.safeParse({
      repoId: VALID_UUID,
      title: "Add auth",
      description: "Implement authentication flow",
      size: "m",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.size).toBe("m");
    }
  });

  it("accepts create without size", () => {
    const result = CreateIdeaSchema.safeParse({
      repoId: VALID_UUID,
      title: "Add auth",
      description: "Implement authentication flow",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.size).toBeUndefined();
    }
  });

  it("rejects invalid size value", () => {
    const result = CreateIdeaSchema.safeParse({
      repoId: VALID_UUID,
      title: "Add auth",
      description: "Implement authentication flow",
      size: "xxl",
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than 20 tags", () => {
    const result = CreateIdeaSchema.safeParse({
      repoId: VALID_UUID,
      title: "Add auth",
      description: "Desc",
      tags: Array.from({ length: 21 }, (_, i) => `tag-${i}`),
    });
    expect(result.success).toBe(false);
  });
});

describe("IdeaSchema", () => {
  it("accepts valid idea with all fields", () => {
    const result = IdeaSchema.safeParse({
      id: VALID_UUID,
      repoId: "660e8400-e29b-41d4-a716-446655440000",
      userId: "770e8400-e29b-41d4-a716-446655440000",
      title: "Add auth",
      description: "Implement authentication",
      source: "human",
      tags: ["auth"],
      status: "new",
      order: 0,
      size: "m",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it("accepts null size", () => {
    const result = IdeaSchema.safeParse({
      id: VALID_UUID,
      repoId: "660e8400-e29b-41d4-a716-446655440000",
      userId: "770e8400-e29b-41d4-a716-446655440000",
      title: "Add auth",
      description: "Implement authentication",
      source: "human",
      tags: ["auth"],
      status: "new",
      order: 0,
      size: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.size).toBeNull();
    }
  });
});

describe("UpdateIdeaSchema", () => {
  it("accepts partial update with only title", () => {
    const result = UpdateIdeaSchema.safeParse({ title: "New Title" });
    expect(result.success).toBe(true);
  });

  it("accepts status update", () => {
    const result = UpdateIdeaSchema.safeParse({ status: "planning" });
    expect(result.success).toBe(true);
  });

  it("accepts empty object", () => {
    const result = UpdateIdeaSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects invalid status in update", () => {
    const result = UpdateIdeaSchema.safeParse({ status: "invalid" });
    expect(result.success).toBe(false);
  });

  it("accepts size update with valid value", () => {
    const result = UpdateIdeaSchema.safeParse({ size: "l" });
    expect(result.success).toBe(true);
  });

  it("accepts size set to null", () => {
    const result = UpdateIdeaSchema.safeParse({ size: null });
    expect(result.success).toBe(true);
  });

  it("rejects invalid size value", () => {
    const result = UpdateIdeaSchema.safeParse({ size: "xxl" });
    expect(result.success).toBe(false);
  });
});

describe("ReorderIdeasSchema", () => {
  it("accepts valid reorder array", () => {
    const result = ReorderIdeasSchema.safeParse([
      { id: VALID_UUID, order: 0 },
      { id: "660e8400-e29b-41d4-a716-446655440000", order: 1 },
    ]);
    expect(result.success).toBe(true);
  });

  it("accepts empty array", () => {
    const result = ReorderIdeasSchema.safeParse([]);
    expect(result.success).toBe(true);
  });

  it("rejects negative order", () => {
    const result = ReorderIdeasSchema.safeParse([
      { id: VALID_UUID, order: -1 },
    ]);
    expect(result.success).toBe(false);
  });

  it("rejects invalid uuid in reorder", () => {
    const result = ReorderIdeasSchema.safeParse([
      { id: "not-a-uuid", order: 0 },
    ]);
    expect(result.success).toBe(false);
  });
});
