import { getLogger } from "../../lib/logger.js";
import type { StorageAdapter } from "./types.js";
import { createConsoleStorageAdapter } from "./console.js";
import { createLocalStorageAdapter } from "./local.js";
import { createS3StorageAdapter } from "./s3.js";

export type { StorageAdapter, UploadParams, UploadResult } from "./types.js";
export { createLocalStorageAdapter } from "./local.js";
export { createS3StorageAdapter, type S3StorageConfig } from "./s3.js";
export { createConsoleStorageAdapter } from "./console.js";

let instance: StorageAdapter | null = null;

export function getStorageAdapter(): StorageAdapter {
  if (instance) return instance;

  const provider = process.env.STORAGE_PROVIDER;

  switch (provider) {
    case "local": {
      const baseDir = process.env.STORAGE_LOCAL_DIR ?? "./uploads";
      getLogger().info({ baseDir }, "Storage adapter: local filesystem");
      instance = createLocalStorageAdapter(baseDir);
      break;
    }

    case "s3": {
      const bucket = process.env.S3_BUCKET;
      const region = process.env.S3_REGION ?? "us-east-1";
      if (!bucket) {
        throw new Error("STORAGE_PROVIDER=s3 requires S3_BUCKET to be set");
      }
      getLogger().info({ bucket, region }, "Storage adapter: S3");
      instance = createS3StorageAdapter({
        bucket,
        region,
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        endpoint: process.env.S3_ENDPOINT,
      });
      break;
    }

    default:
      getLogger().info("Storage adapter: console (no STORAGE_PROVIDER set)");
      instance = createConsoleStorageAdapter();
      break;
  }

  return instance;
}

export function setStorageAdapter(adapter: StorageAdapter): void {
  instance = adapter;
}

export function resetStorageAdapter(): void {
  instance = null;
}
