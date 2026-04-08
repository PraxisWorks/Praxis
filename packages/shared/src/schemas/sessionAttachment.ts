import { z } from "zod";

export const CreateSessionAttachmentSchema = z.object({
  sessionId: z.string().uuid(),
  filename: z.string().min(1, "Filename is required").max(255),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().nonnegative(),
  storageKey: z.string().min(1).max(1000),
});

export const SessionAttachmentSchema = CreateSessionAttachmentSchema.extend({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  messageId: z.string().uuid().nullable().default(null),
  createdAt: z.date(),
});

export type SessionAttachment = z.infer<typeof SessionAttachmentSchema>;
export type CreateSessionAttachment = z.infer<typeof CreateSessionAttachmentSchema>;
