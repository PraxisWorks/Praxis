import { getEnv } from "../../lib/env.js";
import { getLogger } from "../../lib/logger.js";
import type { Auth0MgmtAdapter } from "./types.js";
import { createConsoleAuth0MgmtAdapter } from "./console.js";
import { createAuth0MgmtAdapter } from "./auth0.js";

export type {
  Auth0MgmtAdapter,
  CreateUserResult,
  ChangePasswordTicketResult,
  SendVerificationEmailResult,
} from "./types.js";

let instance: Auth0MgmtAdapter | null = null;

export function getAuth0MgmtAdapter(): Auth0MgmtAdapter {
  if (instance) return instance;

  const env = getEnv();
  const domain = (env as Record<string, string | undefined>)
    .AUTH0_MGMT_DOMAIN;

  if (domain) {
    const clientId = (env as Record<string, string | undefined>)
      .AUTH0_MGMT_CLIENT_ID;
    const clientSecret = (env as Record<string, string | undefined>)
      .AUTH0_MGMT_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error(
        "AUTH0_MGMT_DOMAIN is set but AUTH0_MGMT_CLIENT_ID and AUTH0_MGMT_CLIENT_SECRET are also required",
      );
    }

    getLogger().info("Auth0 Management adapter: Auth0");
    instance = createAuth0MgmtAdapter({ domain, clientId, clientSecret });
  } else {
    getLogger().info(
      "Auth0 Management adapter: console (no AUTH0_MGMT_DOMAIN set)",
    );
    instance = createConsoleAuth0MgmtAdapter();
  }

  return instance;
}

export function setAuth0MgmtAdapter(adapter: Auth0MgmtAdapter): void {
  instance = adapter;
}

export function resetAuth0MgmtAdapter(): void {
  instance = null;
}
