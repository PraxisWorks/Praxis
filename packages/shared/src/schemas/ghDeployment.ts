import { z } from "zod";

export const GhWebhookConfigSchema = z.object({
  id: z.string().uuid(),
  repoId: z.string().uuid(),
  githubWebhookId: z.number().int(),
  webhookSecret: z.string(),
  repoOwner: z.string(),
  repoName: z.string(),
  lastEtag: z.string().nullable(),
  createdAt: z.date(),
});

export type GhWebhookConfig = z.infer<typeof GhWebhookConfigSchema>;

export const GhDeploymentSchema = z.object({
  id: z.string().uuid(),
  repoId: z.string().uuid(),
  githubDeploymentId: z.string(),
  environment: z.string(),
  status: z.string(),
  ref: z.string(),
  description: z.string().nullable(),
  url: z.string().nullable(),
  creatorLogin: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type GhDeployment = z.infer<typeof GhDeploymentSchema>;

export const GhDeploymentListInputSchema = z.object({
  repoId: z.string().uuid().optional(),
});

export type GhDeploymentListInput = z.infer<typeof GhDeploymentListInputSchema>;
