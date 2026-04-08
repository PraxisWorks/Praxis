import { Router } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { syncChannel, type SyncEvent } from "@praxis2/shared";
import { getDb } from "../db/index.js";
import { ghWebhookConfigs, ghDeployments, repos } from "../db/schema.js";
import { getLogger } from "../lib/logger.js";
import type { PgPubSub } from "../pubsub.js";
import express from "express";

export function createGitHubWebhookRouter(pubsub: PgPubSub) {
  const router = Router();

  // Use raw body for HMAC verification — must be applied before express.json()
  router.use(express.raw({ type: "application/json" }));

  // POST /api/webhooks/github
  router.post("/github", async (req, res) => {
    try {
      const rawBody = req.body as Buffer;
      const signature = req.headers["x-hub-signature-256"] as string | undefined;
      const event = req.headers["x-github-event"] as string | undefined;

      // Ping events — return 200 immediately
      if (event === "ping") {
        res.status(200).json({ ok: true });
        return;
      }

      // Only process deployment_status events
      if (event !== "deployment_status") {
        res.status(200).json({ ok: true, skipped: true });
        return;
      }

      if (!signature) {
        res.status(401).json({ error: "Missing signature" });
        return;
      }

      // Parse JSON payload
      const payload = JSON.parse(rawBody.toString("utf-8"));
      const fullName = payload.repository?.full_name as string | undefined;

      if (!fullName) {
        res.status(400).json({ error: "Missing repository info" });
        return;
      }

      const [repoOwner, repoName] = fullName.split("/");
      const db = getDb();

      // Look up webhook config by repo owner/name
      const [config] = await db
        .select()
        .from(ghWebhookConfigs)
        .where(
          and(
            eq(ghWebhookConfigs.repoOwner, repoOwner),
            eq(ghWebhookConfigs.repoName, repoName),
          ),
        )
        .limit(1);

      if (!config) {
        res.status(404).json({ error: "Unknown repository" });
        return;
      }

      // Verify HMAC SHA-256 signature
      const expected =
        "sha256=" +
        createHmac("sha256", config.webhookSecret)
          .update(rawBody)
          .digest("hex");

      const sigBuffer = Buffer.from(signature);
      const expectedBuffer = Buffer.from(expected);

      if (
        sigBuffer.length !== expectedBuffer.length ||
        !timingSafeEqual(sigBuffer, expectedBuffer)
      ) {
        res.status(401).json({ error: "Invalid signature" });
        return;
      }

      // Extract deployment status fields
      const deployment = payload.deployment;
      const deploymentStatus = payload.deployment_status;

      const deploymentData = {
        repoId: config.repoId,
        githubDeploymentId: String(deployment.id),
        environment: deployment.environment ?? "unknown",
        status: deploymentStatus.state ?? "unknown",
        ref: deployment.ref ?? "",
        description:
          deploymentStatus.description ?? deployment.description ?? null,
        url:
          deploymentStatus.target_url ?? deploymentStatus.log_url ?? null,
        creatorLogin: deployment.creator?.login ?? null,
        createdAt: new Date(deployment.created_at),
        updatedAt: new Date(deploymentStatus.created_at),
      };

      // Upsert into gh_deployments
      const [upserted] = await db
        .insert(ghDeployments)
        .values(deploymentData)
        .onConflictDoUpdate({
          target: [ghDeployments.repoId, ghDeployments.githubDeploymentId],
          set: {
            status: deploymentData.status,
            description: deploymentData.description,
            url: deploymentData.url,
            updatedAt: deploymentData.updatedAt,
          },
        })
        .returning();

      // Publish sync event for real-time frontend updates.
      // Include the repo's orgId so the client-side filter works.
      const [repo] = await db
        .select({ orgId: repos.orgId })
        .from(repos)
        .where(eq(repos.id, config.repoId))
        .limit(1);

      await pubsub.publish(syncChannel("ghDeployment"), {
        action: "updated",
        data: { ...upserted, orgId: repo?.orgId },
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof upserted & { orgId?: string }>);

      res.status(200).json({ ok: true });
    } catch (err) {
      getLogger().error({ err }, "GitHub webhook processing failed");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
