import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { tracked, TRPCError } from "@trpc/server";
import {
  CreateOrganizationSchema,
  UpdateOrganizationSchema,
  AddOrgMemberSchema,
  UpdateOrgMemberRoleSchema,
  RemoveOrgMemberSchema,
  SetWorkerPolicySchema,
  SetMemberWorkerSchema,
  SetAiInstructionsSchema,
  SetSystemInstructionsSchema,
  SetOrgRigTemplateSchema,
  loadSkillDefaults,
  syncChannel,
  type SyncEvent,
  type Organization,
} from "@praxis2/shared";
import { router, protectedProcedure } from "../trpc.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { organizations, orgMembers, orgMemberWorkers, orgInvitations, users, workers } from "../db/schema.js";
import { iterateEvents } from "../lib/iterateEvents.js";
import { requireDbUser } from "../lib/requireDbUser.js";
import { requireOrgMember } from "../lib/requireOrgMember.js";
import { sendNotification } from "../services/notifications/index.js";
import { enqueueJob } from "../jobs/index.js";
import { PROCESS_ORG_INVITATION } from "../jobs/handlers/processOrgInvitation.js";
import { checkLimitFromRole } from "../lib/checkLimit.js";

let eventId = 0;

export const organizationRouter = router({
  // List organizations the current user belongs to
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = requireDbUser(ctx);

    const memberships = await ctx.db
      .select({
        orgId: orgMembers.orgId,
        role: orgMembers.role,
        orgName: organizations.name,
        orgSlug: organizations.slug,
        orgCreatedAt: organizations.createdAt,
        orgUpdatedAt: organizations.updatedAt,
      })
      .from(orgMembers)
      .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
      .where(eq(orgMembers.userId, userId));

    return memberships.map((m) => ({
      id: m.orgId,
      name: m.orgName,
      slug: m.orgSlug,
      role: m.role,
      createdAt: m.orgCreatedAt,
      updatedAt: m.orgUpdatedAt,
    }));
  }),

  // Get a single organization by ID (must be a member)
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      await requireOrgMember(ctx.db, input.id, userId);

      const [org] = await ctx.db
        .select()
        .from(organizations)
        .where(eq(organizations.id, input.id))
        .limit(1);

      if (!org) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      return org;
    }),

  // Create a new organization. The creator becomes the owner.
  create: requirePermission("org:create")
    .input(CreateOrganizationSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Enforce org membership limit
      await checkLimitFromRole(ctx.db, ctx.dbUser!, "org_memberships");

      // Check slug uniqueness
      const [existing] = await ctx.db
        .select()
        .from(organizations)
        .where(eq(organizations.slug, input.slug))
        .limit(1);

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An organization with this slug already exists",
        });
      }

      const [org] = await ctx.db
        .insert(organizations)
        .values({
          name: input.name,
          slug: input.slug,
        })
        .returning();

      // Add creator as owner
      await ctx.db.insert(orgMembers).values({
        orgId: org.id,
        userId,
        role: "owner",
      });

      await ctx.pubsub.publish(syncChannel("organization"), {
        action: "created",
        data: org,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof org>);

      return org;
    }),

  // Update organization details (admin+ only)
  update: requirePermission("org:update")
    .input(
      z.object({
        id: z.string().uuid(),
        data: UpdateOrganizationSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      await requireOrgMember(ctx.db, input.id, userId, "admin");

      if (input.data.slug) {
        const [existing] = await ctx.db
          .select()
          .from(organizations)
          .where(and(eq(organizations.slug, input.data.slug)))
          .limit(1);

        if (existing && existing.id !== input.id) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "An organization with this slug already exists",
          });
        }
      }

      const [updated] = await ctx.db
        .update(organizations)
        .set({ ...input.data, updatedAt: new Date() })
        .where(eq(organizations.id, input.id))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      await ctx.pubsub.publish(syncChannel("organization"), {
        action: "updated",
        data: updated,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof updated>);

      return updated;
    }),

  // Delete an organization (owner only)
  delete: requirePermission("org:delete")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      await requireOrgMember(ctx.db, input.id, userId, "owner");

      const [org] = await ctx.db
        .select()
        .from(organizations)
        .where(eq(organizations.id, input.id))
        .limit(1);

      if (!org) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      await ctx.db
        .delete(organizations)
        .where(eq(organizations.id, input.id));

      await ctx.pubsub.publish(syncChannel("organization"), {
        action: "deleted",
        data: org,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof org>);

      return { success: true };
    }),

  // List members of an organization
  listMembers: protectedProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      await requireOrgMember(ctx.db, input.orgId, userId);

      const members = await ctx.db
        .select({
          userId: orgMembers.userId,
          role: orgMembers.role,
          createdAt: orgMembers.createdAt,
          userName: users.name,
          userEmail: users.email,
          userAvatarUrl: users.avatarUrl,
        })
        .from(orgMembers)
        .innerJoin(users, eq(orgMembers.userId, users.id))
        .where(eq(orgMembers.orgId, input.orgId));

      return members;
    }),

  // Add a member by email (admin+ only)
  addMember: requirePermission("org:member:invite")
    .input(AddOrgMemberSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      await requireOrgMember(ctx.db, input.orgId, userId, "admin");

      // Look up org name (for notifications)
      const [org] = await ctx.db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, input.orgId))
        .limit(1);

      // Find user by email
      const [targetUser] = await ctx.db
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      if (targetUser) {
        // USER EXISTS PATH
        // Check if already a member
        const [existing] = await ctx.db
          .select()
          .from(orgMembers)
          .where(and(eq(orgMembers.orgId, input.orgId), eq(orgMembers.userId, targetUser.id)))
          .limit(1);

        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "User is already a member of this organization",
          });
        }

        await ctx.db.insert(orgMembers).values({
          orgId: input.orgId,
          userId: targetUser.id,
          role: input.role ?? "member",
        });

        // Send notification
        await sendNotification(ctx.db, ctx.pubsub, { userId: targetUser.id }, {
          title: `Added to ${org?.name ?? "organization"}`,
          body: `You have been added to ${org?.name ?? "an organization"}.`,
          actionUrl: `/orgs/${input.orgId}`,
        });

        await ctx.pubsub.publish(syncChannel("organization"), {
          action: "updated",
          data: { orgId: input.orgId, memberAdded: targetUser.id },
          timestamp: Date.now(),
        } satisfies SyncEvent<unknown>);

        return { success: true, userId: targetUser.id, status: "joined" as const };
      } else {
        // USER DOESN'T EXIST — INVITATION PATH
        // Check for existing pending invitation
        const [existingInvitation] = await ctx.db
          .select()
          .from(orgInvitations)
          .where(and(
            eq(orgInvitations.orgId, input.orgId),
            eq(sql`lower(${orgInvitations.email})`, input.email.toLowerCase()),
            eq(orgInvitations.status, "pending"),
          ))
          .limit(1);

        if (existingInvitation) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A pending invitation already exists for this email",
          });
        }

        const [invitation] = await ctx.db.insert(orgInvitations).values({
          orgId: input.orgId,
          email: input.email.toLowerCase(),
          role: input.role ?? "member",
          invitedBy: userId,
          status: "pending",
        }).returning();

        await enqueueJob(PROCESS_ORG_INVITATION, { invitationId: invitation.id }, { retryLimit: 3, retryDelay: 60 });

        return { success: true, status: "invited" as const };
      }
    }),

  // Update a member's role (admin+ only, cannot change owner)
  updateMemberRole: protectedProcedure
    .input(UpdateOrgMemberRoleSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      const callerMembership = await requireOrgMember(ctx.db, input.orgId, userId, "admin");

      // Cannot change the role of the owner unless you are the owner
      const [targetMembership] = await ctx.db
        .select()
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, input.orgId), eq(orgMembers.userId, input.userId)))
        .limit(1);

      if (!targetMembership) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      }

      if (targetMembership.role === "owner" && callerMembership.role !== "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the owner can change the owner's role",
        });
      }

      await ctx.db
        .update(orgMembers)
        .set({ role: input.role })
        .where(and(eq(orgMembers.orgId, input.orgId), eq(orgMembers.userId, input.userId)));

      await ctx.pubsub.publish(syncChannel("organization"), {
        action: "updated",
        data: { orgId: input.orgId, memberUpdated: input.userId, role: input.role },
        timestamp: Date.now(),
      } satisfies SyncEvent<unknown>);

      return { success: true };
    }),

  // Remove a member (admin+ only, cannot remove owner)
  removeMember: requirePermission("org:member:remove")
    .input(RemoveOrgMemberSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      await requireOrgMember(ctx.db, input.orgId, userId, "admin");

      // Cannot remove the owner
      const [targetMembership] = await ctx.db
        .select()
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, input.orgId), eq(orgMembers.userId, input.userId)))
        .limit(1);

      if (!targetMembership) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      }

      if (targetMembership.role === "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot remove the organization owner",
        });
      }

      await ctx.db
        .delete(orgMembers)
        .where(and(eq(orgMembers.orgId, input.orgId), eq(orgMembers.userId, input.userId)));

      await ctx.pubsub.publish(syncChannel("organization"), {
        action: "updated",
        data: { orgId: input.orgId, memberRemoved: input.userId },
        timestamp: Date.now(),
      } satisfies SyncEvent<unknown>);

      return { success: true };
    }),

  // Leave an organization (self-removal, cannot leave if you're the sole owner)
  leave: protectedProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      const membership = await requireOrgMember(ctx.db, input.orgId, userId);

      if (membership.role === "owner") {
        // Check if there's another owner
        const owners = await ctx.db
          .select()
          .from(orgMembers)
          .where(and(eq(orgMembers.orgId, input.orgId), eq(orgMembers.role, "owner")));

        if (owners.length <= 1) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Cannot leave as the sole owner. Transfer ownership first.",
          });
        }
      }

      await ctx.db
        .delete(orgMembers)
        .where(and(eq(orgMembers.orgId, input.orgId), eq(orgMembers.userId, userId)));

      return { success: true };
    }),

  // Set the worker policy for an organization (admin+ only)
  setWorkerPolicy: protectedProcedure
    .input(SetWorkerPolicySchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      await requireOrgMember(ctx.db, input.orgId, userId, "admin");

      // If central_worker, verify ownership of the specified worker
      let centralWorkerId: string | null = null;
      if (input.policy === "central_worker" && input.centralWorkerId) {
        const [worker] = await ctx.db
          .select()
          .from(workers)
          .where(and(eq(workers.id, input.centralWorkerId), eq(workers.userId, userId)))
          .limit(1);
        if (!worker) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You can only assign a worker you own as the central worker",
          });
        }
        centralWorkerId = input.centralWorkerId;
      }

      const [updated] = await ctx.db
        .update(organizations)
        .set({
          workerPolicy: input.policy,
          centralWorkerId,
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, input.orgId))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      await ctx.pubsub.publish(syncChannel("organization"), {
        action: "updated",
        data: updated,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof updated>);

      return updated;
    }),

  // Get the calling user's worker assignment for an organization
  getMemberWorker: protectedProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      await requireOrgMember(ctx.db, input.orgId, userId);

      const [assignment] = await ctx.db
        .select({
          workerId: orgMemberWorkers.workerId,
          workerName: workers.name,
          workerStatus: workers.status,
        })
        .from(orgMemberWorkers)
        .leftJoin(workers, eq(orgMemberWorkers.workerId, workers.id))
        .where(and(eq(orgMemberWorkers.orgId, input.orgId), eq(orgMemberWorkers.userId, userId)))
        .limit(1);

      return assignment ?? null;
    }),

  // Set or clear the calling user's worker assignment for an organization
  setMemberWorker: protectedProcedure
    .input(SetMemberWorkerSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      await requireOrgMember(ctx.db, input.orgId, userId);

      // Only functional when policy is require_local
      const [org] = await ctx.db
        .select({ workerPolicy: organizations.workerPolicy })
        .from(organizations)
        .where(eq(organizations.id, input.orgId))
        .limit(1);
      if (!org) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      if (org.workerPolicy !== "require_local") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Worker assignment is only available when the organization uses the 'require_local' policy",
        });
      }

      if (input.workerId === null) {
        // Clear assignment
        await ctx.db
          .delete(orgMemberWorkers)
          .where(
            and(eq(orgMemberWorkers.orgId, input.orgId), eq(orgMemberWorkers.userId, userId)),
          );
      } else {
        // Verify the caller owns the specified worker
        const [worker] = await ctx.db
          .select()
          .from(workers)
          .where(and(eq(workers.id, input.workerId), eq(workers.userId, userId)))
          .limit(1);
        if (!worker) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You can only assign a worker you own",
          });
        }

        // Upsert assignment
        await ctx.db
          .insert(orgMemberWorkers)
          .values({ orgId: input.orgId, userId, workerId: input.workerId })
          .onConflictDoUpdate({
            target: [orgMemberWorkers.orgId, orgMemberWorkers.userId],
            set: { workerId: input.workerId },
          });
      }

      await ctx.pubsub.publish(syncChannel("organization"), {
        action: "updated",
        data: { orgId: input.orgId, memberWorkerUpdated: userId },
        timestamp: Date.now(),
      } satisfies SyncEvent<unknown>);

      return { success: true };
    }),

  // Get AI instructions for an organization (admin+ only)
  getAiInstructions: protectedProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      await requireOrgMember(ctx.db, input.orgId, userId, "admin");

      const [org] = await ctx.db
        .select({
          aiInstructionsWorking: organizations.aiInstructionsWorking,
          aiInstructionsSpec: organizations.aiInstructionsSpec,
          aiInstructionsArchitecture: organizations.aiInstructionsArchitecture,
          aiInstructionsDebug: organizations.aiInstructionsDebug,
          aiInstructionsRepo: organizations.aiInstructionsRepo,
        })
        .from(organizations)
        .where(eq(organizations.id, input.orgId))
        .limit(1);

      if (!org) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      return org;
    }),

  // Set AI instructions for a specific session type (admin+ only)
  setAiInstructions: protectedProcedure
    .input(SetAiInstructionsSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      await requireOrgMember(ctx.db, input.orgId, userId, "admin");

      // Map session type to column name
      const columnMap: Record<string, keyof typeof organizations.$inferSelect> = {
        working: "aiInstructionsWorking",
        spec: "aiInstructionsSpec",
        architecture: "aiInstructionsArchitecture",
        debug: "aiInstructionsDebug",
        repo: "aiInstructionsRepo",
      };

      const column = columnMap[input.sessionType];

      const [updated] = await ctx.db
        .update(organizations)
        .set({
          [column]: input.instructions,
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, input.orgId))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      await ctx.pubsub.publish(syncChannel("organization"), {
        action: "updated",
        data: updated,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof updated>);

      return updated;
    }),

  // Get system instructions for an organization (admin+ only)
  getSystemInstructions: protectedProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      await requireOrgMember(ctx.db, input.orgId, userId, "admin");

      const [org] = await ctx.db
        .select({
          systemInstructionsWorking: organizations.systemInstructionsWorking,
          systemInstructionsSpec: organizations.systemInstructionsSpec,
          systemInstructionsArchitecture: organizations.systemInstructionsArchitecture,
          systemInstructionsDebug: organizations.systemInstructionsDebug,
          systemInstructionsRepo: organizations.systemInstructionsRepo,
        })
        .from(organizations)
        .where(eq(organizations.id, input.orgId))
        .limit(1);

      if (!org) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      return {
        instructions: {
          working: org.systemInstructionsWorking,
          spec: org.systemInstructionsSpec,
          architecture: org.systemInstructionsArchitecture,
          debug: org.systemInstructionsDebug,
          repo: org.systemInstructionsRepo,
        },
        defaults: await loadSkillDefaults(),
      };
    }),

  // Set system instructions for a specific session type (admin+ only)
  setSystemInstructions: protectedProcedure
    .input(SetSystemInstructionsSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      await requireOrgMember(ctx.db, input.orgId, userId, "admin");

      const columnMap = {
        working: "systemInstructionsWorking",
        spec: "systemInstructionsSpec",
        architecture: "systemInstructionsArchitecture",
        debug: "systemInstructionsDebug",
        repo: "systemInstructionsRepo",
      } as const;

      const column = columnMap[input.sessionType as keyof typeof columnMap];

      const [updated] = await ctx.db
        .update(organizations)
        .set({
          [column]: input.instructions,
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, input.orgId))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      await ctx.pubsub.publish(syncChannel("organization"), {
        action: "updated",
        data: updated,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof updated>);

      return updated;
    }),

  // Get rig template config for an org
  getRigTemplate: protectedProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      const member = await requireOrgMember(ctx.db, input.orgId, userId);
      if (member.role !== "admin" && member.role !== "owner") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const [org] = await ctx.db
        .select({
          templateRepo: organizations.templateRepo,
          initScripts: organizations.initScripts,
        })
        .from(organizations)
        .where(eq(organizations.id, input.orgId))
        .limit(1);
      if (!org) throw new TRPCError({ code: "NOT_FOUND" });
      return {
        templateRepo: org.templateRepo ?? null,
        initScripts: (org.initScripts as string[] | null) ?? null,
      };
    }),

  // Update rig template config for an org
  updateRigTemplate: protectedProcedure
    .input(SetOrgRigTemplateSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      const member = await requireOrgMember(ctx.db, input.orgId, userId);
      if (member.role !== "admin" && member.role !== "owner") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const [updated] = await ctx.db
        .update(organizations)
        .set({
          templateRepo: input.templateRepo,
          initScripts: input.initScripts,
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, input.orgId))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.pubsub.publish(syncChannel("organization"), {
        action: "updated",
        data: updated,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof updated>);

      return updated;
    }),

  // Real-time sync for organizations
  onSync: protectedProcedure.subscription(async function* ({ ctx, signal }) {
    const userId = requireDbUser(ctx);

    // Pre-load user's org IDs for filtering
    const userOrgs = await ctx.db
      .select({ orgId: orgMembers.orgId })
      .from(orgMembers)
      .where(eq(orgMembers.userId, userId));
    const userOrgIds = new Set(userOrgs.map((m: { orgId: string }) => m.orgId));

    for await (const event of iterateEvents<SyncEvent<Organization>>(
      ctx.pubsub,
      syncChannel("organization"),
      signal!,
    )) {
      const data = event.data as Record<string, unknown>;
      if (data.id && !userOrgIds.has(data.id as string)) continue;
      if (data.orgId && !userOrgIds.has(data.orgId as string)) continue;
      yield tracked(String(++eventId), event);
    }
  }),
});
