import { describe, it, expect, vi, beforeEach } from "vitest";
import { notifyPraxisEvent } from "./praxis.js";

vi.mock("./index.js", () => ({
  sendNotification: vi.fn().mockResolvedValue({
    notificationIds: ["n1"],
    pushResults: { sent: 0, skipped: 0, failed: 0 },
  }),
}));

import { sendNotification } from "./index.js";

const mockDb = {} as any;
const mockPubsub = {} as any;

describe("notifyPraxisEvent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("epic_completed calls sendNotification with correct params", async () => {
    await notifyPraxisEvent(mockDb, mockPubsub, {
      type: "epic_completed",
      userId: "u1",
      repoId: "r1",
      repoName: "my-app",
      epicId: "e1",
      epicTitle: "Auth Epic",
    });
    expect(sendNotification).toHaveBeenCalledWith(mockDb, mockPubsub, { userId: "u1" },
      expect.objectContaining({ title: expect.stringContaining("Auth Epic"), repoId: "r1" }));
  });

  it("task_blocked includes actionUrl with taskId", async () => {
    await notifyPraxisEvent(mockDb, mockPubsub, {
      type: "task_blocked",
      userId: "u1",
      repoId: "r1",
      repoName: "my-app",
      taskId: "b1",
      taskTitle: "Fix login",
    });
    expect(sendNotification).toHaveBeenCalledWith(mockDb, mockPubsub, { userId: "u1" },
      expect.objectContaining({ actionUrl: expect.stringContaining("b1") }));
  });

  it("working_session_finished creates success notification", async () => {
    await notifyPraxisEvent(mockDb, mockPubsub, {
      type: "working_session_finished",
      userId: "u1",
      repoId: "r1",
      repoName: "my-app",
      sessionId: "s1",
      taskTitle: "Auth module",
    });
    expect(sendNotification).toHaveBeenCalledWith(mockDb, mockPubsub, { userId: "u1" },
      expect.objectContaining({ title: expect.stringContaining("Work complete"), body: expect.stringContaining("finished successfully") }));
  });

  it("working_session_error includes error message in body", async () => {
    await notifyPraxisEvent(mockDb, mockPubsub, {
      type: "working_session_error",
      userId: "u1",
      repoId: "r1",
      repoName: "my-app",
      sessionId: "s1",
      taskTitle: "Auth module",
      error: "Timeout after 30s",
    });
    expect(sendNotification).toHaveBeenCalledWith(mockDb, mockPubsub, { userId: "u1" },
      expect.objectContaining({ body: expect.stringContaining("Timeout after 30s") }));
  });
});
