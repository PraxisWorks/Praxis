import { z } from "zod";

export const CreateIdeaPhaseSchema = z.object({
  ideaId: z.string().uuid(),
  sessionId: z.string().uuid(),
  phaseNumber: z.number().int().min(1).max(8),
  phaseName: z.string().min(1).max(100),
  content: z.string().min(1).max(10000),
});

export const IdeaPhaseSchema = CreateIdeaPhaseSchema.extend({
  id: z.string().uuid(),
  createdAt: z.date(),
});

export type IdeaPhase = z.infer<typeof IdeaPhaseSchema>;
export type CreateIdeaPhase = z.infer<typeof CreateIdeaPhaseSchema>;
