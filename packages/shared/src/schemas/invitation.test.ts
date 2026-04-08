import { describe, expect, it } from "vitest";

import {
  CreateOrgInvitationSchema,
  InvitationStatusSchema,
  OrgInvitationListInputSchema,
  OrgInvitationSchema,
  ResendOrgInvitationSchema,
  RevokeOrgInvitationSchema,
} from "./invitation.js";

const validUuid = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

describe("InvitationStatusSchema", () => {
  it("accepts valid statuses", () => {
    for (const s of ["pending", "accepted", "revoked", "expired"]) {
      expect(InvitationStatusSchema.parse(s)).toBe(s);
    }
  });

  it("rejects invalid status", () => {
    expect(() => InvitationStatusSchema.parse("unknown")).toThrow();
  });
});

describe("CreateOrgInvitationSchema", () => {
  it("accepts valid input", () => {
    const result = CreateOrgInvitationSchema.parse({
      orgId: validUuid,
      email: "user@example.com",
      role: "member",
    });
    expect(result.orgId).toBe(validUuid);
    expect(result.email).toBe("user@example.com");
    expect(result.role).toBe("member");
  });

  it("lowercases the email", () => {
    const result = CreateOrgInvitationSchema.parse({
      orgId: validUuid,
      email: "User@EXAMPLE.COM",
      role: "admin",
    });
    expect(result.email).toBe("user@example.com");
  });

  it("rejects invalid email", () => {
    expect(() =>
      CreateOrgInvitationSchema.parse({
        orgId: validUuid,
        email: "not-an-email",
        role: "member",
      }),
    ).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => CreateOrgInvitationSchema.parse({})).toThrow();
    expect(() => CreateOrgInvitationSchema.parse({ orgId: validUuid })).toThrow();
    expect(() =>
      CreateOrgInvitationSchema.parse({ orgId: validUuid, email: "a@b.com" }),
    ).toThrow();
  });

  it("rejects invalid orgId uuid", () => {
    expect(() =>
      CreateOrgInvitationSchema.parse({
        orgId: "not-a-uuid",
        email: "a@b.com",
        role: "member",
      }),
    ).toThrow();
  });
});

describe("OrgInvitationSchema", () => {
  const validInvitation = {
    id: validUuid,
    orgId: validUuid,
    email: "user@example.com",
    role: "member",
    invitedBy: validUuid,
    status: "pending",
    expiresAt: new Date("2026-05-01"),
    createdAt: new Date("2026-04-01"),
  };

  it("accepts a valid invitation", () => {
    const result = OrgInvitationSchema.parse(validInvitation);
    expect(result.id).toBe(validUuid);
    expect(result.status).toBe("pending");
  });

  it("rejects invalid uuid on id", () => {
    expect(() =>
      OrgInvitationSchema.parse({ ...validInvitation, id: "bad" }),
    ).toThrow();
  });

  it("rejects invalid uuid on invitedBy", () => {
    expect(() =>
      OrgInvitationSchema.parse({ ...validInvitation, invitedBy: "bad" }),
    ).toThrow();
  });
});

describe("OrgInvitationListInputSchema", () => {
  it("accepts valid orgId", () => {
    const result = OrgInvitationListInputSchema.parse({ orgId: validUuid });
    expect(result.orgId).toBe(validUuid);
  });

  it("rejects invalid uuid", () => {
    expect(() =>
      OrgInvitationListInputSchema.parse({ orgId: "bad" }),
    ).toThrow();
  });
});

describe("RevokeOrgInvitationSchema", () => {
  it("accepts valid id", () => {
    expect(RevokeOrgInvitationSchema.parse({ id: validUuid }).id).toBe(validUuid);
  });

  it("rejects invalid uuid", () => {
    expect(() => RevokeOrgInvitationSchema.parse({ id: "bad" })).toThrow();
  });
});

describe("ResendOrgInvitationSchema", () => {
  it("accepts valid id", () => {
    expect(ResendOrgInvitationSchema.parse({ id: validUuid }).id).toBe(validUuid);
  });

  it("rejects invalid uuid", () => {
    expect(() => ResendOrgInvitationSchema.parse({ id: "bad" })).toThrow();
  });
});
