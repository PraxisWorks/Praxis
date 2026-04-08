import { describe, it, expect } from "vitest";
import {
  WorkerPolicySchema,
  SetWorkerPolicySchema,
  SetMemberWorkerSchema,
  AiInstructionsSessionTypeSchema,
  SetAiInstructionsSchema,
  AiInstructionsSchema,
  SetSystemInstructionsSchema,
  SystemInstructionsResponseSchema,
  OrgRigTemplateSchema,
  SetOrgRigTemplateSchema,
} from "./organization.js";

const validUuid = "550e8400-e29b-41d4-a716-446655440000";
const validUuid2 = "660e8400-e29b-41d4-a716-446655440000";

describe("WorkerPolicySchema", () => {
  it("accepts user_default", () => {
    expect(WorkerPolicySchema.safeParse("user_default").success).toBe(true);
  });

  it("accepts require_local", () => {
    expect(WorkerPolicySchema.safeParse("require_local").success).toBe(true);
  });

  it("accepts central_worker", () => {
    expect(WorkerPolicySchema.safeParse("central_worker").success).toBe(true);
  });

  it("rejects invalid policy", () => {
    expect(WorkerPolicySchema.safeParse("invalid").success).toBe(false);
    expect(WorkerPolicySchema.safeParse("").success).toBe(false);
    expect(WorkerPolicySchema.safeParse(123).success).toBe(false);
  });
});

describe("SetWorkerPolicySchema", () => {
  it("accepts valid input with policy only", () => {
    const result = SetWorkerPolicySchema.safeParse({
      orgId: validUuid,
      policy: "user_default",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid input with centralWorkerId", () => {
    const result = SetWorkerPolicySchema.safeParse({
      orgId: validUuid,
      policy: "central_worker",
      centralWorkerId: validUuid2,
    });
    expect(result.success).toBe(true);
  });

  it("accepts null centralWorkerId", () => {
    const result = SetWorkerPolicySchema.safeParse({
      orgId: validUuid,
      policy: "user_default",
      centralWorkerId: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing orgId", () => {
    const result = SetWorkerPolicySchema.safeParse({
      policy: "user_default",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing policy", () => {
    const result = SetWorkerPolicySchema.safeParse({
      orgId: validUuid,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid orgId", () => {
    const result = SetWorkerPolicySchema.safeParse({
      orgId: "not-a-uuid",
      policy: "user_default",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid policy value", () => {
    const result = SetWorkerPolicySchema.safeParse({
      orgId: validUuid,
      policy: "invalid_policy",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid centralWorkerId", () => {
    const result = SetWorkerPolicySchema.safeParse({
      orgId: validUuid,
      policy: "central_worker",
      centralWorkerId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });
});

describe("SetMemberWorkerSchema", () => {
  it("accepts valid input", () => {
    const result = SetMemberWorkerSchema.safeParse({
      orgId: validUuid,
      workerId: validUuid2,
    });
    expect(result.success).toBe(true);
  });

  it("accepts null workerId", () => {
    const result = SetMemberWorkerSchema.safeParse({
      orgId: validUuid,
      workerId: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing orgId", () => {
    const result = SetMemberWorkerSchema.safeParse({
      workerId: validUuid2,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing workerId", () => {
    const result = SetMemberWorkerSchema.safeParse({
      orgId: validUuid,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid orgId", () => {
    const result = SetMemberWorkerSchema.safeParse({
      orgId: "not-a-uuid",
      workerId: validUuid2,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid workerId", () => {
    const result = SetMemberWorkerSchema.safeParse({
      orgId: validUuid,
      workerId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });
});

describe("AiInstructionsSessionTypeSchema", () => {
  it("accepts all valid session types", () => {
    for (const t of ["working", "spec", "architecture", "debug", "repo"]) {
      expect(AiInstructionsSessionTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it("rejects invalid session types", () => {
    expect(AiInstructionsSessionTypeSchema.safeParse("invalid").success).toBe(false);
    expect(AiInstructionsSessionTypeSchema.safeParse("").success).toBe(false);
    expect(AiInstructionsSessionTypeSchema.safeParse(123).success).toBe(false);
  });
});

describe("SetAiInstructionsSchema", () => {
  it("accepts valid input for each session type", () => {
    for (const sessionType of ["working", "spec", "architecture", "debug", "repo"]) {
      const result = SetAiInstructionsSchema.safeParse({
        orgId: validUuid,
        sessionType,
        instructions: "Custom instructions here",
      });
      expect(result.success).toBe(true);
    }
  });

  it("accepts null instructions (clearing)", () => {
    const result = SetAiInstructionsSchema.safeParse({
      orgId: validUuid,
      sessionType: "working",
      instructions: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects strings over 10,000 chars", () => {
    const result = SetAiInstructionsSchema.safeParse({
      orgId: validUuid,
      sessionType: "working",
      instructions: "a".repeat(10001),
    });
    expect(result.success).toBe(false);
  });

  it("accepts exactly 10,000 chars", () => {
    const result = SetAiInstructionsSchema.safeParse({
      orgId: validUuid,
      sessionType: "working",
      instructions: "a".repeat(10000),
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid session type", () => {
    const result = SetAiInstructionsSchema.safeParse({
      orgId: validUuid,
      sessionType: "invalid_type",
      instructions: "test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing orgId", () => {
    const result = SetAiInstructionsSchema.safeParse({
      sessionType: "working",
      instructions: "test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid orgId", () => {
    const result = SetAiInstructionsSchema.safeParse({
      orgId: "not-a-uuid",
      sessionType: "working",
      instructions: "test",
    });
    expect(result.success).toBe(false);
  });
});

describe("AiInstructionsSchema", () => {
  it("accepts all fields as strings", () => {
    const result = AiInstructionsSchema.safeParse({
      aiInstructionsWorking: "working instructions",
      aiInstructionsSpec: "spec instructions",
      aiInstructionsArchitecture: "arch instructions",
      aiInstructionsDebug: "debug instructions",
      aiInstructionsRepo: "repo instructions",
    });
    expect(result.success).toBe(true);
  });

  it("accepts all fields as null", () => {
    const result = AiInstructionsSchema.safeParse({
      aiInstructionsWorking: null,
      aiInstructionsSpec: null,
      aiInstructionsArchitecture: null,
      aiInstructionsDebug: null,
      aiInstructionsRepo: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts mixed null and string fields", () => {
    const result = AiInstructionsSchema.safeParse({
      aiInstructionsWorking: "some instructions",
      aiInstructionsSpec: null,
      aiInstructionsArchitecture: null,
      aiInstructionsDebug: "debug instructions",
      aiInstructionsRepo: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("SetSystemInstructionsSchema", () => {
  it("accepts valid input for each session type", () => {
    for (const sessionType of ["working", "spec", "architecture", "debug", "repo"]) {
      const result = SetSystemInstructionsSchema.safeParse({
        orgId: validUuid,
        sessionType,
        instructions: "Custom system instructions here",
      });
      expect(result.success).toBe(true);
    }
  });

  it("accepts null instructions (clearing)", () => {
    const result = SetSystemInstructionsSchema.safeParse({
      orgId: validUuid,
      sessionType: "working",
      instructions: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects strings over 50,000 chars", () => {
    const result = SetSystemInstructionsSchema.safeParse({
      orgId: validUuid,
      sessionType: "working",
      instructions: "a".repeat(50001),
    });
    expect(result.success).toBe(false);
  });

  it("accepts exactly 50,000 chars", () => {
    const result = SetSystemInstructionsSchema.safeParse({
      orgId: validUuid,
      sessionType: "working",
      instructions: "a".repeat(50000),
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid session type", () => {
    const result = SetSystemInstructionsSchema.safeParse({
      orgId: validUuid,
      sessionType: "invalid_type",
      instructions: "test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing orgId", () => {
    const result = SetSystemInstructionsSchema.safeParse({
      sessionType: "working",
      instructions: "test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid orgId", () => {
    const result = SetSystemInstructionsSchema.safeParse({
      orgId: "not-a-uuid",
      sessionType: "working",
      instructions: "test",
    });
    expect(result.success).toBe(false);
  });
});

describe("SystemInstructionsResponseSchema", () => {
  it("accepts all fields as strings", () => {
    const result = SystemInstructionsResponseSchema.safeParse({
      systemInstructionsWorking: "working instructions",
      systemInstructionsSpec: "spec instructions",
      systemInstructionsArchitecture: "arch instructions",
      systemInstructionsDebug: "debug instructions",
      systemInstructionsRepo: "repo instructions",
    });
    expect(result.success).toBe(true);
  });

  it("accepts all fields as null", () => {
    const result = SystemInstructionsResponseSchema.safeParse({
      systemInstructionsWorking: null,
      systemInstructionsSpec: null,
      systemInstructionsArchitecture: null,
      systemInstructionsDebug: null,
      systemInstructionsRepo: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts mixed null and string fields", () => {
    const result = SystemInstructionsResponseSchema.safeParse({
      systemInstructionsWorking: "some instructions",
      systemInstructionsSpec: null,
      systemInstructionsArchitecture: null,
      systemInstructionsDebug: "debug instructions",
      systemInstructionsRepo: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("OrgRigTemplateSchema", () => {
  it("accepts valid owner/repo format", () => {
    const result = OrgRigTemplateSchema.safeParse({ templateRepo: "acme/template-repo" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.templateRepo).toBe("acme/template-repo");
  });

  it("rejects full URLs as templateRepo", () => {
    expect(OrgRigTemplateSchema.safeParse({ templateRepo: "https://github.com/acme/template" }).success).toBe(false);
  });

  it("rejects bare repo names", () => {
    expect(OrgRigTemplateSchema.safeParse({ templateRepo: "template-repo" }).success).toBe(false);
  });

  it("accepts valid initScripts paths", () => {
    const result = OrgRigTemplateSchema.safeParse({ initScripts: ["./scripts/init.sh", "./scripts/setup.sh"] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.initScripts).toEqual(["./scripts/init.sh", "./scripts/setup.sh"]);
  });

  it("rejects initScripts with .. segments", () => {
    expect(OrgRigTemplateSchema.safeParse({ initScripts: ["./scripts/../etc/passwd"] }).success).toBe(false);
  });

  it("rejects initScripts not starting with ./scripts/", () => {
    expect(OrgRigTemplateSchema.safeParse({ initScripts: ["/usr/bin/evil"] }).success).toBe(false);
  });

  it("allows both fields to be omitted", () => {
    const result = OrgRigTemplateSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("SetOrgRigTemplateSchema", () => {
  it("accepts valid input", () => {
    expect(SetOrgRigTemplateSchema.safeParse({ orgId: validUuid, templateRepo: "acme/t", initScripts: ["./scripts/init.sh"] }).success).toBe(true);
  });

  it("accepts null values for clearing", () => {
    const result = SetOrgRigTemplateSchema.safeParse({ orgId: validUuid, templateRepo: null, initScripts: null });
    expect(result.success).toBe(true);
  });

  it("rejects invalid orgId", () => {
    expect(SetOrgRigTemplateSchema.safeParse({ orgId: "bad", templateRepo: "a/b", initScripts: null }).success).toBe(false);
  });
});
