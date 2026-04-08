import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (must be hoisted above imports) ────────────────────────

vi.mock("../db/index.js", () => ({
  getConnectionString: vi.fn(() => "postgresql://mock"),
  getDb: vi.fn(() => ({})),
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "mock-jwks"),
  jwtVerify: vi.fn().mockResolvedValue({
    payload: { sub: "user123", email: "test@example.com" },
    protectedHeader: { alg: "RS256" },
  }),
}));

vi.mock("../lib/requireOrgMember.js", () => ({
  requireOrgMember: vi
    .fn()
    .mockResolvedValue({ orgId: "mock", userId: "mock", role: "admin" }),
}));

vi.mock("../jobs/index.js", () => ({
  enqueueJob: vi.fn().mockResolvedValue("job-123"),
}));

vi.mock("../jobs/handlers/processOrgInvitation.js", () => ({
  PROCESS_ORG_INVITATION: "process-org-invitation",
}));

// ── Imports ──────────────────────────────────────────────────────

import { invitationRouter } from "./invitation.js";
import { requireOrgMember } from "../lib/requireOrgMember.js";
import { enqueueJob } from "../jobs/index.js";

// ── Helpers ──────────────────────────────────────────────────────

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const INVITATION_ID = "00000000-0000-4000-8000-000000000002";
const USER_ID = "00000000-0000-4000-8000-000000000003";

const dbUser = { id: USER_ID, sub: "user123", name: "Test User", email: "test@example.com" };

const pendingInvitation = {
  id: INVITATION_ID,
  orgId: ORG_ID,
  email: "invitee@example.com",
  role: "member",
  invitedBy: USER_ID,
  status: "pending",
  expiresAt: new Date(),
  createdAt: new Date(),
};

/**
 * Build a mock DB where each call to select() resolves to the next
 * entry in `selectResults`. This lets us satisfy the protectedProcedure
 * middleware lookup (1st select) and the actual router query (2nd select).
 */
function makeMockDb(selectResults: unknown[][], opts?: { onSet?: (args: unknown) => void }) {
  let selectCall = 0;

  function selectChain(): any {
    const idx = selectCall++;
    const rows = selectResults[idx] ?? [];
    // Return a full chainable object that resolves to rows at any terminal
    const chain: Record<string, any> = {};
    const self = () => chain;
    chain.from = self;
    chain.where = self;
    chain.limit = () => Promise.resolve(rows);
    chain.innerJoin = self;
    // For list (query-style), the chain is awaited directly after .where()
    // Make it thenable so `await db.select().from().innerJoin().where()` works
    chain.then = (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject);
    return chain;
  }

  const db: Record<string, any> = {
    select: selectChain,
    update: () => ({
      set: (args: unknown) => {
        opts?.onSet?.(args);
        return {
          where: () => Promise.resolve(),
        };
      },
    }),
  };

  return db;
}

function createCaller(selectResults: unknown[][], opts?: { onSet?: (args: unknown) => void }) {
  const db = makeMockDb(selectResults, opts);
  const caller = invitationRouter.createCaller({
    user: { sub: "user123" },
    db: db as any,
    pubsub: {} as any,
  } as any);
  return { caller, db };
}

// ── Tests ────────────────────────────────────────────────────────

describe("invitationRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("returns pending invitations for the org", async () => {
      const rows = [
        {
          id: INVITATION_ID,
          orgId: ORG_ID,
          email: "invitee@example.com",
          role: "member",
          status: "pending",
          expiresAt: new Date(),
          createdAt: new Date(),
          inviterName: "Alice",
        },
      ];

      // 1st select: protectedProcedure middleware looks up dbUser
      // 2nd select: the list query
      const { caller } = createCaller([[dbUser], rows]);

      const result = await caller.list({ orgId: ORG_ID });
      expect(result).toEqual(rows);
      expect(requireOrgMember).toHaveBeenCalledWith(
        expect.anything(),
        ORG_ID,
        USER_ID,
        "admin",
      );
    });
  });

  describe("revoke", () => {
    it("sets status to 'revoked' for a pending invitation", async () => {
      let setArgs: unknown = null;

      // 1st select: middleware dbUser lookup
      // 2nd select: find pending invitation
      const { caller, db } = createCaller(
        [[dbUser], [pendingInvitation]],
        { onSet: (args) => { setArgs = args; } },
      );

      const result = await caller.revoke({ id: INVITATION_ID });
      expect(result).toEqual({ success: true });
      expect(setArgs).toEqual({ status: "revoked" });
      expect(requireOrgMember).toHaveBeenCalledWith(
        db,
        ORG_ID,
        USER_ID,
        "admin",
      );
    });

    it("throws NOT_FOUND when invitation is not pending", async () => {
      // 1st select: middleware dbUser lookup
      // 2nd select: no invitation found
      const { caller } = createCaller([[dbUser], []]);

      await expect(caller.revoke({ id: INVITATION_ID })).rejects.toThrow(
        "Pending invitation not found",
      );
    });
  });

  describe("resend", () => {
    it("resets expiry and re-enqueues the job", async () => {
      let setArgs: unknown = null;

      const { caller } = createCaller(
        [[dbUser], [pendingInvitation]],
        { onSet: (args) => { setArgs = args; } },
      );

      const result = await caller.resend({ id: INVITATION_ID });
      expect(result).toEqual({ success: true });
      expect(setArgs).toHaveProperty("expiresAt");
      expect(enqueueJob).toHaveBeenCalledWith(
        "process-org-invitation",
        { invitationId: INVITATION_ID },
        { retryLimit: 3, retryDelay: 60 },
      );
    });

    it("throws NOT_FOUND when invitation is not pending", async () => {
      const { caller } = createCaller([[dbUser], []]);

      await expect(caller.resend({ id: INVITATION_ID })).rejects.toThrow(
        "Pending invitation not found",
      );
    });
  });
});
