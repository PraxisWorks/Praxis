import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

type SessionsPanelContextValue = {
  pendingSessionId: string | null;
  openSession: (id: string) => void;
  clearPendingSession: () => void;
};

const SessionsPanelContext = createContext<SessionsPanelContextValue | null>(null);

export function SessionsPanelProvider({
  children,
  onOpenPanel,
}: {
  children: ReactNode;
  onOpenPanel: () => void;
}) {
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);

  const openSession = useCallback(
    (id: string) => {
      setPendingSessionId(id);
      onOpenPanel();
    },
    [onOpenPanel],
  );

  const clearPendingSession = useCallback(() => {
    setPendingSessionId(null);
  }, []);

  return (
    <SessionsPanelContext.Provider value={{ pendingSessionId, openSession, clearPendingSession }}>
      {children}
    </SessionsPanelContext.Provider>
  );
}

export function useSessionsPanel(): SessionsPanelContextValue {
  const ctx = useContext(SessionsPanelContext);
  if (!ctx) {
    throw new Error("useSessionsPanel must be used within a SessionsPanelProvider");
  }
  return ctx;
}
