import { z } from "zod";

export const MessageRoleSchema = z.enum(["user", "assistant", "system"]);

export const CreateSessionMessageSchema = z.object({
  sessionId: z.string().uuid(),
  role: MessageRoleSchema,
  content: z.string().min(1, "Content is required"),
});

export const QuestionOptionSchema = z.object({
  label: z.string(),
  description: z.string(),
});

export const StructuredQuestionItemSchema = z.object({
  question: z.string(),
  header: z.string().max(12),
  options: z.array(QuestionOptionSchema).min(2),
  multiSelect: z.boolean().default(false),
});

export const StructuredQuestionMetadataSchema = z.object({
  type: z.literal("structured_question"),
  questions: z.array(StructuredQuestionItemSchema),
  answered: z.boolean().default(false),
  answeredAt: z.string().datetime().optional(),
  selectedOptions: z.array(z.string()).optional(),
});

export const SessionMessageSchema = CreateSessionMessageSchema.extend({
  id: z.string().uuid(),
  createdAt: z.date(),
  metadata: StructuredQuestionMetadataSchema.nullable().optional(),
});

export type MessageRole = z.infer<typeof MessageRoleSchema>;
export type SessionMessage = z.infer<typeof SessionMessageSchema>;
export type CreateSessionMessage = z.infer<typeof CreateSessionMessageSchema>;
export type QuestionOption = z.infer<typeof QuestionOptionSchema>;
export type StructuredQuestionItem = z.infer<typeof StructuredQuestionItemSchema>;
export type StructuredQuestionMetadata = z.infer<typeof StructuredQuestionMetadataSchema>;
