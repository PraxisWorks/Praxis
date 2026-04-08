import fs from "node:fs/promises";
import path from "node:path";
import { getLogger } from "../../lib/logger.js";
import type { StorageAdapter, UploadParams } from "./types.js";

export function createLocalStorageAdapter(baseDir: string): StorageAdapter {
  return {
    async upload(params: UploadParams) {
      const dir = path.join(baseDir, params.key.slice(0, 2));
      await fs.mkdir(dir, { recursive: true });
      const filePath = path.join(baseDir, params.key);
      await fs.writeFile(filePath, params.data);
      await fs.writeFile(
        `${filePath}.meta.json`,
        JSON.stringify({
          mimeType: params.mimeType,
          filename: params.filename,
        }),
      );
      getLogger().debug(
        { key: params.key, sizeBytes: params.data.length },
        "File stored (local)",
      );
      return { storageKey: params.key, sizeBytes: params.data.length };
    },

    async download(key: string) {
      const filePath = path.join(baseDir, key);
      const [data, metaRaw] = await Promise.all([
        fs.readFile(filePath),
        fs.readFile(`${filePath}.meta.json`, "utf-8"),
      ]);
      const meta = JSON.parse(metaRaw) as {
        mimeType: string;
        filename: string;
      };
      return { data, mimeType: meta.mimeType, filename: meta.filename };
    },

    async delete(key: string) {
      const filePath = path.join(baseDir, key);
      await fs.unlink(filePath).catch(() => {});
      await fs.unlink(`${filePath}.meta.json`).catch(() => {});
      getLogger().debug({ key }, "File deleted (local)");
    },

    getUrl(key: string) {
      return `/api/files/${key}`;
    },
  };
}
