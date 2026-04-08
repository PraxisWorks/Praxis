import { router } from "../trpc.js";
import { userRouter } from "./user.js";
import { adminRouter } from "./admin.js";
import { jobsRouter } from "./jobs.js";
import { notificationRouter } from "./notification.js";
import { organizationRouter } from "./organization.js";
import { repoRouter } from "./repo.js";
import { specRouter } from "./spec.js";
import { ideaRouter } from "./idea.js";
import { sessionRouter } from "./session.js";
import { planRouter } from "./plan.js";
import { taskRouter } from "./task.js";
import { deploymentRouter } from "./deployment.js";
import { ghDeploymentRouter } from "./ghDeployment.js";
import { ideaPhaseRouter } from "./ideaPhase.js";
import { workerRouter } from "./worker.js";
import { permissionRouter } from "./permission.js";
import { statsRouter } from "./stats.js";
import { apiKeyRouter } from "./apiKey.js";
import { invitationRouter } from "./invitation.js";

export const appRouter = router({
  user: userRouter,
  admin: adminRouter,
  jobs: jobsRouter,
  notification: notificationRouter,
  organization: organizationRouter,
  repo: repoRouter,
  spec: specRouter,
  idea: ideaRouter,
  ideaPhase: ideaPhaseRouter,
  session: sessionRouter,
  plan: planRouter,
  task: taskRouter,
  deployment: deploymentRouter,
  ghDeployment: ghDeploymentRouter,
  worker: workerRouter,
  permission: permissionRouter,
  stats: statsRouter,
  apiKey: apiKeyRouter,
  invitation: invitationRouter,
});

export type AppRouter = typeof appRouter;
