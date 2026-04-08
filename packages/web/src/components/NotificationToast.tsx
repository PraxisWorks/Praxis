import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { trpc, useNotificationToast } from "@praxis2/hooks";
import { useToast } from "../contexts/ToastContext.js";

export function NotificationToast() {
  const navigate = useNavigate();
  const { toasts, dismiss, addToast } = useToast();
  const { data: me } = trpc.user.me.useQuery();

  useNotificationToast(me?.id, (notification) => {
    addToast({
      title: notification.title,
      body: notification.body,
      actionUrl: notification.actionUrl ?? undefined,
    });
  });

  const handleClick = useCallback(
    (toast: { id: string; actionUrl: string | null }) => {
      dismiss(toast.id);
      if (toast.actionUrl) navigate(toast.actionUrl);
    },
    [dismiss, navigate],
  );

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          onClick={() => handleClick(toast)}
          className={`relative w-80 bg-[var(--bg-primary)] shadow-lg rounded-lg border-l-4 ${
            toast.variant === "error"
              ? "border-red-500"
              : "border-[var(--accent)]"
          } p-4 cursor-pointer transition-opacity duration-300`}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              dismiss(toast.id);
            }}
            className="absolute top-2 right-2 text-[var(--text-faint)] hover:text-[var(--text-secondary)] bg-transparent border-none cursor-pointer text-sm leading-none"
          >
            &times;
          </button>
          <p className="font-semibold text-sm text-[var(--text-primary)] pr-4">
            {toast.title}
          </p>
          <p className="text-[var(--text-secondary)] text-xs mt-1 line-clamp-2">
            {toast.body}
          </p>
        </div>
      ))}
    </div>
  );
}
