import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { createAuth0MgmtAdapter } from "./auth0.js";

vi.mock("../../lib/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

const CONFIG = {
  domain: "test.auth0.com",
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
};

function mockFetchResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("createAuth0MgmtAdapter", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  function stubTokenExchange() {
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(200, {
        access_token: "test-token",
        token_type: "Bearer",
        expires_in: 86400,
      }),
    );
  }

  describe("createUser", () => {
    it("exchanges token and creates user successfully", async () => {
      const adapter = createAuth0MgmtAdapter(CONFIG);
      stubTokenExchange();
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(200, {
          user_id: "auth0|new-user",
          email: "test@example.com",
        }),
      );

      const result = await adapter.createUser("test@example.com");

      expect(result).toEqual({
        auth0UserId: "auth0|new-user",
        created: true,
      });

      // Verify token exchange call
      expect(fetchMock).toHaveBeenCalledWith(
        "https://test.auth0.com/oauth/token",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("client_credentials"),
        }),
      );

      // Verify create user call
      expect(fetchMock).toHaveBeenCalledWith(
        "https://test.auth0.com/api/v2/users",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );
    });

    it("handles 409 by looking up existing user", async () => {
      const adapter = createAuth0MgmtAdapter(CONFIG);
      stubTokenExchange();
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(409, { message: "user already exists" }),
      );
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(200, [
          { user_id: "auth0|existing-user", email: "test@example.com" },
        ]),
      );

      const result = await adapter.createUser("test@example.com");

      expect(result).toEqual({
        auth0UserId: "auth0|existing-user",
        created: false,
      });

      // Verify lookup call
      expect(fetchMock).toHaveBeenCalledWith(
        "https://test.auth0.com/api/v2/users-by-email?email=test%40example.com",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );
    });

    it("throws on non-409 error", async () => {
      const adapter = createAuth0MgmtAdapter(CONFIG);
      stubTokenExchange();
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(500, { error: "server error" }),
      );

      await expect(adapter.createUser("test@example.com")).rejects.toThrow(
        "Auth0 create user failed: 500",
      );
    });

    it("caches the access token across calls", async () => {
      const adapter = createAuth0MgmtAdapter(CONFIG);
      stubTokenExchange();
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(200, {
          user_id: "auth0|user1",
          email: "a@example.com",
        }),
      );
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(200, {
          user_id: "auth0|user2",
          email: "b@example.com",
        }),
      );

      await adapter.createUser("a@example.com");
      await adapter.createUser("b@example.com");

      // Token exchange should only happen once
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tokenCalls = fetchMock.mock.calls.filter(
        (c: any[]) => String(c[0]).includes("/oauth/token"),
      );
      expect(tokenCalls).toHaveLength(1);
    });
  });

  describe("changePasswordTicket", () => {
    it("sends password reset email via dbconnections/change_password", async () => {
      const adapter = createAuth0MgmtAdapter(CONFIG);
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(200, "We've just sent you an email to reset your password."),
      );

      const result = await adapter.changePasswordTicket("auth0|user-1", "user@example.com");

      expect(result).toEqual({
        ticketUrl: "https://test.auth0.com/u/reset-verify",
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://test.auth0.com/dbconnections/change_password",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            client_id: "test-client-id",
            email: "user@example.com",
            connection: "Username-Password-Authentication",
          }),
        }),
      );
    });

    it("throws on error", async () => {
      const adapter = createAuth0MgmtAdapter(CONFIG);
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(400, { error: "bad request" }),
      );

      await expect(
        adapter.changePasswordTicket("auth0|user-1", "user@example.com"),
      ).rejects.toThrow("Auth0 change password email failed: 400");
    });
  });

  describe("sendVerificationEmail", () => {
    it("sends verification email successfully", async () => {
      const adapter = createAuth0MgmtAdapter(CONFIG);
      stubTokenExchange();
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(200, { type: "verification_email", status: "completed" }),
      );

      const result = await adapter.sendVerificationEmail("auth0|user-1");

      expect(result).toEqual({ success: true });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://test.auth0.com/api/v2/jobs/verification-email",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
          body: JSON.stringify({ user_id: "auth0|user-1" }),
        }),
      );
    });

    it("returns { success: false } on non-200 response", async () => {
      const adapter = createAuth0MgmtAdapter(CONFIG);
      stubTokenExchange();
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(400, { error: "bad request" }),
      );

      const result = await adapter.sendVerificationEmail("auth0|user-1");

      expect(result).toEqual({ success: false });
    });

    it("returns { success: false } on network error", async () => {
      const adapter = createAuth0MgmtAdapter(CONFIG);
      stubTokenExchange();
      fetchMock.mockRejectedValueOnce(new Error("network failure"));

      const result = await adapter.sendVerificationEmail("auth0|user-1");

      expect(result).toEqual({ success: false });
    });
  });

  describe("token exchange failure", () => {
    it("throws when token exchange fails", async () => {
      const adapter = createAuth0MgmtAdapter(CONFIG);
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(401, { error: "unauthorized" }),
      );

      await expect(adapter.createUser("test@example.com")).rejects.toThrow(
        "Auth0 token exchange failed: 401",
      );
    });
  });
});
