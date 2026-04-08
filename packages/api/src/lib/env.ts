import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),
  AUTH0_ISSUER_BASE_URL: z.string().url("AUTH0_ISSUER_BASE_URL must be a valid URL"),
  AUTH0_AUDIENCE: z.string().url("AUTH0_AUDIENCE must be a valid URL"),
  PORT: z.string().default("3001"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  RATE_LIMIT_MAX: z.string().default("1000"),
  NODE_ENV: z.string().default("development"),
  LOG_LEVEL: z.string().default("info"),
  PUSH_PROVIDER: z.string().optional(),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  GIT_SHA: z.string().optional(),
  DEPLOY_TIMESTAMP: z.string().optional(),
  // ── Storage ──────────────────────────────────────────────────
  STORAGE_PROVIDER: z.string().optional(),
  STORAGE_LOCAL_DIR: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  UPLOAD_MAX_SIZE_MB: z.string().default("10"),
  // ── BYOK Encryption ────────────────────────────────────────
  API_KEY_ENCRYPTION_KEY: z.string().optional(),
  // ── GitHub ──────────────────────────────────────────────────
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  API_BASE_URL: z.string().optional(),
  // ── Worker DB provisioning ─────────────────────────────────
  DB_PROVISIONER: z.enum(["sql", "digitalocean"]).optional(),
  DB_PUBLIC_HOST: z.string().optional(),
  DB_PUBLIC_PORT: z.string().optional(),
  DO_API_TOKEN: z.string().optional(),
  DO_DB_CLUSTER_ID: z.string().optional(),
  // ── Worker JWT ─────────────────────────────────────────────
  WORKER_JWT_SECRET: z.string().optional(),
  // ── Auth0 Management API ──────────────────────────────
  AUTH0_MGMT_DOMAIN: z.string().optional(),
  AUTH0_MGMT_CLIENT_ID: z.string().optional(),
  AUTH0_MGMT_CLIENT_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let env: Env;

export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Environment validation failed:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  env = result.data;
  return env;
}

export function getEnv(): Env {
  if (!env) throw new Error("validateEnv() must be called first");
  return env;
}
