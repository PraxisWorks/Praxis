/**
 * Ambient declaration for @praxis2/api/schema.
 *
 * In local dev, TypeScript resolves the schema via workspace symlinks
 * to the API source files. In Docker production builds, the API does
 * not emit .d.ts files (declaration: false), so this ambient module
 * declaration provides types for the Docker build.
 */
declare module "@praxis2/api/schema" {
  import type { PgTableWithColumns } from "drizzle-orm/pg-core";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type AnyTable = PgTableWithColumns<any>;

  export const users: AnyTable;
  export const organizations: AnyTable;
  export const notifications: AnyTable;
  export const pushTokens: AnyTable;
  export const rigs: AnyTable;
  export const ideas: AnyTable;
  export const specs: AnyTable;
  export const plans: AnyTable;
  export const epics: AnyTable;
  export const tasks: AnyTable;
  export const ideaPhases: AnyTable;
  export const taskDependencies: AnyTable;
  export const sessions: AnyTable;
  export const sessionMessages: AnyTable;
  export const sessionAttachments: AnyTable;
  export const deployments: AnyTable;
}

/**
 * Ambient declaration for @praxis2/api/lib/propagateTaskStatus.
 */
declare module "@praxis2/api/lib/propagateTaskStatus" {
  export type Logger = {
    info: (obj: Record<string, unknown>, msg: string) => void;
    warn: (obj: Record<string, unknown>, msg: string) => void;
    error: (obj: Record<string, unknown>, msg: string) => void;
    child: (bindings: Record<string, unknown>) => Logger;
  };

  export function propagateInProgressUp(
    db: any,
    pubsub: any,
    parentId: string | null,
    ideaId: string | null,
    logger?: Logger,
  ): Promise<void>;

  export function propagateCompleteUp(
    db: any,
    pubsub: any,
    parentId: string | null,
    ideaId: string | null,
    logger?: Logger,
  ): Promise<void>;
}

/**
 * Ambient declaration for @praxis2/api/services/storage.
 */
declare module "@praxis2/api/services/storage" {
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
    download(key: string): Promise<{ data: Buffer; mimeType: string; filename: string }>;
    delete(key: string): Promise<void>;
    getUrl(key: string): string;
  };

  export function getStorageAdapter(): StorageAdapter;
  export function setStorageAdapter(adapter: StorageAdapter): void;
  export function resetStorageAdapter(): void;
}
