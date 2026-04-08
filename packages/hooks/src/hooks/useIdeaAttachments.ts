import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";

type SerializedIdeaAttachment = {
  id: string;
  ideaId: string;
  userId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  createdAt: string;
};

/**
 * Hook to manage attachments for a given idea.
 * Returns the attachment list, loading/error state, and a delete mutation.
 * Real-time sync keeps the list updated when attachments are added or removed.
 */
export function useIdeaAttachments(ideaId: string | null) {
  const utils = trpc.useUtils();
  const listQuery = trpc.idea.listAttachments.useQuery(
    { ideaId: ideaId! },
    { enabled: !!ideaId },
  );

  // Subscribe to real-time sync events for idea attachments
  useSyncSubscription<SerializedIdeaAttachment>(trpc.idea.onAttachmentSync, {
    onCreated: (data) => {
      if (data.ideaId !== ideaId) return;
      utils.idea.listAttachments.invalidate({ ideaId: ideaId! });
    },
    onDeleted: (data) => {
      if (data.ideaId !== ideaId) return;
      utils.idea.listAttachments.invalidate({ ideaId: ideaId! });
    },
  });

  const deleteMutation = trpc.idea.deleteAttachment.useMutation({
    onSuccess: () => {
      if (ideaId) {
        utils.idea.listAttachments.invalidate({ ideaId });
      }
    },
  });

  return {
    attachments: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    error: listQuery.error?.message ?? null,
    deleteAttachment: (id: string) => deleteMutation.mutateAsync({ id }),
    isDeleting: deleteMutation.isPending,
  };
}

/**
 * Standalone helper to upload a file to an idea.
 * Calls the POST /upload/idea Express endpoint directly.
 * Returns the created attachment metadata on success.
 */
export async function uploadIdeaFile(
  ideaId: string,
  file: File,
  token: string,
  apiUrl = "",
): Promise<SerializedIdeaAttachment> {
  const formData = new FormData();
  formData.append("ideaId", ideaId);
  formData.append("file", file);

  // Derive the base URL: if apiUrl is "/api/trpc", we need "/api/files/upload/idea"
  const baseUrl = apiUrl.replace(/\/trpc$/, "");
  const uploadUrl = `${baseUrl}/files/upload/idea`;

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(body.error ?? `Upload failed (${response.status})`);
  }

  return (await response.json()) as SerializedIdeaAttachment;
}
