import { describe, it, expect } from "vitest";
import {
  MessageRoleSchema,
  CreateSessionMessageSchema,
  SessionMessageSchema,
  QuestionOptionSchema,
  StructuredQuestionItemSchema,
  StructuredQuestionMetadataSchema,
} from "./sessionMessage.js";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("MessageRoleSchema", () => {
  it("accepts all valid roles", () => {
    for (const role of ["user", "assistant", "system"]) {
      expect(MessageRoleSchema.safeParse(role).success).toBe(true);
    }
  });

  it("rejects invalid role", () => {
    expect(MessageRoleSchema.safeParse("bot").success).toBe(false);
  });
});

describe("CreateSessionMessageSchema", () => {
  it("accepts valid input", () => {
    const result = CreateSessionMessageSchema.safeParse({
      sessionId: VALID_UUID,
      role: "user",
      content: "Hello, how should we structure this?",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing sessionId", () => {
    const result = CreateSessionMessageSchema.safeParse({
      role: "user",
      content: "Hello",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid sessionId", () => {
    const result = CreateSessionMessageSchema.safeParse({
      sessionId: "not-a-uuid",
      role: "user",
      content: "Hello",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid role", () => {
    const result = CreateSessionMessageSchema.safeParse({
      sessionId: VALID_UUID,
      role: "bot",
      content: "Hello",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty content", () => {
    const result = CreateSessionMessageSchema.safeParse({
      sessionId: VALID_UUID,
      role: "user",
      content: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("SessionMessageSchema", () => {
  it("accepts valid message with all fields", () => {
    const result = SessionMessageSchema.safeParse({
      id: VALID_UUID,
      sessionId: "660e8400-e29b-41d4-a716-446655440000",
      role: "assistant",
      content: "Let me help you structure that.",
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid uuid for id", () => {
    const result = SessionMessageSchema.safeParse({
      id: "not-a-uuid",
      sessionId: VALID_UUID,
      role: "user",
      content: "Hello",
      createdAt: new Date(),
    });
    expect(result.success).toBe(false);
  });
});

describe("QuestionOptionSchema", () => {
  it("accepts valid option with label and description", () => {
    const result = QuestionOptionSchema.safeParse({
      label: "Option A",
      description: "First option",
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      label: "Option A",
      description: "First option",
    });
  });

  it("rejects missing label", () => {
    const result = QuestionOptionSchema.safeParse({
      description: "First option",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing description", () => {
    const result = QuestionOptionSchema.safeParse({
      label: "Option A",
    });
    expect(result.success).toBe(false);
  });
});

describe("StructuredQuestionItemSchema", () => {
  const validOption = { label: "Option A", description: "First option" };
  const validOption2 = { label: "Option B", description: "Second option" };

  it("accepts valid item with all fields", () => {
    const result = StructuredQuestionItemSchema.safeParse({
      question: "How do you want to proceed?",
      header: "Next step",
      options: [validOption, validOption2],
      multiSelect: true,
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      question: "How do you want to proceed?",
      header: "Next step",
      options: [validOption, validOption2],
      multiSelect: true,
    });
  });

  it("defaults multiSelect to false when omitted", () => {
    const result = StructuredQuestionItemSchema.safeParse({
      question: "Pick one",
      header: "Choice",
      options: [validOption, validOption2],
    });
    expect(result.success).toBe(true);
    expect(result.data?.multiSelect).toBe(false);
  });

  it("rejects header longer than 12 characters", () => {
    const result = StructuredQuestionItemSchema.safeParse({
      question: "Pick one",
      header: "This header is way too long",
      options: [validOption, validOption2],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty options array", () => {
    const result = StructuredQuestionItemSchema.safeParse({
      question: "Pick one",
      header: "Choice",
      options: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects options array with only one item", () => {
    const result = StructuredQuestionItemSchema.safeParse({
      question: "Pick one",
      header: "Choice",
      options: [validOption],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing question field", () => {
    const result = StructuredQuestionItemSchema.safeParse({
      header: "Choice",
      options: [validOption, validOption2],
    });
    expect(result.success).toBe(false);
  });
});

describe("StructuredQuestionMetadataSchema", () => {
  const validQuestion = {
    question: "How do you want to proceed?",
    header: "Next step",
    options: [
      { label: "Option A", description: "First option" },
      { label: "Option B", description: "Second option" },
    ],
  };

  it("accepts valid metadata with all fields", () => {
    const result = StructuredQuestionMetadataSchema.safeParse({
      type: "structured_question",
      questions: [validQuestion],
      answered: true,
      answeredAt: "2026-03-20T12:00:00Z",
      selectedOptions: ["Option A"],
    });
    expect(result.success).toBe(true);
    expect(result.data?.answered).toBe(true);
    expect(result.data?.answeredAt).toBe("2026-03-20T12:00:00Z");
    expect(result.data?.selectedOptions).toEqual(["Option A"]);
  });

  it("defaults answered to false when omitted", () => {
    const result = StructuredQuestionMetadataSchema.safeParse({
      type: "structured_question",
      questions: [validQuestion],
    });
    expect(result.success).toBe(true);
    expect(result.data?.answered).toBe(false);
  });

  it("parses correctly when answeredAt is omitted", () => {
    const result = StructuredQuestionMetadataSchema.safeParse({
      type: "structured_question",
      questions: [validQuestion],
    });
    expect(result.success).toBe(true);
    expect(result.data?.answeredAt).toBeUndefined();
  });

  it("parses correctly when answeredAt is provided as ISO datetime", () => {
    const result = StructuredQuestionMetadataSchema.safeParse({
      type: "structured_question",
      questions: [validQuestion],
      answeredAt: "2026-03-20T15:30:00Z",
    });
    expect(result.success).toBe(true);
    expect(result.data?.answeredAt).toBe("2026-03-20T15:30:00Z");
  });

  it("parses correctly when selectedOptions is omitted", () => {
    const result = StructuredQuestionMetadataSchema.safeParse({
      type: "structured_question",
      questions: [validQuestion],
    });
    expect(result.success).toBe(true);
    expect(result.data?.selectedOptions).toBeUndefined();
  });

  it("parses correctly when selectedOptions is provided", () => {
    const result = StructuredQuestionMetadataSchema.safeParse({
      type: "structured_question",
      questions: [validQuestion],
      selectedOptions: ["Option A", "Option B"],
    });
    expect(result.success).toBe(true);
    expect(result.data?.selectedOptions).toEqual(["Option A", "Option B"]);
  });

  it("rejects invalid type", () => {
    const result = StructuredQuestionMetadataSchema.safeParse({
      type: "free_text",
      questions: [validQuestion],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing questions array", () => {
    const result = StructuredQuestionMetadataSchema.safeParse({
      type: "structured_question",
    });
    expect(result.success).toBe(false);
  });

  it("strips extra unknown fields", () => {
    const result = StructuredQuestionMetadataSchema.safeParse({
      type: "structured_question",
      questions: [validQuestion],
      extraField: "should be stripped",
    });
    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>)["extraField"]).toBeUndefined();
  });
});

describe("SessionMessageSchema with metadata", () => {
  const validMetadata = {
    type: "structured_question" as const,
    questions: [
      {
        question: "How do you want to proceed?",
        header: "Next step",
        options: [
          { label: "Option A", description: "First option" },
          { label: "Option B", description: "Second option" },
        ],
      },
    ],
  };

  const baseMessage = {
    id: VALID_UUID,
    sessionId: "660e8400-e29b-41d4-a716-446655440000",
    role: "assistant" as const,
    content: "Here are your options.",
    createdAt: new Date(),
  };

  it("accepts message with valid structured question metadata", () => {
    const result = SessionMessageSchema.safeParse({
      ...baseMessage,
      metadata: validMetadata,
    });
    expect(result.success).toBe(true);
    expect(result.data?.metadata?.type).toBe("structured_question");
  });

  it("accepts message with null metadata", () => {
    const result = SessionMessageSchema.safeParse({
      ...baseMessage,
      metadata: null,
    });
    expect(result.success).toBe(true);
    expect(result.data?.metadata).toBeNull();
  });

  it("accepts message without metadata (omitted)", () => {
    const result = SessionMessageSchema.safeParse(baseMessage);
    expect(result.success).toBe(true);
    expect(result.data?.metadata).toBeUndefined();
  });

  it("rejects message with invalid metadata type", () => {
    const result = SessionMessageSchema.safeParse({
      ...baseMessage,
      metadata: {
        type: "invalid_type",
        questions: validMetadata.questions,
      },
    });
    expect(result.success).toBe(false);
  });
});
