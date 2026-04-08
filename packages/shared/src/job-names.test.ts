import { describe, it, expect } from "vitest";
import {
  REPO_CREATE,
  REPO_BUILD_DEVICE,
  SESSION_START,
  SESSION_MESSAGE,
  SESSION_STOP,
  workerQueue,
} from "./job-names.js";

const WORKER_UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("job-names constants", () => {
  it("exports the expected queue names", () => {
    expect(REPO_CREATE).toBe("repo.create");
    expect(REPO_BUILD_DEVICE).toBe("repo.build-device");
    expect(SESSION_START).toBe("session.start");
    expect(SESSION_MESSAGE).toBe("session.message");
    expect(SESSION_STOP).toBe("session.stop");
  });
});

describe("workerQueue", () => {
  it("appends workerId to the job name", () => {
    expect(workerQueue(SESSION_START, WORKER_UUID)).toBe(
      `session.start.${WORKER_UUID}`,
    );
  });

  it("works with all session queue names", () => {
    expect(workerQueue(SESSION_START, WORKER_UUID)).toBe(`session.start.${WORKER_UUID}`);
    expect(workerQueue(SESSION_MESSAGE, WORKER_UUID)).toBe(`session.message.${WORKER_UUID}`);
    expect(workerQueue(SESSION_STOP, WORKER_UUID)).toBe(`session.stop.${WORKER_UUID}`);
  });

  it("works with repo queue names", () => {
    expect(workerQueue(REPO_CREATE, WORKER_UUID)).toBe(`repo.create.${WORKER_UUID}`);
    expect(workerQueue(REPO_BUILD_DEVICE, WORKER_UUID)).toBe(`repo.build-device.${WORKER_UUID}`);
  });

  it("handles arbitrary job names", () => {
    expect(workerQueue("custom.queue", "abc-123")).toBe("custom.queue.abc-123");
  });
});
