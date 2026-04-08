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
