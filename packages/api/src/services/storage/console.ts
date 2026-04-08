import { getLogger } from "../../lib/logger.js";
import type { StorageAdapter } from "./types.js";

export function createConsoleStorageAdapter(): StorageAdapter {
  return {
    async upload(params) {
      getLogger().info(
        {
          key: params.key,
          filename: params.filename,
          sizeBytes: params.data.length,
        },
        "File uploaded (console adapter — not actually stored)",
      );
      return { storageKey: params.key, sizeBytes: params.data.length };
    },

    async download(key) {
      getLogger().info({ key }, "File download requested (console adapter)");
      return {
        data: Buffer.from(""),
        mimeType: "application/octet-stream",
        filename: "unknown",
      };
    },

    async delete(key) {
      getLogger().info({ key }, "File deleted (console adapter)");
    },

    getUrl(key) {
      return `/api/files/${key}`;
    },
  };
}
