import { describe, it, expect, vi, beforeEach } from "vitest";
import { createConsoleAuth0MgmtAdapter } from "./console.js";

vi.mock("../../lib/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("createConsoleAuth0MgmtAdapter", () => {
  let adapter: ReturnType<typeof createConsoleAuth0MgmtAdapter>;

  beforeEach(() => {
    adapter = createConsoleAuth0MgmtAdapter();
  });

  describe("createUser", () => {
    it("returns a mock auth0UserId and created: true", async () => {
      const result = await adapter.createUser("test@example.com");

      expect(result.auth0UserId).toMatch(/^auth0\|console-\d+$/);
      expect(result.created).toBe(true);
    });
  });

  describe("changePasswordTicket", () => {
    it("returns a mock ticketUrl", async () => {
      const result = await adapter.changePasswordTicket("auth0|123");

      expect(result.ticketUrl).toBe(
        "https://example.com/change-password/mock-ticket",
      );
    });
  });

  describe("sendVerificationEmail", () => {
    it("returns { success: true }", async () => {
      const result = await adapter.sendVerificationEmail("auth0|123");

      expect(result).toEqual({ success: true });
    });
  });
});
