import { describe, it, expect } from "vitest";
import {
  TaskStatusSchema,
  TaskPrioritySchema,
  CreateTaskSchema,
  UpdateTaskSchema,
  TaskDependencySchema,
  TaskListInputSchema,
} from "./task.js";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_UUID_2 = "660e8400-e29b-41d4-a716-446655440001";

describe("TaskStatusSchema", () => {
  it("accepts all valid statuses", () => {
    for (const status of ["draft", "approved", "in_progress", "blocked", "complete", "archived"]) {
      expect(TaskStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("rejects invalid status", () => {
    expect(TaskStatusSchema.safeParse("pending").success).toBe(false);
  });
});

describe("TaskPrioritySchema", () => {
  it("accepts all valid priorities", () => {
    for (const priority of ["low", "medium", "high"]) {
      expect(TaskPrioritySchema.safeParse(priority).success).toBe(true);
    }
  });

  it("rejects invalid priority", () => {
    expect(TaskPrioritySchema.safeParse("critical").success).toBe(false);
  });
});

describe("CreateTaskSchema", () => {
  it("accepts valid input with required fields only", () => {
    const result = CreateTaskSchema.safeParse({
      repoId: VALID_UUID,
      title: "Setup auth",
      description: "Implement authentication flow",
      priority: "high",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isEpic).toBe(false);
      expect(result.data.parentId).toBeUndefined();
      expect(result.data.notes).toBeUndefined();
    }
  });

  it("accepts valid input with all optional fields", () => {
    const result = CreateTaskSchema.safeParse({
      repoId: VALID_UUID,
      parentId: VALID_UUID_2,
      ideaId: VALID_UUID_2,
      title: "Setup auth",
      description: "Implement authentication flow",
      notes: "Some notes here",
      priority: "medium",
      isEpic: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isEpic).toBe(true);
      expect(result.data.parentId).toBe(VALID_UUID_2);
      expect(result.data.notes).toBe("Some notes here");
    }
  });

  it("defaults isEpic to false", () => {
    const result = CreateTaskSchema.safeParse({
      repoId: VALID_UUID,
      title: "Test",
      description: "Desc",
      priority: "low",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isEpic).toBe(false);
    }
  });

  it("rejects empty title", () => {
    const result = CreateTaskSchema.safeParse({
      repoId: VALID_UUID,
      title: "",
      description: "Desc",
      priority: "low",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty description", () => {
    const result = CreateTaskSchema.safeParse({
      repoId: VALID_UUID,
      title: "Title",
      description: "",
      priority: "low",
    });
    expect(result.success).toBe(false);
  });

  it("rejects title over 500 chars", () => {
    const result = CreateTaskSchema.safeParse({
      repoId: VALID_UUID,
      title: "a".repeat(501),
      description: "Desc",
      priority: "low",
    });
    expect(result.success).toBe(false);
  });

  it("rejects description over 10000 chars", () => {
    const result = CreateTaskSchema.safeParse({
      repoId: VALID_UUID,
      title: "Title",
      description: "a".repeat(10001),
      priority: "low",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid repoId", () => {
    const result = CreateTaskSchema.safeParse({
      repoId: "not-a-uuid",
      title: "Title",
      description: "Desc",
      priority: "low",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid priority", () => {
    const result = CreateTaskSchema.safeParse({
      repoId: VALID_UUID,
      title: "Title",
      description: "Desc",
      priority: "critical",
    });
    expect(result.success).toBe(false);
  });

  it("accepts null parentId", () => {
    const result = CreateTaskSchema.safeParse({
      repoId: VALID_UUID,
      parentId: null,
      title: "Title",
      description: "Desc",
      priority: "low",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.parentId).toBeNull();
    }
  });
});

describe("UpdateTaskSchema", () => {
  it("accepts partial update with only title", () => {
    const result = UpdateTaskSchema.safeParse({
      id: VALID_UUID,
      title: "New Title",
    });
    expect(result.success).toBe(true);
  });

  it("accepts status change", () => {
    const result = UpdateTaskSchema.safeParse({
      id: VALID_UUID,
      status: "in_progress",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing id", () => {
    const result = UpdateTaskSchema.safeParse({
      title: "New Title",
    });
    expect(result.success).toBe(false);
  });

  it("accepts null parentId", () => {
    const result = UpdateTaskSchema.safeParse({
      id: VALID_UUID,
      parentId: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.parentId).toBeNull();
    }
  });

  it("rejects invalid status", () => {
    const result = UpdateTaskSchema.safeParse({
      id: VALID_UUID,
      status: "invalid",
    });
    expect(result.success).toBe(false);
  });
});

describe("TaskDependencySchema", () => {
  it("accepts valid dependency", () => {
    const result = TaskDependencySchema.safeParse({
      taskId: VALID_UUID,
      dependsOnId: VALID_UUID_2,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid taskId", () => {
    const result = TaskDependencySchema.safeParse({
      taskId: "not-a-uuid",
      dependsOnId: VALID_UUID_2,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid dependsOnId", () => {
    const result = TaskDependencySchema.safeParse({
      taskId: VALID_UUID,
      dependsOnId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });
});

describe("TaskListInputSchema", () => {
  it("accepts null repoId for All Repos mode", () => {
    const result = TaskListInputSchema.safeParse({
      repoId: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.repoId).toBeNull();
    }
  });

  it("accepts repoId only", () => {
    const result = TaskListInputSchema.safeParse({
      repoId: VALID_UUID,
    });
    expect(result.success).toBe(true);
  });

  it("accepts all filters", () => {
    const result = TaskListInputSchema.safeParse({
      repoId: VALID_UUID,
      status: "draft",
      parentId: VALID_UUID_2,
      isEpic: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts null parentId filter", () => {
    const result = TaskListInputSchema.safeParse({
      repoId: VALID_UUID,
      parentId: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.parentId).toBeNull();
    }
  });

  it("rejects missing repoId", () => {
    const result = TaskListInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects invalid repoId", () => {
    const result = TaskListInputSchema.safeParse({
      repoId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });
});
