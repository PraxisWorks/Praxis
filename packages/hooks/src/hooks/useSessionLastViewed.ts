import { useCallback, useRef, useState } from "react";

const STORAGE_KEY = "praxis:session-last-viewed";

function readStore(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, number>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage may be full or unavailable
  }
}

export function useSessionLastViewed() {
  // Use a ref to avoid re-renders on every mark. The store is read
  // lazily each time hasUnread is called, so the ref is just for stable
  // callback identity.
  const storeRef = useRef(readStore());
  const [version, setVersion] = useState(0);

  const markViewed = useCallback((sessionId: string) => {
    const store = readStore();
    store[sessionId] = Date.now();
    writeStore(store);
    storeRef.current = store;
    setVersion((v) => v + 1);
  }, []);

  const getLastViewed = useCallback((sessionId: string): number | null => {
    const store = readStore();
    return store[sessionId] ?? null;
  }, []);

  const hasUnread = useCallback(
    (sessionId: string, lastMessageAt: string | Date | null): boolean => {
      if (!lastMessageAt) return false;
      const store = readStore();
      const lastViewed = store[sessionId];
      if (!lastViewed) return true; // never viewed => unread
      const messageTime = new Date(lastMessageAt).getTime();
      return messageTime > lastViewed;
    },
    [],
  );

  return { markViewed, getLastViewed, hasUnread, version };
}
