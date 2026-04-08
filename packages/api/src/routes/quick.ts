import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { syncChannel, type SyncEvent } from "@praxis2/shared";
import { getDb } from "../db/index.js";
import { ideas, repos } from "../db/schema.js";
import { apiKeyAuth } from "../middleware/apiKeyAuth.js";
import { strictLimiter } from "../middleware/rateLimit.js";
import { getLogger } from "../lib/logger.js";
import type { PgPubSub } from "../pubsub.js";

const QuickIdeaBody = z.object({
  repoName: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
});

export function createQuickRouter(pubsub: PgPubSub) {
  const quickRouter = Router();

  // All routes require rate limiting and API key auth
  quickRouter.use(strictLimiter);
  quickRouter.use(apiKeyAuth);

  // POST /api/quick/idea
  quickRouter.post("/idea", async (req, res) => {
    try {
      const parsed = QuickIdeaBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0].message });
        return;
      }

      const { repoName, title, description } = parsed.data;

      const db = getDb();
      const userId = req.apiKeyUserId!;

      // Resolve repo by name (case-insensitive) AND userId
      const userRepos = await db
        .select()
        .from(repos)
        .where(eq(repos.userId, userId));
      const repo = userRepos.find(
        (r) => r.name.toLowerCase() === repoName.toLowerCase(),
      );

      if (!repo) {
        res.status(404).json({ error: `Repo "${repoName}" not found` });
        return;
      }

      // Create the idea
      const [idea] = await db
        .insert(ideas)
        .values({
          repoId: repo.id,
          userId,
          title: title.trim(),
          description: description?.trim() || "Added via Siri",
          source: "human",
          status: "new",
        })
        .returning();

      await pubsub.publish(syncChannel("idea"), {
        action: "created",
        data: idea,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof idea>);

      getLogger().info(
        { ideaId: idea.id, repoId: repo.id, userId },
        "Quick idea created via API key",
      );

      res.status(201).json({ success: true, ideaId: idea.id });
    } catch (err) {
      getLogger().error({ err }, "Quick idea creation failed");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return quickRouter;
}
