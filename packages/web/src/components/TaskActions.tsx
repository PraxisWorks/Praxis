type TaskActionsProps = {
  taskId: string;
  status: string;
  onStartWork?: (id: string) => void;
  onStartDebug?: (id: string) => void;
  size?: "xs" | "sm";
};

export function TaskActions({
  taskId,
  status,
  onStartWork,
  onStartDebug,
  size = "sm",
}: TaskActionsProps) {
  const showWork =
    status !== "draft" && status !== "complete" && status !== "archived";
  const btnClass =
    size === "xs" ? "text-[10px] px-1 py-0.5" : "text-xs px-1.5 py-0.5";

  return (
    <div className="flex gap-1 mt-2" onClick={(e) => e.stopPropagation()}>
      {showWork && onStartWork && (
        <button
          onClick={() => onStartWork(taskId)}
          className={`${btnClass} bg-[var(--accent-light)] text-[var(--accent)] rounded hover:bg-[var(--accent-light)] cursor-pointer`}
        >
          Work
        </button>
      )}
      {onStartDebug && (
        <button
          onClick={() => onStartDebug(taskId)}
          className={`${btnClass} bg-[var(--bg-secondary)] text-[var(--text-secondary)] rounded hover:bg-[var(--bg-tertiary)] cursor-pointer`}
        >
          Debug
        </button>
      )}
    </div>
  );
}
