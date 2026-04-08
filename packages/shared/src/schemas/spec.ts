import { z } from "zod";

export const CreateSpecSchema = z.object({
  repoId: z.string().uuid(),
  title: z.string().min(1, "Title is required").max(255),
  content: z.string().min(1, "Content is required"),
});

export const SpecSchema = CreateSpecSchema.extend({
  id: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// For upsert — repoId is immutable, everything else is optional
export const UpdateSpecSchema = CreateSpecSchema.partial().omit({ repoId: true });

export type Spec = z.infer<typeof SpecSchema>;
export type CreateSpec = z.infer<typeof CreateSpecSchema>;
export type UpdateSpec = z.infer<typeof UpdateSpecSchema>;
