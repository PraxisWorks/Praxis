import { randomUUID } from "node:crypto";
import { getLogger } from "../../lib/logger.js";
import type { Auth0MgmtAdapter } from "./types.js";

type Auth0Config = {
  domain: string;
  clientId: string;
  clientSecret: string;
};

type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

type Auth0User = {
  user_id: string;
  email: string;
};

type Auth0TicketResponse = {
  ticket: string;
};

export function createAuth0MgmtAdapter(config: Auth0Config): Auth0MgmtAdapter {
  let cachedToken: string | null = null;
  let tokenExpiresAt = 0;

  async function getAccessToken(): Promise<string> {
    if (cachedToken && Date.now() < tokenExpiresAt) {
      return cachedToken;
    }

    const response = await fetch(`https://${config.domain}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        audience: `https://${config.domain}/api/v2/`,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      getLogger().error(
        { status: response.status, body },
        "Auth0 token exchange failed",
      );
      throw new Error(`Auth0 token exchange failed: ${response.status}`);
    }

    const json = (await response.json()) as TokenResponse;
    cachedToken = json.access_token;
    // Expire 60s early to avoid edge cases
    tokenExpiresAt = Date.now() + (json.expires_in - 60) * 1000;
    return cachedToken;
  }

  return {
    async createUser(email) {
      const token = await getAccessToken();

      const createResponse = await fetch(
        `https://${config.domain}/api/v2/users`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email,
            connection: "Username-Password-Authentication",
            password: randomUUID(),
            email_verified: true,
          }),
        },
      );

      if (createResponse.ok) {
        const user = (await createResponse.json()) as Auth0User;
        getLogger().info({ email, userId: user.user_id }, "Auth0 user created");
        return { auth0UserId: user.user_id, created: true };
      }

      if (createResponse.status === 409) {
        getLogger().info(
          { email },
          "Auth0 user already exists, looking up by email",
        );

        const lookupResponse = await fetch(
          `https://${config.domain}/api/v2/users-by-email?email=${encodeURIComponent(email)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        if (!lookupResponse.ok) {
          const body = await lookupResponse.text();
          getLogger().error(
            { status: lookupResponse.status, body },
            "Auth0 user lookup by email failed",
          );
          throw new Error(
            `Auth0 user lookup failed: ${lookupResponse.status}`,
          );
        }

        const users = (await lookupResponse.json()) as Auth0User[];
        if (users.length === 0) {
          throw new Error(
            `Auth0 returned 409 but no user found for email: ${email}`,
          );
        }

        return { auth0UserId: users[0].user_id, created: false };
      }

      const body = await createResponse.text();
      getLogger().error(
        { status: createResponse.status, body },
        "Auth0 create user failed",
      );
      throw new Error(`Auth0 create user failed: ${createResponse.status}`);
    },

    async changePasswordTicket(auth0UserId, email) {
      // Use Auth0's public /dbconnections/change_password endpoint
      // which sends the password reset email natively via Auth0's email template.
      const response = await fetch(
        `https://${config.domain}/dbconnections/change_password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: config.clientId,
            email,
            connection: "Username-Password-Authentication",
          }),
        },
      );

      if (!response.ok) {
        const body = await response.text();
        getLogger().error(
          { status: response.status, body },
          "Auth0 change password email failed",
        );
        throw new Error(
          `Auth0 change password email failed: ${response.status}`,
        );
      }

      getLogger().info(
        { auth0UserId, email },
        "Auth0 password reset email sent",
      );
      return { ticketUrl: `https://${config.domain}/u/reset-verify` };
    },

    async sendVerificationEmail(auth0UserId) {
      try {
        const token = await getAccessToken();

        const response = await fetch(
          `https://${config.domain}/api/v2/jobs/verification-email`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ user_id: auth0UserId }),
          },
        );

        if (!response.ok) {
          const body = await response.text();
          getLogger().error(
            { status: response.status, body, auth0UserId },
            "Auth0 send verification email failed",
          );
          return { success: false };
        }

        getLogger().info(
          { auth0UserId },
          "Auth0 verification email sent",
        );
        return { success: true };
      } catch (error) {
        getLogger().error(
          { error, auth0UserId },
          "Auth0 send verification email error",
        );
        return { success: false };
      }
    },
  };
}
