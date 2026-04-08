import { describe, it, expect, vi, beforeEach } from "vitest";

/* ------------------------------------------------------------------ */
/* Mocks — must be declared before the handler import                  */
/* ------------------------------------------------------------------ */

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();

vi.mock("../../db/index.js", () => ({
  getDb: () => ({
    select: mockSelect,
  }),
}));

const mockCreateUser = vi.fn();
const mockChangePasswordTicket = vi.fn();

vi.mock("../../services/auth0-mgmt/index.js", () => ({
  getAuth0MgmtAdapter: () => ({
    createUser: mockCreateUser,
    changePasswordTicket: mockChangePasswordTicket,
  }),
}));

vi.mock("../../lib/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("../../db/schema.js", () => ({
  orgInvitations: { id: "org_invitations.id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ col: _col, val })),
}));

/* ------------------------------------------------------------------ */
/* Import handler under test                                           */
/* ------------------------------------------------------------------ */

import {
  registerProcessOrgInvitationHandler,
  PROCESS_ORG_INVITATION,
} from "./processOrgInvitation.js";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function chainQuery(rows: unknown[]) {
  mockLimit.mockResolvedValue(rows);
  mockWhere.mockReturnValue({ limit: mockLimit });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });
}

/** Capture the work callback registered with pg-boss */
async function captureHandler() {
  let handler!: (jobs: { id: string; data: unknown }[]) => Promise<void>;
  const bossMock = {
    work: vi.fn(
      (
        _name: string,
        fn: (jobs: { id: string; data: unknown }[]) => Promise<void>,
      ) => {
        handler = fn;
      },
    ),
  } as unknown as import("pg-boss");

  await registerProcessOrgInvitationHandler(bossMock);
  expect(bossMock.work).toHaveBeenCalledWith(
    PROCESS_ORG_INVITATION,
    expect.any(Function),
  );
  return handler;
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("processOrgInvitation handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports the correct job name constant", () => {
    expect(PROCESS_ORG_INVITATION).toBe("process-org-invitation");
  });

  it("calls createUser and changePasswordTicket with correct params", async () => {
    const handler = await captureHandler();

    chainQuery([{ id: "inv-1", email: "alice@example.com" }]);
    mockCreateUser.mockResolvedValue({
      auth0UserId: "auth0|abc",
      created: true,
    });
    mockChangePasswordTicket.mockResolvedValue({
      ticketUrl: "https://auth0.example.com/ticket",
    });

    await handler([{ id: "job-1", data: { invitationId: "inv-1" } }]);

    expect(mockCreateUser).toHaveBeenCalledWith("alice@example.com");
    expect(mockChangePasswordTicket).toHaveBeenCalledWith("auth0|abc", "alice@example.com");
  });

  it("handles missing invitation gracefully", async () => {
    const handler = await captureHandler();

    chainQuery([]);

    await handler([{ id: "job-2", data: { invitationId: "missing" } }]);

    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(mockChangePasswordTicket).not.toHaveBeenCalled();
  });

  it("propagates adapter errors so pg-boss can retry", async () => {
    const handler = await captureHandler();

    chainQuery([{ id: "inv-2", email: "bob@example.com" }]);
    mockCreateUser.mockRejectedValue(new Error("Auth0 unavailable"));

    await expect(
      handler([{ id: "job-3", data: { invitationId: "inv-2" } }]),
    ).rejects.toThrow("Auth0 unavailable");
  });
});
