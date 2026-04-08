import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgPubSub, syncChannel } from "@praxis2/shared";
import { ideaPhases } from "@praxis2/api/schema";
import { requiredEnv, createCliSql } from "./cli-db.js";

export async function phaseSave(args: string[]): Promise<void> {
  // Parse args: <ideaId> --phase <number> --name <name> -f <content-file>
  let ideaId: string | undefined;
  let phaseNumber: number | undefined;
  let phaseName: string | undefined;
  let filePath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--phase" && args[i + 1]) {
      phaseNumber = parseInt(args[++i], 10);
    } else if (args[i] === "--name" && args[i + 1]) {
      phaseName = args[++i];
    } else if (args[i] === "-f" && args[i + 1]) {
      filePath = args[++i];
    } else if (!ideaId) {
      ideaId = args[i];
    }
  }

  ideaId ??= process.env.PX_IDEA_ID;

  if (!ideaId || phaseNumber === undefined || !phaseName || !filePath) {
    console.error("Usage: px phase save <ideaId> --phase <number> --name <name> -f <content-file>");
    console.error("  ideaId can also be set via PX_IDEA_ID env var");
    process.exit(1);
  }

  if (isNaN(phaseNumber) || phaseNumber < 1 || phaseNumber > 8) {
    console.error("Error: --phase must be between 1 and 8");
    process.exit(1);
  }

  // Read content from file
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err) {
    console.error(`Failed to read ${filePath}: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  const sessionId = requiredEnv("PX_SESSION_ID");
  const databaseUrl = requiredEnv("DATABASE_URL");

  const sql = createCliSql(databaseUrl);
  const db = drizzle(sql);
  const pubsub = new PgPubSub(databaseUrl);

  try {
    // Upsert: insert on conflict update content + phaseName
    await db
      .insert(ideaPhases)
      .values({
        ideaId,
        sessionId,
        phaseNumber,
        phaseName,
        content,
      })
      .onConflictDoUpdate({
        target: [ideaPhases.ideaId, ideaPhases.sessionId, ideaPhases.phaseNumber],
        set: {
          content,
          phaseName,
        },
      });

    await pubsub.publish(syncChannel("ideaPhase"), {
      action: "created",
      data: { ideaId, sessionId, phaseNumber },
      timestamp: Date.now(),
    });

    console.log(`OK: phase ${phaseNumber} saved`);
  } finally {
    await pubsub.close();
    await sql.end();
  }
}
