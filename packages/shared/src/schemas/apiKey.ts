import { z } from "zod";

export const ApiKeyStatusEnum = z.enum([
  "active",
  "provisioning",
  "error",
  "revoked",
]);
export type ApiKeyStatus = z.infer<typeof ApiKeyStatusEnum>;

// Input schema for creating a new API key. Only user-provided fields.
export const CreateApiKeySchema = z.object({
  label: z.string().min(1, "Label is required").max(100),
  key: z.string().refine((val) => val.startsWith("sk-ant-"), {
    message: "Key must start with sk-ant-",
  }),
});

// Full API key schema as returned from the API. Server-managed fields only.
export const ApiKeySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  label: z.string(),
  keyLastFour: z.string().length(4),
  status: ApiKeyStatusEnum.default("active"),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type ApiKey = z.infer<typeof ApiKeySchema>;
export type CreateApiKey = z.infer<typeof CreateApiKeySchema>;
