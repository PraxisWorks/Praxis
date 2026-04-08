export type ValidateKeyResult = {
  valid: boolean;
  error?: string;
};

export type AnthropicAdapter = {
  validateKey(key: string): Promise<ValidateKeyResult>;
};
