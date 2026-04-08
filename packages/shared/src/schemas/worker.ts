import { z } from "zod";

export const WorkerStatusSchema = z.enum(["online", "offline"]);
export type WorkerStatus = z.infer<typeof WorkerStatusSchema>;

// Input schema for creating a new worker. Only user-provided fields.
export const CreateWorkerSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
});

// Full worker schema as returned from the API. Extends Create with server-managed fields.
export const WorkerSchema = CreateWorkerSchema.extend({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  status: WorkerStatusSchema.default("offline"),
  lastSeenAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Partial input for updating worker fields. Only name is updatable by the user.
export const UpdateWorkerSchema = CreateWorkerSchema.partial();

// Input schema for creating a worker token. Minimal — the server generates the token.
export const CreateWorkerTokenSchema = z.object({});

// Full worker token schema as returned from the API.
export const WorkerTokenSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  tokenHash: z.string(),
  expiresAt: z.date(),
  used: z.boolean().default(false),
  createdAt: z.date(),
});

// ── Repo Init Settings ─────────────────────────────────────────────

export const RepoInitModeSchema = z.enum(["ruflo", "custom"]);
export type RepoInitMode = z.infer<typeof RepoInitModeSchema>;

export const RepoInitSettingsSchema = z.object({
  mode: RepoInitModeSchema,
  scripts: z.array(z.string()).optional().default([]),
});
export type RepoInitSettings = z.infer<typeof RepoInitSettingsSchema>;

export type Worker = z.infer<typeof WorkerSchema>;
export type CreateWorker = z.infer<typeof CreateWorkerSchema>;
export type UpdateWorker = z.infer<typeof UpdateWorkerSchema>;
export type WorkerToken = z.infer<typeof WorkerTokenSchema>;
export type CreateWorkerToken = z.infer<typeof CreateWorkerTokenSchema>;
