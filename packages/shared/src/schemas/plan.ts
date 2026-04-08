import { z } from "zod";

// --- Status ---
export const PlanStatusSchema = z.enum(["draft", "accepted", "rejected"]);

// --- Proposal structure (the output of an architecture session) ---

export const ProposalTaskSchema = z.object({
  /** Temporary client-side key for dependency references within the proposal */
  key: z.string().min(1),
  title: z.string().min(1).max(255),
  description: z.string().min(1).max(4000),
  priority: z.enum(["low", "medium", "high"]),
  /** Array of `key` values from other tasks in the same epic or across epics */
  dependsOn: z.array(z.string()).default([]),
});

export const ProposalEpicSchema = z.object({
  /** Temporary client-side key for reference */
  key: z.string().min(1),
  title: z.string().min(1).max(255),
  description: z.string().min(1).max(4000),
  tasks: z.array(ProposalTaskSchema).min(1),
});

export const ProposalSchema = z.object({
  epics: z.array(ProposalEpicSchema).min(1),
});

// --- Plan (wraps a proposal with metadata) ---

export const CreatePlanSchema = z.object({
  ideaId: z.string().uuid(),
  repoId: z.string().uuid(),
  sessionId: z.string().uuid(),
  proposal: ProposalSchema,
});

export const PlanSchema = CreatePlanSchema.extend({
  id: z.string().uuid(),
  status: PlanStatusSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const UpdatePlanProposalSchema = z.object({
  id: z.string().uuid(),
  proposal: ProposalSchema,
});

// --- Types ---
export type PlanStatus = z.infer<typeof PlanStatusSchema>;
export type ProposalTask = z.infer<typeof ProposalTaskSchema>;
export type ProposalEpic = z.infer<typeof ProposalEpicSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
export type CreatePlan = z.infer<typeof CreatePlanSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type UpdatePlanProposal = z.infer<typeof UpdatePlanProposalSchema>;
