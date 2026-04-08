import { z } from "zod";

export const CreateIdeaAttachmentSchema = z.object({
  ideaId: z.string().uuid(),
  filename: z.string().min(1, "Filename is required").max(255),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().nonnegative(),
  storageKey: z.string().min(1).max(1000),
});

export const IdeaAttachmentSchema = CreateIdeaAttachmentSchema.extend({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  createdAt: z.date(),
});

export type IdeaAttachment = z.infer<typeof IdeaAttachmentSchema>;
export type CreateIdeaAttachment = z.infer<typeof CreateIdeaAttachmentSchema>;
