import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToastVariant = "info" | "error";

type Toast = {
  id: string;
  title: string;
  body: string;
  actionUrl: string | null;
  variant: ToastVariant;
};

type ToastContextValue = {
  toasts: readonly Toast[];
  addToast: (opts: {
    title: string;
    body: string;
    variant?: ToastVariant;
    actionUrl?: string;
  }) => void;
  dismiss: (id: string) => void;
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ToastContext = createContext<ToastContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback(
    (opts: {
      title: string;
      body: string;
      variant?: ToastVariant;
      actionUrl?: string;
    }) => {
      const toast: Toast = {
        id: crypto.randomUUID(),
        title: opts.title,
        body: opts.body,
        variant: opts.variant ?? "info",
        actionUrl: opts.actionUrl ?? null,
      };
      setToasts((prev) => [toast, ...prev].slice(0, 3));
    },
    [],
  );

  // Auto-dismiss after 5 seconds
  useEffect(() => {
    if (toasts.length === 0) return;

    const timers = toasts.map((toast) =>
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, 5000),
    );

    return () => timers.forEach(clearTimeout);
  }, [toasts]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, dismiss }}>
      {children}
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
