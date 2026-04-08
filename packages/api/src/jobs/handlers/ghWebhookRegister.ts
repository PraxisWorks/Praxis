import type PgBoss from "pg-boss";
import { randomBytes } from "node:crypto";
import { getDb } from "../../db/index.js";
import { ghWebhookConfigs } from "../../db/schema.js";
import { getGitHubAdapter } from "../../services/github/index.js";
import { getLogger } from "../../lib/logger.js";
import { getEnv } from "../../lib/env.js";
import { GH_WEBHOOK_REGISTER } from "@praxis2/shared";

type Payload = {
  repoId: string;
  repo: string;
};

/** Parse various GitHub repo URL formats into owner/name */
function parseRepo(repo: string): { owner: string; name: string } | null {
  // owner/name format
  if (/^[^\/]+\/[^\/]+$/.test(repo)) {
    const [owner, name] = repo.split("/");
    return { owner, name };
  }

  // https://github.com/owner/repo or https://github.com/owner/repo.git
  try {
    const url = new URL(repo);
    const parts = url.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
    if (parts.length >= 2) {
      return { owner: parts[0], name: parts[1] };
    }
  } catch {
    // Not a URL, try SSH
  }

  // git@github.com:owner/repo.git
  const sshMatch = repo.match(/^git@[^:]+:([^\/]+)\/([^\/]+?)(?:\.git)?$/);
  if (sshMatch) {
    return { owner: sshMatch[1], name: sshMatch[2] };
  }

  return null;
}

export async function registerGhWebhookRegisterHandler(boss: PgBoss): Promise<void> {
  await boss.work(GH_WEBHOOK_REGISTER, async ([job]) => {
    const { repoId, repo } = job.data as Payload;
    const logger = getLogger();

    const parsed = parseRepo(repo);
    if (!parsed) {
      logger.warn({ repoId, repo }, "Could not parse repo format — skipping webhook registration");
      return;
    }

    const { owner, name } = parsed;

    const github = getGitHubAdapter();
    if (!github) {
      logger.warn({ repoId, repo }, "GITHUB_TOKEN not set — skipping webhook registration");
      return;
    }

    const env = getEnv();
    const baseUrl = env.API_BASE_URL ?? `http://localhost:${env.PORT}`;
    const webhookUrl = `${baseUrl}/api/webhooks/github`;
    const secret = randomBytes(32).toString("hex");

    const result = await github.registerWebhook({
      owner,
      repo: name,
      url: webhookUrl,
      secret,
      events: ["deployment_status"],
    });

    if (!result.success || !result.hookId) {
      logger.error({ repoId, repo, error: result.error }, "Failed to register GitHub webhook");
      return;
    }

    const db = getDb();
    await db
      .insert(ghWebhookConfigs)
      .values({
        repoId,
        githubWebhookId: result.hookId,
        webhookSecret: secret,
        repoOwner: owner,
        repoName: name,
      })
      .onConflictDoUpdate({
        target: ghWebhookConfigs.repoId,
        set: {
          githubWebhookId: result.hookId,
          webhookSecret: secret,
          repoOwner: owner,
          repoName: name,
        },
      });

    logger.info({ repoId, owner, name, hookId: result.hookId }, "GitHub webhook registered");
  });
}
