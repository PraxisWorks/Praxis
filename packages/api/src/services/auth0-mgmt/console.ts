import { getLogger } from "../../lib/logger.js";
import type { Auth0MgmtAdapter } from "./types.js";

export function createConsoleAuth0MgmtAdapter(): Auth0MgmtAdapter {
  return {
    async createUser(email) {
      const auth0UserId = `auth0|console-${Date.now()}`;
      getLogger().info(
        { email, auth0UserId },
        "Auth0 user created (console adapter — not actually created)",
      );
      return { auth0UserId, created: true };
    },

    async changePasswordTicket(auth0UserId, _email) {
      const ticketUrl = "https://example.com/change-password/mock-ticket";
      getLogger().info(
        { auth0UserId, ticketUrl },
        "Password change ticket created (console adapter — not actually created)",
      );
      return { ticketUrl };
    },

    async sendVerificationEmail(auth0UserId) {
      getLogger().info(
        { auth0UserId },
        "Verification email sent (console adapter — not actually sent)",
      );
      return { success: true };
    },
  };
}
