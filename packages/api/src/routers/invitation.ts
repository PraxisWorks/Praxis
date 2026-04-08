import { eq, and, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  OrgInvitationListInputSchema,
  RevokeOrgInvitationSchema,
  ResendOrgInvitationSchema,
} from "@praxis2/shared";
import { router, protectedProcedure } from "../trpc.js";
import { orgInvitations, users } from "../db/schema.js";
import { requireDbUser } from "../lib/requireDbUser.js";
import { requireOrgMember } from "../lib/requireOrgMember.js";
import { enqueueJob } from "../jobs/index.js";
import { PROCESS_ORG_INVITATION } from "../jobs/handlers/processOrgInvitation.js";

export const invitationRouter = router({
  list: protectedProcedure
    .input(OrgInvitationListInputSchema)
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      await requireOrgMember(ctx.db, input.orgId, userId, "admin");

      return ctx.db
        .select({
          id: orgInvitations.id,
          orgId: orgInvitations.orgId,
          email: orgInvitations.email,
          role: orgInvitations.role,
          status: orgInvitations.status,
          expiresAt: orgInvitations.expiresAt,
          createdAt: orgInvitations.createdAt,
          inviterName: users.name,
        })
        .from(orgInvitations)
        .innerJoin(users, eq(orgInvitations.invitedBy, users.id))
        .where(
          and(
            eq(orgInvitations.orgId, input.orgId),
            eq(orgInvitations.status, "pending"),
          ),
        );
    }),

  revoke: protectedProcedure
    .input(RevokeOrgInvitationSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const [invitation] = await ctx.db
        .select()
        .from(orgInvitations)
        .where(
          and(
            eq(orgInvitations.id, input.id),
            eq(orgInvitations.status, "pending"),
          ),
        )
        .limit(1);

      if (!invitation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pending invitation not found",
        });
      }

      await requireOrgMember(ctx.db, invitation.orgId, userId, "admin");

      await ctx.db
        .update(orgInvitations)
        .set({ status: "revoked" })
        .where(eq(orgInvitations.id, input.id));

      return { success: true };
    }),

  resend: protectedProcedure
    .input(ResendOrgInvitationSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const [invitation] = await ctx.db
        .select()
        .from(orgInvitations)
        .where(
          and(
            eq(orgInvitations.id, input.id),
            eq(orgInvitations.status, "pending"),
          ),
        )
        .limit(1);

      if (!invitation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pending invitation not found",
        });
      }

      await requireOrgMember(ctx.db, invitation.orgId, userId, "admin");

      await ctx.db
        .update(orgInvitations)
        .set({ expiresAt: sql`now() + interval '7 days'` })
        .where(eq(orgInvitations.id, input.id));

      await enqueueJob(
        PROCESS_ORG_INVITATION,
        { invitationId: invitation.id },
        { retryLimit: 3, retryDelay: 60 },
      );

      return { success: true };
    }),
});
