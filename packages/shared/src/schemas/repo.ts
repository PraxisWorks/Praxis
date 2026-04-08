import { z } from "zod";

// Repo lifecycle status. "creating" = scaffolding in progress (future pg-boss job),
// "active" = ready for use, "archived" = soft-deleted / hidden from default views,
// "error" = scaffolding or other process failed.
export const RepoStatusSchema = z.enum(["creating", "active", "archived", "error"]);
export type RepoStatus = z.infer<typeof RepoStatusSchema>;

// Input schema for creating a new repo. Used by both the App Creator modal
// (new project from scratch) and the Add Repo modal (existing repo).
export const CreateRepoSchema = z.object({
  // Organization this repo belongs to.
  orgId: z.string().uuid(),
  // Display name. Freeform but required.
  name: z.string().min(1, "Name is required").max(100),
  // GitHub repo URL or identifier. Optional for locally-created repos.
  repo: z.string().max(500).nullable().optional(),
  // Task prefix: 2-4 uppercase letters used to namespace task IDs (e.g., "PX" -> PX-001).
  bdPrefix: z
    .string()
    .min(2, "Prefix must be 2-4 characters")
    .max(4, "Prefix must be 2-4 characters")
    .regex(/^[A-Z]+$/, "Prefix must be uppercase letters only"),
  // UI accent color stored as a hex string (e.g., "#6366f1").
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a valid hex color"),
  // Optional icon name from the Lucide icon set (e.g., "rocket", "code", "star").
  icon: z.string().max(50).regex(/^[a-z0-9-]+$/, "Icon must be a lowercase hyphenated name").nullable().optional(),
  // Optional freeform description.
  description: z.string().max(1000).nullable().optional(),
});

// Full repo schema as returned from the API. Extends Create with server-managed fields.
export const RepoSchema = CreateRepoSchema.extend({
  id: z.string().uuid(),
  // The user who created this repo.
  userId: z.string().uuid(),
  // Absolute filesystem path where the repo's working tree lives (set by scaffolding job).
  workspacePath: z.string().max(1000).nullable().default(null),
  status: RepoStatusSchema.default("active"),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Partial input for updating repo fields. All fields optional.
// bdPrefix is omitted because it is immutable after creation.
export const UpdateRepoSchema = CreateRepoSchema.omit({ orgId: true, bdPrefix: true }).partial();

// Input schema for moving a repo to a different organization.
export const MoveRepoSchema = z.object({
  repoId: z.string().uuid(),
  targetOrgId: z.string().uuid(),
});

export type Repo = z.infer<typeof RepoSchema>;
export type CreateRepo = z.infer<typeof CreateRepoSchema>;
export type UpdateRepo = z.infer<typeof UpdateRepoSchema>;
export type MoveRepo = z.infer<typeof MoveRepoSchema>;
