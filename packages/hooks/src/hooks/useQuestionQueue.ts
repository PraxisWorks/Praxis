import { useCallback } from "react";
import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";

type SerializedSession = {
  id: string;
  repoId: string;
  userId: string;
  type: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export function useQuestionQueue(filters?: {
  repoId?: string;
  sessionId?: string;
  olderThanMinutes?: number;
}) {
  const utils = trpc.useUtils();

  const input: Record<string, unknown> = {};
  if (filters?.repoId) input.repoId = filters.repoId;
  if (filters?.sessionId) input.sessionId = filters.sessionId;
  if (filters?.olderThanMinutes) input.olderThanMinutes = filters.olderThanMinutes;

  const listQuery = trpc.session.listOpenQuestions.useQuery(input);
  const countQuery = trpc.session.openQuestionCount.useQuery(input);

  // Invalidate both queries on any session sync event
  useSyncSubscription<SerializedSession>(trpc.session.onSync, {
    onCreated: () => {
      utils.session.listOpenQuestions.invalidate();
      utils.session.openQuestionCount.invalidate();
    },
    onUpdated: () => {
      utils.session.listOpenQuestions.invalidate();
      utils.session.openQuestionCount.invalidate();
    },
    onDeleted: () => {
      utils.session.listOpenQuestions.invalidate();
      utils.session.openQuestionCount.invalidate();
    },
  });

  const answerQuestionMutation = trpc.session.answerQuestion.useMutation({
    onSuccess: () => {
      utils.session.listOpenQuestions.invalidate();
      utils.session.openQuestionCount.invalidate();
    },
  });

  const addMessageMutation = trpc.session.addMessage.useMutation();

  const answerQuestion = useCallback(
    async (sessionId: string, messageId: string, formattedResponse: string, selectedOptions: string[]) => {
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
    [answerQuestionMutation, addMessageMutation],
  );

  return {
    questions: listQuery.data ?? [],
    openCount: countQuery.data?.count ?? 0,
    isLoading: listQuery.isLoading || countQuery.isLoading,
    answerQuestion,
    isAnswering: answerQuestionMutation.isPending,
  };
}
