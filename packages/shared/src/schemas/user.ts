import { z } from "zod";

export const RoleSchema = z.enum(["user", "admin"]);
export type Role = z.infer<typeof RoleSchema>;

export const ThemeSchema = z.enum(["light", "dark"]);
export type Theme = z.infer<typeof ThemeSchema>;

export const CreateUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email address"),
});

export const UserSchema = CreateUserSchema.extend({
  id: z.string().uuid(),
  role: RoleSchema.default("user"),
  avatarUrl: z.string().url().nullable().default(null),
  lastLoginAt: z.date().nullable().default(null),
  theme: ThemeSchema.default("light"),
  createdAt: z.date(),
});

export const UpdateUserRoleSchema = z.object({
  email: z.string().email(),
  role: RoleSchema,
});

export const UpdateThemeSchema = z.object({
  theme: ThemeSchema,
});
export type UpdateTheme = z.infer<typeof UpdateThemeSchema>;

export const GenerateApiKeySchema = z.object({});
export const RevokeApiKeySchema = z.object({});

export const GetUserStatsInputSchema = z.object({
  userId: z.string().uuid(),
});

export const UserStatsSchema = z.object({
  totalSessions: z.number(),
  sessionsByType: z.record(z.string(), z.number()),
  lastSessionAt: z.date().nullable(),
  lastLoginAt: z.date().nullable(),
  createdAt: z.date(),
});

export type User = z.infer<typeof UserSchema>;
export type CreateUser = z.infer<typeof CreateUserSchema>;
export type UpdateUserRole = z.infer<typeof UpdateUserRoleSchema>;
export type GenerateApiKey = z.infer<typeof GenerateApiKeySchema>;
export type RevokeApiKey = z.infer<typeof RevokeApiKeySchema>;
export type GetUserStatsInput = z.infer<typeof GetUserStatsInputSchema>;
export type UserStats = z.infer<typeof UserStatsSchema>;
