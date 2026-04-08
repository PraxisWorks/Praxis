export type CreateUserResult = {
  databaseUrl: string;
};

export type DbProvisioner = {
  createUser(userId: string, publicHost?: string): Promise<CreateUserResult>;
  deleteUser?(userId: string): Promise<void>;
};
