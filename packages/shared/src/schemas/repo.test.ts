import { describe, it, expect } from "vitest";
import {
  RepoStatusSchema,
  CreateRepoSchema,
  RepoSchema,
  UpdateRepoSchema,
  MoveRepoSchema,
} from "./repo.js";

describe("RepoStatusSchema", () => {
  it("accepts valid statuses", () => {
    expect(RepoStatusSchema.safeParse("creating").success).toBe(true);
    expect(RepoStatusSchema.safeParse("active").success).toBe(true);
    expect(RepoStatusSchema.safeParse("archived").success).toBe(true);
    expect(RepoStatusSchema.safeParse("error").success).toBe(true);
  });

  it("rejects invalid status", () => {
    expect(RepoStatusSchema.safeParse("deleted").success).toBe(false);
    expect(RepoStatusSchema.safeParse("").success).toBe(false);
  });
});

describe("CreateRepoSchema", () => {
  const validInput = {
    orgId: "770e8400-e29b-41d4-a716-446655440000",
    name: "My Project",
    repo: "https://github.com/user/repo",
    bdPrefix: "MP",
    color: "#6366f1",
    description: "A test project",
  };

  it("accepts valid input with all fields", () => {
    const result = CreateRepoSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("accepts valid input without optional fields", () => {
    const result = CreateRepoSchema.safeParse({
      orgId: "770e8400-e29b-41d4-a716-446655440000",
      name: "My Project",
      bdPrefix: "MP",
      color: "#6366f1",
    });
    expect(result.success).toBe(true);
  });

  it("accepts null repo", () => {
    const result = CreateRepoSchema.safeParse({
      ...validInput,
      repo: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts null description", () => {
    const result = CreateRepoSchema.safeParse({
      ...validInput,
      description: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = CreateRepoSchema.safeParse({ ...validInput, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects name over 100 characters", () => {
    const result = CreateRepoSchema.safeParse({
      ...validInput,
      name: "a".repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it("rejects bdPrefix shorter than 2 characters", () => {
    const result = CreateRepoSchema.safeParse({ ...validInput, bdPrefix: "A" });
    expect(result.success).toBe(false);
  });

  it("rejects bdPrefix longer than 4 characters", () => {
    const result = CreateRepoSchema.safeParse({
      ...validInput,
      bdPrefix: "ABCDE",
    });
    expect(result.success).toBe(false);
  });

  it("rejects lowercase bdPrefix", () => {
    const result = CreateRepoSchema.safeParse({
      ...validInput,
      bdPrefix: "mp",
    });
    expect(result.success).toBe(false);
  });

  it("rejects bdPrefix with numbers", () => {
    const result = CreateRepoSchema.safeParse({
      ...validInput,
      bdPrefix: "M1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid hex color", () => {
    expect(
      CreateRepoSchema.safeParse({ ...validInput, color: "red" }).success,
    ).toBe(false);
    expect(
      CreateRepoSchema.safeParse({ ...validInput, color: "#fff" }).success,
    ).toBe(false);
    expect(
      CreateRepoSchema.safeParse({ ...validInput, color: "#GGGGGG" }).success,
    ).toBe(false);
  });

  it("accepts valid hex colors", () => {
    expect(
      CreateRepoSchema.safeParse({ ...validInput, color: "#000000" }).success,
    ).toBe(true);
    expect(
      CreateRepoSchema.safeParse({ ...validInput, color: "#ffffff" }).success,
    ).toBe(true);
    expect(
      CreateRepoSchema.safeParse({ ...validInput, color: "#aaBB11" }).success,
    ).toBe(true);
  });

  it("rejects description over 1000 characters", () => {
    const result = CreateRepoSchema.safeParse({
      ...validInput,
      description: "a".repeat(1001),
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid icon", () => {
    const result = CreateRepoSchema.safeParse({ ...validInput, icon: "rocket" });
    expect(result.success).toBe(true);
  });

  it("accepts hyphenated icon name", () => {
    const result = CreateRepoSchema.safeParse({ ...validInput, icon: "arrow-up-right" });
    expect(result.success).toBe(true);
  });

  it("accepts null icon", () => {
    const result = CreateRepoSchema.safeParse({ ...validInput, icon: null });
    expect(result.success).toBe(true);
  });

  it("accepts omitted icon", () => {
    const { icon, ...withoutIcon } = { ...validInput, icon: undefined };
    const result = CreateRepoSchema.safeParse(withoutIcon);
    expect(result.success).toBe(true);
  });

  it("rejects uppercase icon name", () => {
    const result = CreateRepoSchema.safeParse({ ...validInput, icon: "Rocket" });
    expect(result.success).toBe(false);
  });

  it("rejects icon with special characters", () => {
    const result = CreateRepoSchema.safeParse({ ...validInput, icon: "my_icon!" });
    expect(result.success).toBe(false);
  });

  it("rejects icon over 50 characters", () => {
    const result = CreateRepoSchema.safeParse({
      ...validInput,
      icon: "a".repeat(51),
    });
    expect(result.success).toBe(false);
  });
});

describe("RepoSchema", () => {
  const validRig = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    userId: "660e8400-e29b-41d4-a716-446655440000",
    orgId: "770e8400-e29b-41d4-a716-446655440000",
    name: "My Project",
    bdPrefix: "MP",
    color: "#6366f1",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("accepts valid repo with all fields", () => {
    const result = RepoSchema.safeParse(validRig);
    expect(result.success).toBe(true);
  });

  it("defaults workspacePath to null", () => {
    const result = RepoSchema.safeParse(validRig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.workspacePath).toBeNull();
    }
  });

  it("defaults status to active", () => {
    const { status, ...withoutStatus } = validRig;
    const result = RepoSchema.safeParse(withoutStatus);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("active");
    }
  });

  it("rejects invalid uuid for id", () => {
    const result = RepoSchema.safeParse({ ...validRig, id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid uuid for userId", () => {
    const result = RepoSchema.safeParse({ ...validRig, userId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });
});

describe("UpdateRepoSchema", () => {
  it("accepts partial input with just name", () => {
    const result = UpdateRepoSchema.safeParse({ name: "New Name" });
    expect(result.success).toBe(true);
  });

  it("accepts empty object (no changes)", () => {
    const result = UpdateRepoSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("still validates constraints on provided fields", () => {
    const result = UpdateRepoSchema.safeParse({ color: "not-a-color" });
    expect(result.success).toBe(false);
  });

  it("does not accept bdPrefix (immutable after creation)", () => {
    const result = UpdateRepoSchema.safeParse({ bdPrefix: "AB" });
    // bdPrefix is omitted from UpdateRepoSchema, so it should be stripped (not validated)
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("bdPrefix");
    }
  });

  it("accepts partial color update", () => {
    const result = UpdateRepoSchema.safeParse({ color: "#ff0000" });
    expect(result.success).toBe(true);
  });

  it("accepts partial icon update", () => {
    const result = UpdateRepoSchema.safeParse({ icon: "star" });
    expect(result.success).toBe(true);
  });

  it("accepts null icon to clear it", () => {
    const result = UpdateRepoSchema.safeParse({ icon: null });
    expect(result.success).toBe(true);
  });
});

describe("MoveRepoSchema", () => {
  const validInput = {
    repoId: "550e8400-e29b-41d4-a716-446655440000",
    targetOrgId: "770e8400-e29b-41d4-a716-446655440000",
  };

  it("accepts valid input with two UUIDs", () => {
    const result = MoveRepoSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID for repoId", () => {
    const result = MoveRepoSchema.safeParse({ ...validInput, repoId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects non-UUID for targetOrgId", () => {
    const result = MoveRepoSchema.safeParse({ ...validInput, targetOrgId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects missing repoId", () => {
    const result = MoveRepoSchema.safeParse({ targetOrgId: validInput.targetOrgId });
    expect(result.success).toBe(false);
  });

  it("rejects missing targetOrgId", () => {
    const result = MoveRepoSchema.safeParse({ repoId: validInput.repoId });
    expect(result.success).toBe(false);
  });

  it("rejects empty object", () => {
    const result = MoveRepoSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
