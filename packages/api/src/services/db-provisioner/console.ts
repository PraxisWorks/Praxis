import type { DbProvisioner } from "./types.js";

export function createConsoleDbProvisioner(): DbProvisioner {
  return {
    async createUser(userId: string, publicHost?: string) {
      console.log(`[console-db-provisioner] createUser(${userId}, ${publicHost})`);
      return { databaseUrl: `postgresql://praxis_worker_${userId}:fake@localhost:5432/praxis` };
    },
    async deleteUser(userId: string) {
      console.log(`[console-db-provisioner] deleteUser(${userId})`);
    },
  };
}
