import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all the per-handler registration functions BEFORE importing the
// module under test, so we can assert which queue names they were called on.
const mockRegisterRepoCreate = vi.fn().mockResolvedValue(undefined);
const mockRegisterRepoBuildDevice = vi.fn().mockResolvedValue(undefined);
const mockRegisterSessionStart = vi.fn().mockResolvedValue(undefined);
const mockRegisterSessionMessage = vi.fn().mockResolvedValue(undefined);
const mockRegisterSessionStop = vi.fn().mockResolvedValue(undefined);

vi.mock("./repo-create.js", () => ({
  registerRepoCreateHandler: (...args: unknown[]) => mockRegisterRepoCreate(...args),
}));
vi.mock("./repo-build-device.js", () => ({
  registerRepoBuildDeviceHandler: (...args: unknown[]) =>
    mockRegisterRepoBuildDevice(...args),
}));
vi.mock("./session-start.js", () => ({
  registerSessionStartHandler: (...args: unknown[]) => mockRegisterSessionStart(...args),
}));
vi.mock("./session-message.js", () => ({
  registerSessionMessageHandler: (...args: unknown[]) =>
    mockRegisterSessionMessage(...args),
}));
vi.mock("./session-stop.js", () => ({
  registerSessionStopHandler: (...args: unknown[]) => mockRegisterSessionStop(...args),
}));

vi.mock("../logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { registerAllHandlers } from "./index.js";

function buildMockConnection() {
  return {
    createQueue: vi.fn().mockResolvedValue(undefined),
    onJob: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe("registerAllHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("local worker registers repo handlers on BOTH unscoped and scoped queues", async () => {
    const connection = buildMockConnection();
    const workerId = "1812683e-3a2e-4e34-a937-00c5c43515d5";

    await registerAllHandlers(connection, {} as any, {} as any, workerId);

    const createdQueues = connection.createQueue.mock.calls.map((c: any[]) => c[0]);
    expect(createdQueues).toEqual(
      expect.arrayContaining([
        "repo.create",
        "repo.build-device",
        `repo.create.${workerId}`,
        `repo.build-device.${workerId}`,
      ]),
    );

    // Repo create handler registered on both bare and scoped names.
    const repoCreateCalls = mockRegisterRepoCreate.mock.calls.map((c) => c[1]);
    expect(repoCreateCalls).toEqual(
      expect.arrayContaining(["repo.create", `repo.create.${workerId}`]),
    );

    // Repo build-device handler registered on both bare and scoped names.
    const repoBuildCalls = mockRegisterRepoBuildDevice.mock.calls.map((c) => c[1]);
    expect(repoBuildCalls).toEqual(
      expect.arrayContaining(["repo.build-device", `repo.build-device.${workerId}`]),
    );
  });

  it("central worker (no workerId) uses CENTRAL_UUID-scoped repo queues", async () => {
    const connection = buildMockConnection();
    const CENTRAL_UUID = "00000000-0000-0000-0000-000000000000";

    await registerAllHandlers(connection, {} as any, {} as any, undefined);

    const createdQueues = connection.createQueue.mock.calls.map((c: any[]) => c[0]);
    expect(createdQueues).toEqual(
      expect.arrayContaining([
        "repo.create",
        `repo.create.${CENTRAL_UUID}`,
        "repo.build-device",
        `repo.build-device.${CENTRAL_UUID}`,
      ]),
    );

    const repoCreateCalls = mockRegisterRepoCreate.mock.calls.map((c) => c[1]);
    expect(repoCreateCalls).toEqual(
      expect.arrayContaining(["repo.create", `repo.create.${CENTRAL_UUID}`]),
    );
  });
});
