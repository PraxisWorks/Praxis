// ── Webhook ─────────────────────────────────────────────────

export type RegisterWebhookParams = {
  owner: string;
  repo: string;
  url: string;
  secret: string;
  events: string[];
};

export type RegisterWebhookResult = {
  success: boolean;
  hookId?: number;
  error?: string;
};

export type DeleteWebhookParams = {
  owner: string;
  repo: string;
  hookId: number;
};

export type DeleteWebhookResult = {
  success: boolean;
  error?: string;
};

// ── Webhook signature ───────────────────────────────────────

export type VerifyWebhookSignatureParams = {
  payload: string;
  signature: string;
  secret: string;
};

export type VerifyWebhookSignatureResult = {
  valid: boolean;
  error?: string;
};

// ── Deployments ─────────────────────────────────────────────

export type ListDeploymentStatusesParams = {
  owner: string;
  repo: string;
  /** Optional ref (branch/tag/SHA) to filter deployments. */
  ref?: string;
  perPage?: number;
};

export type DeploymentStatus = {
  id: number;
  deploymentId: number;
  state: string;
  description: string | null;
  environment: string;
  createdAt: string;
};

export type ListDeploymentStatusesResult = {
  success: boolean;
  statuses?: DeploymentStatus[];
  error?: string;
};

// ── Adapter ─────────────────────────────────────────────────

export type GitHubAdapter = {
  registerWebhook(
    params: RegisterWebhookParams,
  ): Promise<RegisterWebhookResult>;
  deleteWebhook(params: DeleteWebhookParams): Promise<DeleteWebhookResult>;
  listDeploymentStatuses(
    params: ListDeploymentStatusesParams,
  ): Promise<ListDeploymentStatusesResult>;
  verifyWebhookSignature(
    params: VerifyWebhookSignatureParams,
  ): Promise<VerifyWebhookSignatureResult>;
};
