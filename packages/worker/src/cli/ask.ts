import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import { PgPubSub, syncChannel, StructuredQuestionMetadataSchema } from "@praxis2/shared";
import { sessionMessages, sessions } from "@praxis2/api/schema";
import { requiredEnv, createCliSql } from "./cli-db.js";

export async function ask(args: string[]): Promise<void> {
  let question: string | undefined;
  let header: string | undefined;
  const options: { label: string; description: string }[] = [];
  let multiSelect = false;
  let timeout = 1_800_000;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--question" && args[i + 1]) {
      question = args[++i];
    } else if (args[i] === "--header" && args[i + 1]) {
      header = args[++i];
    } else if (args[i] === "--option" && args[i + 1]) {
      const raw = args[++i];
      const sep = raw.indexOf("::");
      if (sep === -1) {
        console.error(`Invalid --option format (expected "Label::Description"): ${raw}`);
        process.exit(1);
      }
      options.push({ label: raw.slice(0, sep), description: raw.slice(sep + 2) });
    } else if (args[i] === "--multi-select") {
      multiSelect = true;
    } else if (args[i] === "--timeout" && args[i + 1]) {
      timeout = parseInt(args[++i], 10);
    }
  }

  if (!question || !header || options.length < 2) {
    console.error("Usage: px ask --question <text> --header <label> --option \"Label::Desc\" [--option ...] [--multi-select] [--timeout <ms>]");
    console.error("  At least 2 --option args required. --header max 12 chars.");
    process.exit(1);
  }

  const metadata = StructuredQuestionMetadataSchema.parse({
    type: "structured_question",
    questions: [{ question, header, options, multiSelect }],
    answered: false,
  });

  const sessionId = requiredEnv("PX_SESSION_ID");
  const databaseUrl = requiredEnv("DATABASE_URL");

  const sql_conn = createCliSql(databaseUrl);
  const db = drizzle(sql_conn);
  const pubsub = new PgPubSub(databaseUrl);

  let pollInterval: ReturnType<typeof setInterval> | undefined;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

  try {
    const fallback = `${question}\nOptions: ${options.map((o) => `${o.label} – ${o.description}`).join(", ")}`;

    const [inserted] = await db
      .insert(sessionMessages)
      .values({ sessionId, role: "assistant", content: fallback, metadata })
      .returning({ id: sessionMessages.id });

    const msgId = inserted.id;

    await db
      .update(sessions)
      .set({
        metadata: sql`jsonb_set(COALESCE(${sessions.metadata}, '{}'::jsonb), '{needsInput}', 'true'::jsonb)`,
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, sessionId));

    await pubsub.publish(`sync:session:${sessionId}:messages`, {
      action: "created",
      data: { sessionId },
      timestamp: Date.now(),
    });

    await pubsub.publish(syncChannel("session"), {
      action: "updated",
      data: { id: sessionId },
      timestamp: Date.now(),
    });

    await new Promise<void>((resolve, reject) => {
      pollInterval = setInterval(async () => {
        try {
          const [row] = await db
            .select({ metadata: sessionMessages.metadata })
            .from(sessionMessages)
            .where(eq(sessionMessages.id, msgId));

          const meta = row?.metadata as Record<string, unknown> | null;
          if (meta?.answered === true) {
            const selected = (meta.selectedOptions as string[]) ?? [];
            console.log(`Selected: ${selected.join(", ")}`);
            resolve();
          }
        } catch (err) {
          reject(err);
        }
      }, 2000);

      timeoutTimer = setTimeout(() => {
        console.error("No answer received (timeout)");
        reject(new Error("timeout"));
      }, timeout);
    });
  } catch (err) {
    if (err instanceof Error && err.message === "timeout") {
      process.exit(1);
    }
    throw err;
  } finally {
    clearInterval(pollInterval);
    clearTimeout(timeoutTimer);
    await pubsub.close();
    await sql_conn.end();
  }
}
