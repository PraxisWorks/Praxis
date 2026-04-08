import { describe, it, expect } from "vitest";
import { CreateIdeaAttachmentSchema, IdeaAttachmentSchema } from "./ideaAttachment.js";

describe("CreateIdeaAttachmentSchema", () => {
  const validInput = {
    ideaId: "550e8400-e29b-41d4-a716-446655440000",
    filename: "design.png",
    mimeType: "image/png",
    sizeBytes: 12345,
    storageKey: "uploads/abc/design.png",
  };

  it("accepts valid input", () => {
    expect(CreateIdeaAttachmentSchema.safeParse(validInput).success).toBe(true);
  });

  it("rejects missing ideaId", () => {
    const { ideaId, ...rest } = validInput;
    expect(CreateIdeaAttachmentSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects invalid ideaId format", () => {
    expect(CreateIdeaAttachmentSchema.safeParse({ ...validInput, ideaId: "not-uuid" }).success).toBe(false);
  });

  it("rejects empty filename", () => {
    expect(CreateIdeaAttachmentSchema.safeParse({ ...validInput, filename: "" }).success).toBe(false);
  });

  it("rejects negative sizeBytes", () => {
    expect(CreateIdeaAttachmentSchema.safeParse({ ...validInput, sizeBytes: -1 }).success).toBe(false);
  });

  it("rejects empty storageKey", () => {
    expect(CreateIdeaAttachmentSchema.safeParse({ ...validInput, storageKey: "" }).success).toBe(false);
  });
});

describe("IdeaAttachmentSchema", () => {
  it("accepts valid full attachment", () => {
    const result = IdeaAttachmentSchema.safeParse({
      id: "660e8400-e29b-41d4-a716-446655440001",
      ideaId: "550e8400-e29b-41d4-a716-446655440000",
      userId: "770e8400-e29b-41d4-a716-446655440002",
      filename: "design.png",
      mimeType: "image/png",
      sizeBytes: 12345,
      storageKey: "uploads/abc/design.png",
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing userId", () => {
    const result = IdeaAttachmentSchema.safeParse({
      id: "660e8400-e29b-41d4-a716-446655440001",
      ideaId: "550e8400-e29b-41d4-a716-446655440000",
      filename: "design.png",
      mimeType: "image/png",
      sizeBytes: 12345,
      storageKey: "uploads/abc/design.png",
      createdAt: new Date(),
    });
    expect(result.success).toBe(false);
  });
});
