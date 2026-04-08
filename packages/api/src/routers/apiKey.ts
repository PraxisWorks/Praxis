import { z } from "zod";
import { eq, and, ne, desc } from "drizzle-orm";
import { tracked, TRPCError } from "@trpc/server";
import { CreateApiKeySchema, syncChannel, type SyncEvent, type ApiKey } from "@praxis2/shared";
import { router, protectedProcedure } from "../trpc.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { apiKeys } from "../db/schema.js";
import { iterateEvents } from "../lib/iterateEvents.js";
import { requireDbUser } from "../lib/requireDbUser.js";
import { getCryptoAdapter } from "../services/crypto/index.js";
import { getAnthropicAdapter } from "../services/anthropic/index.js";
import { enqueueJob } from "../jobs/index.js";

let eventId = 0;

const BYOK_PROVISION_WORKER = "byok-provision-worker";
const BYOK_TEARDOWN_WORKER = "byok-teardown-worker";

export const apiKeyRouter = router({
  // List all API keys for current user (never expose encryptedKey)
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = requireDbUser(ctx);
    const rows = await ctx.db
      .select({
        id: apiKeys.id,
        userId: apiKeys.userId,
        label: apiKeys.label,
        keyLastFour: apiKeys.keyLastFour,
        status: apiKeys.status,
        createdAt: apiKeys.createdAt,
        updatedAt: apiKeys.updatedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId))
      .orderBy(desc(apiKeys.createdAt));
    return rows;
  }),

  // Get single key by ID (masked)
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      const [row] = await ctx.db
        .select({
          id: apiKeys.id,
          userId: apiKeys.userId,
          label: apiKeys.label,
          keyLastFour: apiKeys.keyLastFour,
          status: apiKeys.status,
          createdAt: apiKeys.createdAt,
          updatedAt: apiKeys.updatedAt,
        })
        .from(apiKeys)
        .where(and(eq(apiKeys.id, input.id), eq(apiKeys.userId, userId)))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "API key not found" });
      return row;
    }),

  // Create a new API key
  create: requirePermission("worker:create:apikey")
    .input(CreateApiKeySchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      // Enforce 5-key limit (non-revoked)
      const existing = await ctx.db
        .select({ id: apiKeys.id })
        .from(apiKeys)
        .where(and(eq(apiKeys.userId, userId), ne(apiKeys.status, "revoked")));
      if (existing.length >= 5) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Maximum 5 active API keys allowed" });
      }

      // Validate key with Anthropic
      const anthropic = getAnthropicAdapter();
      const validation = await anthropic.validateKey(input.key);
      if (!validation.valid) {
        throw new TRPCError({ code: "BAD_REQUEST", message: validation.error ?? "Invalid API key" });
      }

      // Encrypt the key
      const crypto = getCryptoAdapter();
      const encryptedKey = await crypto.encrypt(input.key);
      const keyLastFour = input.key.slice(-4);

      // Insert
      const [row] = await ctx.db
        .insert(apiKeys)
        .values({
          userId,
          label: input.label,
          encryptedKey,
          keyLastFour,
          status: "provisioning",
        })
        .returning();

      // Enqueue provisioning job
      await enqueueJob(BYOK_PROVISION_WORKER, { apiKeyId: row.id, userId });

      // Publish sync event (masked)
      await ctx.pubsub.publish(syncChannel("apiKey"), {
        action: "created",
        data: { ...row, encryptedKey: undefined },
        timestamp: Date.now(),
      } satisfies SyncEvent<any>);

      // Return masked
      return {
        id: row.id,
        userId: row.userId,
        label: row.label,
        keyLastFour: row.keyLastFour,
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    }),

  // Delete (revoke) an API key
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const [existing] = await ctx.db
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.id, input.id), eq(apiKeys.userId, userId)))
        .limit(1);

      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "API key not found" });

      // Mark as revoked
      const [updated] = await ctx.db
        .update(apiKeys)
        .set({ status: "revoked", updatedAt: new Date() })
        .where(eq(apiKeys.id, input.id))
        .returning();

      // Enqueue teardown job
      await enqueueJob(BYOK_TEARDOWN_WORKER, { apiKeyId: input.id });

      await ctx.pubsub.publish(syncChannel("apiKey"), {
        action: "deleted",
        data: { ...updated, encryptedKey: undefined },
        timestamp: Date.now(),
      } satisfies SyncEvent<any>);

      return { success: true };
    }),

  // Real-time subscription
  onSync: protectedProcedure.subscription(async function* ({ ctx, signal }) {
    const userId = requireDbUser(ctx);
    for await (const event of iterateEvents<SyncEvent<any>>(
      ctx.pubsub,
      syncChannel("apiKey"),
      signal!,
    )) {
      if (event.data.userId === userId) {
        yield tracked(String(++eventId), event);
      }
    }
  }),
});
