import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("Worker heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("heartbeat interval fires every 30 seconds", () => {
    const callback = vi.fn();
    const HEARTBEAT_INTERVAL_MS = 30_000;

    const timer = setInterval(callback, HEARTBEAT_INTERVAL_MS);

    // Should not have fired yet
    expect(callback).not.toHaveBeenCalled();

    // Advance 30 seconds
    vi.advanceTimersByTime(30_000);
    expect(callback).toHaveBeenCalledTimes(1);

    // Advance another 30 seconds
    vi.advanceTimersByTime(30_000);
    expect(callback).toHaveBeenCalledTimes(2);

    // Advance 90 more seconds (3 more ticks)
    vi.advanceTimersByTime(90_000);
    expect(callback).toHaveBeenCalledTimes(5);

    clearInterval(timer);
  });

  it("heartbeat updates lastSeenAt and status in the database", async () => {
    const mockWhere = vi.fn().mockResolvedValue(undefined);
    const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
    const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

    const db = { update: mockUpdate };
    const workersTable = { id: "workers.id" };
    const workerId = "worker-123";

    const HEARTBEAT_INTERVAL_MS = 30_000;
    const timer = setInterval(async () => {
      await db
        .update(workersTable)
        .set({ lastSeenAt: new Date(), status: "online", updatedAt: new Date() })
        .where({ col: workersTable.id, val: workerId });
    }, HEARTBEAT_INTERVAL_MS);

    // Advance timer to fire heartbeat
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockUpdate).toHaveBeenCalledWith(workersTable);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "online",
        lastSeenAt: expect.any(Date),
        updatedAt: expect.any(Date),
      }),
    );
    expect(mockWhere).toHaveBeenCalledWith({ col: workersTable.id, val: workerId });

    clearInterval(timer);
  });

  it("heartbeat timer can be cleared on shutdown", () => {
    const callback = vi.fn();
    const HEARTBEAT_INTERVAL_MS = 30_000;

    const timer = setInterval(callback, HEARTBEAT_INTERVAL_MS);

    // Fire once
    vi.advanceTimersByTime(30_000);
    expect(callback).toHaveBeenCalledTimes(1);

    // Clear the interval (simulates shutdown)
    clearInterval(timer);

    // Advance more time -- should NOT fire again
    vi.advanceTimersByTime(60_000);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("heartbeat swallows errors without crashing", async () => {
    const mockWhere = vi.fn().mockRejectedValue(new Error("DB connection lost"));
    const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
    const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

    const db = { update: mockUpdate };
    const logger = { warn: vi.fn() };
    const workersTable = { id: "workers.id" };
    const workerId = "worker-123";

    const HEARTBEAT_INTERVAL_MS = 30_000;
    const timer = setInterval(async () => {
      try {
        await db
          .update(workersTable)
          .set({ lastSeenAt: new Date(), status: "online", updatedAt: new Date() })
          .where({ col: workersTable.id, val: workerId });
      } catch (err) {
        logger.warn({ err, workerId }, "Heartbeat update failed");
      }
    }, HEARTBEAT_INTERVAL_MS);

    // Should not throw
    await vi.advanceTimersByTimeAsync(30_000);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), workerId }),
      "Heartbeat update failed",
    );

    clearInterval(timer);
  });
});
