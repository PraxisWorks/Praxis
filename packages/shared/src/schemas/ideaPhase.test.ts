import { describe, it, expect } from "vitest";
import { CreateIdeaPhaseSchema, IdeaPhaseSchema } from "./ideaPhase.js";

describe("CreateIdeaPhaseSchema", () => {
  const validInput = {
    ideaId: "550e8400-e29b-41d4-a716-446655440000",
    sessionId: "660e8400-e29b-41d4-a716-446655440001",
    phaseNumber: 1,
    phaseName: "Specification",
    content: "Define the project requirements and scope.",
  };

  it("accepts valid input", () => {
    expect(CreateIdeaPhaseSchema.safeParse(validInput).success).toBe(true);
  });

  it("rejects missing ideaId", () => {
    const { ideaId, ...rest } = validInput;
    expect(CreateIdeaPhaseSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects missing sessionId", () => {
    const { sessionId, ...rest } = validInput;
    expect(CreateIdeaPhaseSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects missing phaseNumber", () => {
    const { phaseNumber, ...rest } = validInput;
    expect(CreateIdeaPhaseSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects missing phaseName", () => {
    const { phaseName, ...rest } = validInput;
    expect(CreateIdeaPhaseSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects missing content", () => {
    const { content, ...rest } = validInput;
    expect(CreateIdeaPhaseSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects invalid ideaId format", () => {
    expect(CreateIdeaPhaseSchema.safeParse({ ...validInput, ideaId: "not-uuid" }).success).toBe(false);
  });

  it("rejects invalid sessionId format", () => {
    expect(CreateIdeaPhaseSchema.safeParse({ ...validInput, sessionId: "not-uuid" }).success).toBe(false);
  });

  it("rejects phaseNumber 0", () => {
    expect(CreateIdeaPhaseSchema.safeParse({ ...validInput, phaseNumber: 0 }).success).toBe(false);
  });

  it("accepts phaseNumber 1", () => {
    expect(CreateIdeaPhaseSchema.safeParse({ ...validInput, phaseNumber: 1 }).success).toBe(true);
  });

  it("accepts phaseNumber 8", () => {
    expect(CreateIdeaPhaseSchema.safeParse({ ...validInput, phaseNumber: 8 }).success).toBe(true);
  });

  it("rejects phaseNumber 9", () => {
    expect(CreateIdeaPhaseSchema.safeParse({ ...validInput, phaseNumber: 9 }).success).toBe(false);
  });

  it("rejects empty phaseName", () => {
    expect(CreateIdeaPhaseSchema.safeParse({ ...validInput, phaseName: "" }).success).toBe(false);
  });

  it("rejects phaseName over 100 characters", () => {
    expect(CreateIdeaPhaseSchema.safeParse({ ...validInput, phaseName: "a".repeat(101) }).success).toBe(false);
  });

  it("accepts phaseName at 100 characters", () => {
    expect(CreateIdeaPhaseSchema.safeParse({ ...validInput, phaseName: "a".repeat(100) }).success).toBe(true);
  });

  it("rejects empty content", () => {
    expect(CreateIdeaPhaseSchema.safeParse({ ...validInput, content: "" }).success).toBe(false);
  });

  it("rejects content over 10000 characters", () => {
    expect(CreateIdeaPhaseSchema.safeParse({ ...validInput, content: "a".repeat(10001) }).success).toBe(false);
  });

  it("accepts content at 10000 characters", () => {
    expect(CreateIdeaPhaseSchema.safeParse({ ...validInput, content: "a".repeat(10000) }).success).toBe(true);
  });
});

describe("IdeaPhaseSchema", () => {
  it("accepts valid full phase", () => {
    const result = IdeaPhaseSchema.safeParse({
      id: "770e8400-e29b-41d4-a716-446655440002",
      ideaId: "550e8400-e29b-41d4-a716-446655440000",
      sessionId: "660e8400-e29b-41d4-a716-446655440001",
      phaseNumber: 3,
      phaseName: "Architecture",
      content: "Design the system architecture.",
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing id", () => {
    const result = IdeaPhaseSchema.safeParse({
      ideaId: "550e8400-e29b-41d4-a716-446655440000",
      sessionId: "660e8400-e29b-41d4-a716-446655440001",
      phaseNumber: 3,
      phaseName: "Architecture",
      content: "Design the system architecture.",
      createdAt: new Date(),
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing createdAt", () => {
    const result = IdeaPhaseSchema.safeParse({
      id: "770e8400-e29b-41d4-a716-446655440002",
      ideaId: "550e8400-e29b-41d4-a716-446655440000",
      sessionId: "660e8400-e29b-41d4-a716-446655440001",
      phaseNumber: 3,
      phaseName: "Architecture",
      content: "Design the system architecture.",
    });
    expect(result.success).toBe(false);
  });
});
