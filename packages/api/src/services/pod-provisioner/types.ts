export type CreatePodConfig = {
  name: string;
  namespace: string;
  template: string;
  secrets: Record<string, string>;
};

export type CreatePodResult = {
  podName: string;
  status: string;
};

export type DeletePodConfig = {
  name: string;
  namespace: string;
};

export type DeletePodResult = {
  success: boolean;
};

export type GetPodStatusConfig = {
  name: string;
  namespace: string;
};

export type GetPodStatusResult = {
  status: string;
  ready: boolean;
};

export type PodProvisionerAdapter = {
  createPod(config: CreatePodConfig): Promise<CreatePodResult>;
  deletePod(config: DeletePodConfig): Promise<DeletePodResult>;
  getPodStatus(config: GetPodStatusConfig): Promise<GetPodStatusResult>;
};
