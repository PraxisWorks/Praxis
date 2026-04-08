import pino from "pino";

let cachedLogger: pino.Logger | null = null;

export function initLogger(level: string, nodeEnv: string): pino.Logger {
  cachedLogger = pino({
    level,
    ...(nodeEnv !== "production" && {
      transport: {
        target: "pino-pretty",
        options: { colorize: true },
      },
    }),
  });
  return cachedLogger;
}

export function getLogger(): pino.Logger {
  if (!cachedLogger) {
    // Fallback to a basic logger if not initialized
    cachedLogger = pino({ level: "info" });
  }
  return cachedLogger;
}
