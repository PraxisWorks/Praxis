import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgPubSub, syncChannel } from "@praxis2/shared";
import { ideas, rigs } from "@praxis2/api/schema";
import { requiredEnv, createCliSql } from "./cli-db.js";

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

export async function ideaCreate(args: string[]): Promise<void> {
  const title = parseFlag(args, "--title");
  const description = parseFlag(args, "--description");
  const repoId = parseFlag(args, "--repo-id") ?? process.env.PX_REPO_ID;

  if (!title || !description) {
    console.error("Usage: px idea create --title <title> --description <desc> [--repo-id <uuid>]");
    process.exit(1);
  }

  if (!repoId) {
    console.error("Error: --repo-id or PX_REPO_ID env var is required");
    process.exit(1);
  }

  const databaseUrl = requiredEnv("DATABASE_URL");

  const pgSql = createCliSql(databaseUrl);
  const db = drizzle(pgSql);
  const pubsub = new PgPubSub(databaseUrl);

  try {
    // Look up repo to get userId
    const [repo] = await db
      .select({ userId: rigs.userId })
      .from(rigs)
      .where(eq(rigs.id, repoId))
      .limit(1);

    if (!repo) {
      console.error(`Error: repo not found: ${repoId}`);
      process.exit(1);
    }

    // Get the next order value for this repo
    const [{ maxOrder }] = await db
      .select({ maxOrder: sql<number>`COALESCE(MAX(${ideas.order}), -1)` })
      .from(ideas)
      .where(eq(ideas.repoId, repoId))
      .limit(1);

    const nextOrder = maxOrder + 1;

    const [idea] = await db
      .insert(ideas)
      .values({
        repoId: repoId,
        userId: repo.userId,
        title,
        description,
        order: nextOrder,
        status: "new",
        source: "human",
        tags: [],
      })
      .returning();

    await pubsub.publish(syncChannel("idea"), {
      action: "created",
      data: idea,
      timestamp: Date.now(),
    });

    console.log(`OK: idea created — ${title}`);
  } finally {
    await pubsub.close();
    await pgSql.end();
  }
}
