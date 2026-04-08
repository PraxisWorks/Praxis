import type { Context } from "../../context.js";
import type { PgPubSub } from "../../pubsub.js";
import { sendNotification } from "./index.js";

type Db = Context["db"];

type PraxisEventType =
  | "epic_completed"
  | "working_session_finished"
  | "working_session_error"
  | "task_blocked";

type PraxisEventParams = {
  userId: string;
  repoId: string;
  repoName: string;
} & (
  | { type: "epic_completed"; epicId: string; epicTitle: string }
  | { type: "working_session_finished"; sessionId: string; taskTitle: string }
  | { type: "working_session_error"; sessionId: string; taskTitle: string; error: string }
  | { type: "task_blocked"; taskId: string; taskTitle: string }
);

const EVENT_TEMPLATES: Record<PraxisEventType, (p: any) => { title: string; body: string; actionUrl: string }> = {
  epic_completed: (p) => ({
    title: `Epic completed: ${p.epicTitle}`,
    body: `All tasks in "${p.epicTitle}" (${p.repoName}) are complete.`,
    actionUrl: `/board?task=${p.epicId}`,
  }),
  working_session_finished: (p) => ({
    title: `Work complete: ${p.taskTitle}`,
    body: `Working session for "${p.taskTitle}" (${p.repoName}) finished successfully.`,
    actionUrl: `/board?task=${p.sessionId}`,
  }),
  working_session_error: (p) => ({
    title: `Work error: ${p.taskTitle}`,
    body: `Working session for "${p.taskTitle}" (${p.repoName}) encountered an error: ${p.error}`,
    actionUrl: `/board?task=${p.sessionId}`,
  }),
  task_blocked: (p) => ({
    title: `Task blocked: ${p.taskTitle}`,
    body: `"${p.taskTitle}" (${p.repoName}) has been marked as blocked.`,
    actionUrl: `/board?task=${p.taskId}`,
  }),
};

export async function notifyPraxisEvent(
  db: Db,
  pubsub: PgPubSub,
  params: PraxisEventParams,
) {
  const template = EVENT_TEMPLATES[params.type](params);
  return sendNotification(db, pubsub, { userId: params.userId }, {
    ...template,
    repoId: params.repoId,
  });
}

export type { PraxisEventType, PraxisEventParams };
