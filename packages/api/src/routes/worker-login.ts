import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { compare } from "bcrypt";
import { syncChannel, type SyncEvent } from "@praxis2/shared";
import { getDb } from "../db/index.js";
import { workers, workerTokens } from "../db/schema.js";
import { strictLimiter } from "../middleware/rateLimit.js";
import { getLogger } from "../lib/logger.js";
import { getDbProvisioner } from "../services/db-provisioner/index.js";
import type { PgPubSub } from "../pubsub.js";

const LoginBody = z.object({
  token: z.string().min(1),
  name: z.string().min(1),
});

export function createWorkerLoginRouter(pubsub: PgPubSub) {
  const workerLoginRouter = Router();

  workerLoginRouter.use(strictLimiter);

  // POST /api/worker/login
  workerLoginRouter.post("/login", async (req, res) => {
    try {
      const parsed = LoginBody.safeParse(req.body);
      if (!parsed.success) {
        const firstIssue = parsed.error.issues[0];
        if (firstIssue?.path[0] === "name") {
          res.status(400).json({ error: "Worker name is required" });
          return;
        }
        res.status(401).json({ error: "Invalid or expired token" });
        return;
      }

      const { token, name } = parsed.data;
      const db = getDb();

      // Fetch all unused, non-expired tokens
      const candidates = await db
        .select({
          id: workerTokens.id,
          userId: workerTokens.userId,
          tokenHash: workerTokens.tokenHash,
          expiresAt: workerTokens.expiresAt,
          used: workerTokens.used,
        })
        .from(workerTokens)
        .where(eq(workerTokens.used, false));

      const now = new Date();
      let matchedToken: (typeof candidates)[number] | null = null;

      for (const candidate of candidates) {
        if (candidate.expiresAt <= now) continue;
        if (await compare(token, candidate.tokenHash)) {
          matchedToken = candidate;
          break;
        }
      }

      if (!matchedToken) {
        res.status(401).json({ error: "Invalid or expired token" });
        return;
      }

      // --- DB provisioning BEFORE any side effects ---
      let databaseUrl: string;

      // Provision per-user DB role and get connection string.
      // Use the request's hostname so remote workers get a reachable address.
      try {
        const result = await getDbProvisioner().createUser(matchedToken.userId, req.hostname);
        databaseUrl = result.databaseUrl;
      } catch (provisionErr: unknown) {
        const message = provisionErr instanceof Error ? provisionErr.message : String(provisionErr);
        getLogger().error({ err: provisionErr }, "Database provisioning failed");
        res.status(422).json({ error: `Database provisioning failed: ${message}` });
        return;
      }

      // --- Now safe to mutate ---

      // Mark token as used
      await db
        .update(workerTokens)
        .set({ used: true })
        .where(eq(workerTokens.id, matchedToken.id));

      // Create worker row
      const [worker] = await db
        .insert(workers)
        .values({
          userId: matchedToken.userId,
          name: name.trim(),
          status: "online",
        })
        .returning();

      // Publish sync event
      await pubsub.publish(syncChannel("worker"), {
        action: "created",
        data: worker,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof worker>);

      getLogger().info(
        { workerId: worker.id, userId: matchedToken.userId, name: worker.name },
        "Worker logged in via token",
      );

      res.status(201).json({
        workerId: worker.id,
        workerName: worker.name,
        userId: matchedToken.userId,
        databaseUrl,
      });
    } catch (err) {
      getLogger().error({ err }, "Worker login failed");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return workerLoginRouter;
}
