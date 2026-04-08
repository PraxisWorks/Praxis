import { useState, useCallback } from "react";

type UploadedAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  createdAt: string;
};

type UseFileUploadOptions = {
  apiUrl?: string;
  getAccessToken: () => Promise<string>;
};

export function useFileUpload({ apiUrl = "", getAccessToken }: UseFileUploadOptions) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (sessionId: string, file: File): Promise<UploadedAttachment | null> => {
      setIsUploading(true);
      setError(null);

      try {
        const token = await getAccessToken();
        const formData = new FormData();
        formData.append("sessionId", sessionId);
        formData.append("file", file);

        // Derive the base URL: if apiUrl is "/api/trpc", we need "/api/files/upload"
        const baseUrl = apiUrl.replace(/\/trpc$/, "");
        const uploadUrl = `${baseUrl}/files/upload`;

        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({ error: "Upload failed" }));
          const msg = body.error ?? `Upload failed (${response.status})`;
          setError(msg);
          return null;
        }

        const attachment = (await response.json()) as UploadedAttachment;
        return attachment;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        setError(msg);
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [apiUrl, getAccessToken],
  );

  const clearError = useCallback(() => setError(null), []);

  return { upload, isUploading, error, clearError };
}
