import "dotenv/config";
import { validateEnv } from "./lib/env.js";
const env = validateEnv();

import http from "node:http";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { appRouter } from "./routers/index.js";
import { createContextFactory, createWSContextFactory } from "./context.js";
import { PgPubSub } from "./pubsub.js";
import { getConnectionString, getDb } from "./db/index.js";
import { registerDeployment } from "./lib/registerDeployment.js";
import { getLogger } from "./lib/logger.js";
import { getRequestLogger } from "./middleware/requestLogger.js";
import { getGlobalLimiter } from "./middleware/rateLimit.js";
import { initJobs, closeJobs } from "./jobs/index.js";
import { backfillGhWebhooks } from "./jobs/handlers/ghWebhookBackfill.js";
import { uploadRouter } from "./routes/upload.js";
import { createQuickRouter } from "./routes/quick.js";
import { createWorkerLoginRouter } from "./routes/worker-login.js";
import { createGitHubWebhookRouter } from "./routes/github-webhook.js";
import { checkStaleWorkers } from "./lib/staleWorkerCheck.js";

const app = express();

app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  })
);

app.use(getGlobalLimiter());
app.use(getRequestLogger());

const pubsub = new PgPubSub(getConnectionString());
const createContext = createContextFactory(pubsub);
const createWSContext = createWSContextFactory(pubsub);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/files", uploadRouter);
app.use("/api/webhooks", createGitHubWebhookRouter(pubsub));

app.use(express.json());
app.use("/api/quick", createQuickRouter(pubsub));
app.use("/api/worker", createWorkerLoginRouter(pubsub));
app.use(
  "/api/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

const server = http.createServer(app as unknown as http.RequestListener);

const wss = new WebSocketServer({ noServer: true });
const wssHandler = applyWSSHandler({
  wss,
  router: appRouter,
  createContext: createWSContext,
});

server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (pathname === "/api/trpc") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

// ── WebSocket heartbeat ─────────────────────────────────────────────
// Ping every 30s to keep connections alive through nginx-ingress
// (default proxy-read-timeout is 60s).
const WS_HEARTBEAT_MS = 30_000;
const heartbeatInterval = setInterval(() => {
  for (const ws of wss.clients) {
    const socket = ws as import("ws").WebSocket & { isAlive?: boolean };
    if (socket.isAlive === false) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, WS_HEARTBEAT_MS);

wss.on("connection", (ws) => {
  const socket = ws as import("ws").WebSocket & { isAlive?: boolean };
  socket.isAlive = true;
  socket.on("pong", () => {
    socket.isAlive = true;
  });
});

wss.on("close", () => {
  clearInterval(heartbeatInterval);
});

// ── Stale worker detection ──────────────────────────────────────────
// Check every 60s for workers whose lastSeenAt is older than 2 minutes.
const STALE_CHECK_INTERVAL_MS = 60_000;
let staleCheckTimer: ReturnType<typeof setInterval> | undefined;

async function start() {
  await initJobs(getConnectionString(), pubsub);

  // Backfill webhooks for repos that predate the deployment-tracking feature
  try {
    await backfillGhWebhooks();
  } catch (err) {
    getLogger().warn({ err }, "GitHub webhook backfill failed — will retry next restart");
  }

  server.listen(env.PORT, () => {
    getLogger().info(`API server listening on http://localhost:${env.PORT}`);
    getLogger().info(`WebSocket server listening on ws://localhost:${env.PORT}/api/trpc`);
  });

  // Start periodic stale worker check
  staleCheckTimer = setInterval(async () => {
    try {
      await checkStaleWorkers(pubsub);
    } catch (err) {
      getLogger().warn({ err }, "Stale worker check failed");
    }
  }, STALE_CHECK_INTERVAL_MS);

  // Self-register deployment if GIT_SHA is available
  if (env.GIT_SHA) {
    try {
      const register = registerDeployment(getDb(), pubsub);
      await register("api", env.GIT_SHA, env.DEPLOY_TIMESTAMP ?? new Date().toISOString());
      getLogger().info({ gitSha: env.GIT_SHA }, "API deployment registered");
    } catch (err) {
      getLogger().error({ err }, "Failed to register API deployment");
    }
  }
}

async function shutdown() {
  getLogger().info("Shutting down...");
  clearInterval(heartbeatInterval);
  if (staleCheckTimer) clearInterval(staleCheckTimer);
  wssHandler.broadcastReconnectNotification();
  wss.close();
  server.close();
  pubsub.close();
  await closeJobs();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

start().catch((err) => {
  getLogger().error({ err }, "Failed to start server");
  process.exit(1);
});
