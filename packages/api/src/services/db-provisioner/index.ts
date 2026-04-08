import { getEnv } from "../../lib/env.js";
import { getLogger } from "../../lib/logger.js";
import type { DbProvisioner } from "./types.js";
import { createSqlProvisioner } from "./sql.js";
import { createDigitalOceanProvisioner } from "./digitalocean.js";

export type { DbProvisioner, CreateUserResult } from "./types.js";

let instance: DbProvisioner | null = null;

export function getDbProvisioner(): DbProvisioner {
  if (instance) return instance;

  const env = getEnv();
  const provisioner = (env as Record<string, string | undefined>)
    .DB_PROVISIONER ?? "sql";

  if (provisioner === "digitalocean") {
    const apiToken = (env as Record<string, string | undefined>).DO_API_TOKEN;
    const clusterId = (env as Record<string, string | undefined>)
      .DO_DB_CLUSTER_ID;

    if (!apiToken || !clusterId) {
      throw new Error(
        "DB_PROVISIONER is 'digitalocean' but DO_API_TOKEN and DO_DB_CLUSTER_ID are also required",
      );
    }

    getLogger().info("DbProvisioner adapter: DigitalOcean");
    instance = createDigitalOceanProvisioner({ apiToken, clusterId });
  } else {
    getLogger().info("DbProvisioner adapter: SQL");
    instance = createSqlProvisioner({});
  }

  return instance;
}

export function setDbProvisioner(adapter: DbProvisioner): void {
  instance = adapter;
}

export function resetDbProvisioner(): void {
  instance = null;
}
