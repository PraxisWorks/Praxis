import { describe, it, expect } from "vitest";
import { CreateSpecSchema, SpecSchema, UpdateSpecSchema } from "./spec.js";

describe("CreateSpecSchema", () => {
  it("accepts valid input", () => {
    const result = CreateSpecSchema.safeParse({
      repoId: "550e8400-e29b-41d4-a716-446655440000",
      title: "Project Spec",
      content: "# Overview\nThis project...",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing repoId", () => {
    const result = CreateSpecSchema.safeParse({
      title: "Spec",
      content: "Content",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid repoId format", () => {
    const result = CreateSpecSchema.safeParse({
      repoId: "not-a-uuid",
      title: "Spec",
      content: "Content",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty title", () => {
    const result = CreateSpecSchema.safeParse({
      repoId: "550e8400-e29b-41d4-a716-446655440000",
      title: "",
      content: "Content",
    });
    expect(result.success).toBe(false);
  });

  it("rejects title over 255 chars", () => {
    const result = CreateSpecSchema.safeParse({
      repoId: "550e8400-e29b-41d4-a716-446655440000",
      title: "a".repeat(256),
      content: "Content",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty content", () => {
    const result = CreateSpecSchema.safeParse({
      repoId: "550e8400-e29b-41d4-a716-446655440000",
      title: "Spec",
      content: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("SpecSchema", () => {
  it("accepts valid spec with all fields", () => {
    const result = SpecSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      repoId: "660e8400-e29b-41d4-a716-446655440000",
      title: "Project Spec",
      content: "# Overview",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid uuid for id", () => {
    const result = SpecSchema.safeParse({
      id: "not-a-uuid",
      repoId: "660e8400-e29b-41d4-a716-446655440000",
      title: "Spec",
      content: "Content",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.success).toBe(false);
  });
});

describe("UpdateSpecSchema", () => {
  it("accepts partial update with only title", () => {
    const result = UpdateSpecSchema.safeParse({ title: "New Title" });
    expect(result.success).toBe(true);
  });

  it("accepts partial update with only content", () => {
    const result = UpdateSpecSchema.safeParse({ content: "New content" });
    expect(result.success).toBe(true);
  });

  it("accepts empty object (no fields to update)", () => {
    const result = UpdateSpecSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("does not accept repoId (omitted from update schema)", () => {
    const result = UpdateSpecSchema.safeParse({
      repoId: "550e8400-e29b-41d4-a716-446655440000",
    });
    // repoId is stripped (omitted), so this succeeds but repoId is not in output
    expect(result.success).toBe(true);
    if (result.success) {
      expect("repoId" in result.data).toBe(false);
    }
  });
});
