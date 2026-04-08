import { z } from "zod";

export const ServiceSchema = z.enum(["api", "worker", "web", "mobile"]);
export type Service = z.infer<typeof ServiceSchema>;

export const RegisterDeploymentSchema = z.object({
  service: ServiceSchema,
  gitSha: z.string().min(7, "Git SHA must be at least 7 characters").max(40, "Git SHA must be at most 40 characters"),
  deployedAt: z.coerce.date(),
});

export const DeploymentSchema = RegisterDeploymentSchema.extend({
  id: z.string().uuid(),
  createdAt: z.date(),
});

export type Deployment = z.infer<typeof DeploymentSchema>;
export type RegisterDeployment = z.infer<typeof RegisterDeploymentSchema>;
