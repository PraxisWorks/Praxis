import { useCallback, useEffect, useState } from "react";
import { trpc } from "../trpc.js";
import type { SyncEvent } from "@praxis2/shared";

type SerializedMessage = {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  createdAt: string;
};

type ToolActivityEvent = {
  action: "tool_activity";
  data: {
    sessionId: string;
    toolName: string;
    label: string;
    _ephemeral: true;
  };
  timestamp: number;
};

type SessionData = {
  status: string;
  messages?: Array<{ role: string }>;
  metadata?: unknown;
} | null;

/**
 * Subscribes to a session-scoped message channel for real-time updates.
 * Does not maintain local message state -- relies on query invalidation
 * so the UI derives messages from the getById query (via useSession).
 *
 * Also tracks ephemeral tool_activity events so the UI can show a
 * "Reading files..." / "Searching code..." indicator while Claude works.
 *
 * Pass `session` so the hook can derive "thinking" state on mount/navigation
 * (e.g. session is active and last message is from user → AI must be working).
 */
export function useSessionMessages(sessionId: string | null, session?: SessionData) {
  const utils = trpc.useUtils();
  const [toolActivity, setToolActivity] = useState<string | null>(null);
  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false);

  // Derive initial state from session data on mount or navigation.
  // - If metadata.currentActivity is set, show that tool label
  // - If session is active and last message is from user, show "thinking"
  useEffect(() => {
    const meta = session?.metadata as Record<string, unknown> | null | undefined;
    const activity = meta?.currentActivity;
    if (session?.status === "active" && typeof activity === "string") {
      setToolActivity(activity);
      setIsWaitingForResponse(false);
    } else if (session && session.status === "active" && session.messages?.length) {
      setToolActivity(null);
      const lastMsg = session.messages[session.messages.length - 1];
      setIsWaitingForResponse(lastMsg.role === "user");
    } else {
      setToolActivity(null);
      setIsWaitingForResponse(false);
    }
  }, [sessionId, session?.status, session?.messages?.length, (session?.metadata as Record<string, unknown> | null | undefined)?.currentActivity]);

  trpc.session.onMessages.useSubscription(
    { sessionId: sessionId! },
    {
      enabled: !!sessionId,
      onData(event: { data: SyncEvent }) {
        const payload = event.data as unknown as
          | SyncEvent<SerializedMessage>
          | ToolActivityEvent;

        if (payload.action === "tool_activity") {
          const { label } = (payload as ToolActivityEvent).data;
          setToolActivity(label);
          // Any activity means Claude is responding — no longer "waiting"
          setIsWaitingForResponse(false);
          return;
        }

        if (payload.action === "created") {
          const msg = (payload as SyncEvent<SerializedMessage>).data;
          // Only clear indicators when a non-user message arrives.
          // The user's own message sync event fires immediately after send,
          // which would clear "AI is thinking..." before Claude responds.
          if (msg?.role && msg.role !== "user") {
            setToolActivity(null);
            setIsWaitingForResponse(false);
          }
          utils.session.getById.invalidate({ id: sessionId! });
        }
      },
    },
  );

  const addMessageMutation = trpc.session.addMessage.useMutation({
    onSuccess: () => {
      utils.session.getById.invalidate({ id: sessionId! });
    },
  });

  const sendMessage = useCallback(
    async (content: string, attachmentIds?: string[]) => {
      if (!sessionId) return;
      setIsWaitingForResponse(true);
      return addMessageMutation.mutateAsync({
        sessionId,
        content,
        ...(attachmentIds?.length ? { attachmentIds } : {}),
      });
    },
    [sessionId, addMessageMutation],
  );

  const answerQuestionMutation = trpc.session.answerQuestion.useMutation({
    onSuccess: () => {
      utils.session.getById.invalidate({ id: sessionId! });
    },
  });

  const answerQuestion = useCallback(
    async (messageId: string, formattedResponse: string, selectedOptions: string[]) => {
      if (!sessionId) return;
      // 1. Mark the question as answered
      await answerQuestionMutation.mutateAsync({
        sessionId,
        messageId,
        selectedOptions,
        formattedResponse,
      });
      // 2. Send the formatted response as a user message (so Claude sees the answer)
      await addMessageMutation.mutateAsync({
        sessionId,
        content: formattedResponse,
      });
    },
    [sessionId, answerQuestionMutation, addMessageMutation],
  );

  return {
    sendMessage,
    answerQuestion,
    isSending: addMessageMutation.isPending,
    isWaitingForResponse,
    toolActivity,
  };
}
