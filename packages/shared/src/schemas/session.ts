import { z } from "zod";

export const SessionTypeSchema = z.enum([
  "spec",
  "architecture",
  "working",
  "debug",
  "repo",
]);

export const SessionStatusSchema = z.enum([
  "active",
  "paused",
  "completed",
  "error",
  "scheduled",
]);

export const SessionEntityTypeSchema = z.enum([
  "repo",
  "idea",
  "epic",
  "task",
]);

export const CreateSessionSchema = z.object({
  repoId: z.string().uuid(),
  type: SessionTypeSchema,
  entityType: SessionEntityTypeSchema.optional(),
  entityId: z.string().uuid().optional(),
  title: z.string().min(1, "Title is required").max(255),
  prompt: z.string().optional(),
  scheduledFor: z.coerce.date().nullable().optional(),
});

export const SessionSchema = CreateSessionSchema.extend({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  status: SessionStatusSchema.default("active"),
  prompt: z.string().nullable().default(null),
  metadata: z.record(z.unknown()).nullable().default(null),
  scheduledFor: z.coerce.date().nullable().default(null),
  jobId: z.string().nullable().default(null),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const UpdateSessionStatusSchema = z.object({
  id: z.string().uuid(),
  status: SessionStatusSchema,
});

export const RenameSessionSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1, "Title is required").max(255),
});

export const RemakeSessionSchema = z.object({
  id: z.string().uuid(),
});

export type SessionType = z.infer<typeof SessionTypeSchema>;
export type SessionStatus = z.infer<typeof SessionStatusSchema>;
export type SessionEntityType = z.infer<typeof SessionEntityTypeSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type CreateSession = z.infer<typeof CreateSessionSchema>;
export type UpdateSessionStatus = z.infer<typeof UpdateSessionStatusSchema>;
export type RenameSession = z.infer<typeof RenameSessionSchema>;
export type RemakeSession = z.infer<typeof RemakeSessionSchema>;

export const StartDebugSessionSchema = z.object({
  repoId: z.string().uuid(),
  entityType: z.enum(["task", "epic"]),
  entityId: z.string().uuid(),
  scheduledFor: z.string().datetime().optional(),
});
export type StartDebugSession = z.infer<typeof StartDebugSessionSchema>;

export const StartWorkSessionSchema = z.object({
  repoId: z.string().uuid(),
  entityType: z.enum(["task", "epic"]),
  entityId: z.string().uuid(),
  scheduledFor: z.string().datetime().optional(),
});
export type StartWorkSession = z.infer<typeof StartWorkSessionSchema>;

export const StartRepoSessionSchema = z.object({
  repoId: z.string().uuid(),
});
export type StartRepoSession = z.infer<typeof StartRepoSessionSchema>;

export const SessionListInputSchema = z.object({
  typeFilter: z.array(z.enum(["spec", "architecture", "working", "debug", "repo"])).max(5).optional(),
  statusFilter: z.array(z.enum(["active", "paused", "completed", "error", "scheduled"])).max(5).optional(),
  orgIds: z.array(z.string().uuid()).max(50).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type SessionListInput = z.infer<typeof SessionListInputSchema>;

export const PauseResumeSessionSchema = z.object({
  sessionId: z.string().uuid(),
  message: z.string().max(2000).optional(),
});
export type PauseResumeSession = z.infer<typeof PauseResumeSessionSchema>;

export const ListOpenQuestionsInputSchema = z.object({
  repoId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  olderThanMinutes: z.number().int().positive().optional(),
});
export type ListOpenQuestionsInput = z.infer<typeof ListOpenQuestionsInputSchema>;
