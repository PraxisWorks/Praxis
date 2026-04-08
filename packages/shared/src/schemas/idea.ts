import { z } from "zod";

export const IdeaStatusSchema = z.enum([
  "new",
  "planning",
  "planned",
  "in_progress",
  "complete",
  "dismissed",
  "archived",
]);

export const IdeaSourceSchema = z.enum(["human", "ai"]);

export const IdeaSizeSchema = z.enum(["xs", "s", "m", "l", "xl"]);

export const ListIdeasInputSchema = z.object({
  repoId: z.string().uuid().nullable(),
  status: IdeaStatusSchema.optional(),
});

export const CreateIdeaSchema = z.object({
  repoId: z.string().uuid(),
  title: z.string().min(1, "Title is required").max(255),
  description: z.string().min(1, "Description is required").max(5000),
  source: IdeaSourceSchema.default("human"),
  tags: z.array(z.string().max(50)).max(20).default([]),
  size: IdeaSizeSchema.optional(),
});

export const IdeaSchema = CreateIdeaSchema.extend({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  status: IdeaStatusSchema.default("new"),
  order: z.number().int(),
  size: IdeaSizeSchema.nullable().default(null),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const UpdateIdeaSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().min(1).max(5000).optional(),
  status: IdeaStatusSchema.optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  size: IdeaSizeSchema.nullable().optional(),
});

export const ReorderIdeasSchema = z.array(
  z.object({
    id: z.string().uuid(),
    order: z.number().int().min(0),
  }),
);

export type IdeaStatus = z.infer<typeof IdeaStatusSchema>;
export type IdeaSource = z.infer<typeof IdeaSourceSchema>;
export type IdeaSize = z.infer<typeof IdeaSizeSchema>;
export type Idea = z.infer<typeof IdeaSchema>;
export type CreateIdea = z.infer<typeof CreateIdeaSchema>;
export type UpdateIdea = z.infer<typeof UpdateIdeaSchema>;
export type ListIdeasInput = z.infer<typeof ListIdeasInputSchema>;
export type ReorderIdeas = z.infer<typeof ReorderIdeasSchema>;
