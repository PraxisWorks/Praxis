import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import { getLogger } from "../../lib/logger.js";
import type { StorageAdapter, UploadParams } from "./types.js";

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
  const client = new S3Client({
    region: config.region,
    // Disable automatic checksum headers — newer AWS SDK v3 versions add
    // x-amz-checksum-* headers that older S3-compatible stores (e.g. MinIO)
    // don't include in their signature verification, causing SignatureDoesNotMatch.
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
        getLogger().info({ bucket: config.bucket }, "Created S3 bucket");
      } catch (createErr) {
        // Bucket may have been created by another process between head and create
        getLogger().warn(
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
      getLogger().debug(
        { key: params.key, bucket: config.bucket },
        "File stored (S3)",
      );
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
      getLogger().debug(
        { key, bucket: config.bucket },
        "File deleted (S3)",
      );
    },

    getUrl(key: string) {
      return `/api/files/${encodeURIComponent(key)}`;
    },
  };
}
