import { renderHook } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";

const mockHasUnread = vi.fn();
const mockMarkViewed = vi.fn();

vi.mock("./useSessionLastViewed.js", () => ({
  useSessionLastViewed: () => ({
    hasUnread: mockHasUnread,
    markViewed: mockMarkViewed,
    version: 0,
    getLastViewed: vi.fn(),
  }),
}));

import { useUnreadSessionCount } from "./useUnreadSessionCount.js";

describe("useUnreadSessionCount", () => {
  beforeEach(() => {
    mockHasUnread.mockReset();
    mockMarkViewed.mockReset();
  });

  it("returns 0 when no sessions are passed", () => {
    const { result } = renderHook(() => useUnreadSessionCount());
    expect(result.current.unreadSessionCount).toBe(0);
  });

  it("returns 0 when empty array is passed", () => {
    const { result } = renderHook(() => useUnreadSessionCount([]));
    expect(result.current.unreadSessionCount).toBe(0);
  });

  it("only counts active sessions as unread", () => {
    const sessions = [
      { id: "s1", status: "active", lastMessageAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
      { id: "s2", status: "paused", lastMessageAt: "2026-01-02T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
      { id: "s3", status: "active", lastMessageAt: "2026-01-03T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
    ];
    mockHasUnread.mockReturnValue(true);

    const { result } = renderHook(() => useUnreadSessionCount(sessions));
    // Only s1 and s3 are active, s2 is paused → should not count
    expect(result.current.unreadSessionCount).toBe(2);
  });

  it("returns correct count when some active sessions are read", () => {
    const sessions = [
      { id: "s1", status: "active", lastMessageAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
      { id: "s2", status: "active", lastMessageAt: "2026-01-02T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
      { id: "s3", status: "active", lastMessageAt: "2026-01-03T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
    ];
    // s1 and s3 are unread, s2 is read
    mockHasUnread.mockImplementation((id: string) => id !== "s2");

    const { result } = renderHook(() => useUnreadSessionCount(sessions));
    expect(result.current.unreadSessionCount).toBe(2);
  });

  it("uses createdAt as fallback when lastMessageAt is null", () => {
    const sessions = [
      { id: "s1", status: "active", lastMessageAt: null, createdAt: "2026-01-01T00:00:00Z" },
    ];
    mockHasUnread.mockReturnValue(true);

    renderHook(() => useUnreadSessionCount(sessions));
    expect(mockHasUnread).toHaveBeenCalledWith("s1", "2026-01-01T00:00:00Z");
  });

  it("passes lastMessageAt when available", () => {
    const sessions = [
      { id: "s1", status: "active", lastMessageAt: "2026-02-15T12:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
    ];
    mockHasUnread.mockReturnValue(false);

    renderHook(() => useUnreadSessionCount(sessions));
    expect(mockHasUnread).toHaveBeenCalledWith("s1", "2026-02-15T12:00:00Z");
  });

  it("exposes markViewed from useSessionLastViewed", () => {
    const { result } = renderHook(() => useUnreadSessionCount());
    expect(result.current.markViewed).toBe(mockMarkViewed);
  });
});
