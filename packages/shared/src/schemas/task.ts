import { z } from "zod";

export const TaskStatusSchema = z.enum(["draft", "approved", "in_progress", "blocked", "complete", "archived"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskPrioritySchema = z.enum(["low", "medium", "high"]);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const CreateTaskSchema = z.object({
  repoId: z.string().uuid(),
  parentId: z.string().uuid().nullable().optional(),
  ideaId: z.string().uuid().nullable().optional(),
  title: z.string().min(1, "Title is required").max(500),
  description: z.string().min(1, "Description is required").max(10000),
  notes: z.string().max(10000).nullable().optional(),
  priority: TaskPrioritySchema,
  isEpic: z.boolean().default(false),
});

export const TaskSchema = CreateTaskSchema.extend({
  id: z.string().uuid(),
  status: TaskStatusSchema.default("draft"),
  taskId: z.string().max(50).nullable(),
  statusChangedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const UpdateTaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().min(1).max(10000).optional(),
  notes: z.string().max(10000).nullable().optional(),
  priority: TaskPrioritySchema.optional(),
  status: TaskStatusSchema.optional(),
  isEpic: z.boolean().optional(),
  parentId: z.string().uuid().nullable().optional(),
});

export const TaskDependencySchema = z.object({
  taskId: z.string().uuid(),
  dependsOnId: z.string().uuid(),
});

export const TaskListInputSchema = z.object({
  repoId: z.string().uuid().nullable(),
  status: TaskStatusSchema.optional(),
  parentId: z.string().uuid().nullable().optional(),
  isEpic: z.boolean().optional(),
  ideaId: z.string().uuid().optional(),
});

export type Task = z.infer<typeof TaskSchema>;
export type CreateTask = z.infer<typeof CreateTaskSchema>;
export type UpdateTask = z.infer<typeof UpdateTaskSchema>;
export type TaskDependency = z.infer<typeof TaskDependencySchema>;
export type TaskListInput = z.infer<typeof TaskListInputSchema>;
