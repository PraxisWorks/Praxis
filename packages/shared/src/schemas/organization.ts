import { z } from "zod";

// Organization membership roles
export const OrgRoleSchema = z.enum(["owner", "admin", "member"]);
export type OrgRole = z.infer<typeof OrgRoleSchema>;

// Input schema for creating a new organization
export const CreateOrganizationSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  slug: z
    .string()
    .min(2, "Slug must be at least 2 characters")
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
});

// Full organization schema as returned from the API
export const OrganizationSchema = CreateOrganizationSchema.extend({
  id: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Partial input for updating organization fields
export const UpdateOrganizationSchema = CreateOrganizationSchema.partial();

// Organization membership schema
export const OrgMembershipSchema = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  role: OrgRoleSchema,
  createdAt: z.date(),
});

// Input for adding a member to an organization
export const AddOrgMemberSchema = z.object({
  orgId: z.string().uuid(),
  email: z.string().email("Invalid email address"),
  role: OrgRoleSchema.default("member"),
});

// Input for updating a member's role
export const UpdateOrgMemberRoleSchema = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  role: OrgRoleSchema,
});

// Input for removing a member
export const RemoveOrgMemberSchema = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
});

export type Organization = z.infer<typeof OrganizationSchema>;
export type CreateOrganization = z.infer<typeof CreateOrganizationSchema>;
export type UpdateOrganization = z.infer<typeof UpdateOrganizationSchema>;
export type OrgMembership = z.infer<typeof OrgMembershipSchema>;
export type AddOrgMember = z.infer<typeof AddOrgMemberSchema>;
export type UpdateOrgMemberRole = z.infer<typeof UpdateOrgMemberRoleSchema>;
export type RemoveOrgMember = z.infer<typeof RemoveOrgMemberSchema>;

// Worker policy for organizations
export const WorkerPolicySchema = z.enum([
  "user_default",
  "require_local",
  "central_worker",
]);
export type WorkerPolicy = z.infer<typeof WorkerPolicySchema>;

// Input for setting an org's worker policy
export const SetWorkerPolicySchema = z.object({
  orgId: z.string().uuid(),
  policy: WorkerPolicySchema,
  centralWorkerId: z.string().uuid().nullable().optional(),
});

// Input for setting a member's worker assignment
export const SetMemberWorkerSchema = z.object({
  orgId: z.string().uuid(),
  workerId: z.string().uuid().nullable(),
});

export type SetWorkerPolicy = z.infer<typeof SetWorkerPolicySchema>;
export type SetMemberWorker = z.infer<typeof SetMemberWorkerSchema>;

// AI instruction session types
export const AiInstructionsSessionTypeSchema = z.enum([
  "working",
  "spec",
  "architecture",
  "debug",
  "repo",
]);
export type AiInstructionsSessionType = z.infer<typeof AiInstructionsSessionTypeSchema>;

// Input schema for setting AI instructions for one session type
export const SetAiInstructionsSchema = z.object({
  orgId: z.string().uuid(),
  sessionType: AiInstructionsSessionTypeSchema,
  instructions: z.string().max(10000).nullable(),
});
export type SetAiInstructions = z.infer<typeof SetAiInstructionsSchema>;

// Response schema with all 5 instruction fields
export const AiInstructionsSchema = z.object({
  aiInstructionsWorking: z.string().nullable(),
  aiInstructionsSpec: z.string().nullable(),
  aiInstructionsArchitecture: z.string().nullable(),
  aiInstructionsDebug: z.string().nullable(),
  aiInstructionsRepo: z.string().nullable(),
});
export type AiInstructions = z.infer<typeof AiInstructionsSchema>;

// System instruction session types (reuse same enum values)
export const SystemInstructionsSessionTypeSchema = z.enum([
  "working",
  "spec",
  "architecture",
  "debug",
  "repo",
]);
export type SystemInstructionsSessionType = z.infer<typeof SystemInstructionsSessionTypeSchema>;

// Input schema for setting system instructions for one session type
export const SetSystemInstructionsSchema = z.object({
  orgId: z.string().uuid(),
  sessionType: SystemInstructionsSessionTypeSchema,
  instructions: z.string().max(50000).nullable(),
});
export type SetSystemInstructions = z.infer<typeof SetSystemInstructionsSchema>;

// Response schema with all 5 system instruction fields
export const SystemInstructionsResponseSchema = z.object({
  systemInstructionsWorking: z.string().nullable(),
  systemInstructionsSpec: z.string().nullable(),
  systemInstructionsArchitecture: z.string().nullable(),
  systemInstructionsDebug: z.string().nullable(),
  systemInstructionsRepo: z.string().nullable(),
});
export type SystemInstructionsResponse = z.infer<typeof SystemInstructionsResponseSchema>;

// ── Rig Template Configuration ────────────────────────────────────

const ownerRepoRegex = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

const safeRelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (p) => p.startsWith("./scripts/") && !p.includes(".."),
    "Must be a relative path starting with ./scripts/ and contain no '..' segments",
  );

export const OrgRigTemplateSchema = z.object({
  templateRepo: z
    .string()
    .regex(ownerRepoRegex, "Must be in owner/repo format (e.g. acme/template-repo)")
    .optional(),
  initScripts: z
    .array(safeRelativePathSchema)
    .optional(),
});
export type OrgRigTemplate = z.infer<typeof OrgRigTemplateSchema>;

export const SetOrgRigTemplateSchema = z.object({
  orgId: z.string().uuid(),
  templateRepo: z
    .string()
    .regex(ownerRepoRegex, "Must be in owner/repo format (e.g. acme/template-repo)")
    .nullable(),
  initScripts: z
    .array(safeRelativePathSchema)
    .nullable(),
});
export type SetOrgRigTemplate = z.infer<typeof SetOrgRigTemplateSchema>;
