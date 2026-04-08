import { z } from "zod";

import { OrgRoleSchema } from "./organization.js";

// Invitation lifecycle statuses
export const InvitationStatusSchema = z.enum([
  "pending",
  "accepted",
  "revoked",
  "expired",
]);

// Input schema for creating an organization invitation
export const CreateOrgInvitationSchema = z.object({
  orgId: z.string().uuid(),
  email: z.string().email("Invalid email address").transform((v) => v.toLowerCase()),
  role: OrgRoleSchema,
});

// Full organization invitation as returned from the API
export const OrgInvitationSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  email: z.string().email(),
  role: OrgRoleSchema,
  invitedBy: z.string().uuid(),
  status: InvitationStatusSchema,
  expiresAt: z.date(),
  createdAt: z.date(),
});

// Input for listing invitations for an organization
export const OrgInvitationListInputSchema = z.object({
  orgId: z.string().uuid(),
});

// Input for revoking an invitation
export const RevokeOrgInvitationSchema = z.object({
  id: z.string().uuid(),
});

// Input for resending an invitation
export const ResendOrgInvitationSchema = z.object({
  id: z.string().uuid(),
});

export type InvitationStatus = z.infer<typeof InvitationStatusSchema>;
export type CreateOrgInvitation = z.output<typeof CreateOrgInvitationSchema>;
export type OrgInvitation = z.infer<typeof OrgInvitationSchema>;
export type OrgInvitationListInput = z.infer<typeof OrgInvitationListInputSchema>;
export type RevokeOrgInvitation = z.infer<typeof RevokeOrgInvitationSchema>;
export type ResendOrgInvitation = z.infer<typeof ResendOrgInvitationSchema>;
