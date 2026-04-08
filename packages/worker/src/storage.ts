/**
 * Worker-local storage adapter factories.
 *
 * These mirror the API package's adapters but use the worker's own logger,
 * avoiding the API's getLogger → getEnv → validateEnv chain which throws
 * because the worker process hasn't called the API's validateEnv().
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import fs from "node:fs/promises";
import path from "node:path";
import { getLogger } from "./logger.js";

// ─── Types (mirrored from @praxis2/api/services/storage) ─────────────

export type UploadParams = {
  key: string;
  data: Buffer;
  mimeType: string;
  filename: string;
};

export type UploadResult = {
  storageKey: string;
  sizeBytes: number;
};

export type StorageAdapter = {
  upload(params: UploadParams): Promise<UploadResult>;
  download(
    key: string,
  ): Promise<{ data: Buffer; mimeType: string; filename: string }>;
  delete(key: string): Promise<void>;
  getUrl(key: string): string;
};

// ─── S3 Adapter ──────────────────────────────────────────────────────

export type S3StorageConfig = {
  bucket: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  endpoint?: string;
};

export function createS3StorageAdapter(
  config: S3StorageConfig,
): StorageAdapter {
  const logger = getLogger();
  const client = new S3Client({
    region: config.region,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    ...(config.accessKeyId && config.secretAccessKey
      ? {
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          },
        }
      : {}),
    ...(config.endpoint
      ? { endpoint: config.endpoint, forcePathStyle: true }
      : {}),
  });

  let bucketReady = false;

  async function ensureBucket(): Promise<void> {
    if (bucketReady) return;
    try {
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    } catch {
      try {
        await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
        logger.info({ bucket: config.bucket }, "Created S3 bucket");
      } catch (createErr) {
        logger.warn(
          { bucket: config.bucket, err: createErr },
          "Bucket creation failed (may already exist)",
        );
      }
    }
    bucketReady = true;
  }

  return {
    async upload(params: UploadParams) {
      await ensureBucket();
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: params.key,
          Body: params.data,
          ContentType: params.mimeType,
          Metadata: { filename: params.filename },
        }),
      );
      logger.debug({ key: params.key, bucket: config.bucket }, "File stored (S3)");
      return { storageKey: params.key, sizeBytes: params.data.length };
    },

    async download(key: string) {
      const response = await client.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: key }),
      );
      const data = Buffer.from(await response.Body!.transformToByteArray());
      return {
        data,
        mimeType: response.ContentType ?? "application/octet-stream",
        filename: response.Metadata?.filename ?? "unknown",
      };
    },

    async delete(key: string) {
      await client.send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
      );
      logger.debug({ key, bucket: config.bucket }, "File deleted (S3)");
    },

    getUrl(key: string) {
      return `/api/files/${encodeURIComponent(key)}`;
    },
  };
}

// ─── Local Filesystem Adapter ────────────────────────────────────────

export function createLocalStorageAdapter(baseDir: string): StorageAdapter {
  const logger = getLogger();
  return {
    async upload(params: UploadParams) {
      const dir = path.join(baseDir, params.key.slice(0, 2));
      await fs.mkdir(dir, { recursive: true });
      const filePath = path.join(baseDir, params.key);
      await fs.writeFile(filePath, params.data);
      await fs.writeFile(
        `${filePath}.meta.json`,
        JSON.stringify({ mimeType: params.mimeType, filename: params.filename }),
      );
      logger.debug({ key: params.key, sizeBytes: params.data.length }, "File stored (local)");
      return { storageKey: params.key, sizeBytes: params.data.length };
    },

    async download(key: string) {
      const filePath = path.join(baseDir, key);
      const [data, metaRaw] = await Promise.all([
        fs.readFile(filePath),
        fs.readFile(`${filePath}.meta.json`, "utf-8"),
      ]);
      const meta = JSON.parse(metaRaw) as { mimeType: string; filename: string };
      return { data, mimeType: meta.mimeType, filename: meta.filename };
    },

    async delete(key: string) {
      const filePath = path.join(baseDir, key);
      await fs.unlink(filePath).catch(() => {});
      await fs.unlink(`${filePath}.meta.json`).catch(() => {});
      logger.debug({ key }, "File deleted (local)");
    },

    getUrl(key: string) {
      return `/api/files/${key}`;
    },
  };
}

// ─── Console (no-op) Adapter ─────────────────────────────────────────

export function createConsoleStorageAdapter(): StorageAdapter {
  const logger = getLogger();
  return {
    async upload(params) {
      logger.info(
        { key: params.key, filename: params.filename, sizeBytes: params.data.length },
        "File uploaded (console adapter — not actually stored)",
      );
      return { storageKey: params.key, sizeBytes: params.data.length };
    },

    async download(key) {
      logger.info({ key }, "File download requested (console adapter)");
      return { data: Buffer.from(""), mimeType: "application/octet-stream", filename: "unknown" };
    },

    async delete(key) {
      logger.info({ key }, "File deleted (console adapter)");
    },

    getUrl(key) {
      return `/api/files/${key}`;
    },
  };
}
