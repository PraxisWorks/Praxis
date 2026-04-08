type StatusBadgeProps = {
  status: string;
  size?: "xs" | "sm";
};

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  approved: "bg-blue-100 text-blue-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  blocked: "bg-red-100 text-red-700",
  complete: "bg-green-100 text-green-700",
  archived: "bg-gray-100 text-gray-400",
  active: "bg-green-100 text-green-700",
  paused: "bg-yellow-100 text-yellow-700",
  completed: "bg-gray-100 text-gray-600",
  error: "bg-red-100 text-red-700",
};

const SIZE_CLASSES: Record<string, string> = {
  xs: "text-[10px] px-1.5 py-0.5",
  sm: "text-xs px-2 py-0.5",
};

function formatLabel(status: string): string {
  const text = status.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function StatusBadge({ status, size = "sm" }: StatusBadgeProps) {
  const colorClass = STATUS_STYLES[status] ?? "bg-gray-100 text-gray-600";
  const sizeClass = SIZE_CLASSES[size];

  return (
    <span
      className={`inline-block font-medium rounded ${colorClass} ${sizeClass}`}
    >
      {formatLabel(status)}
    </span>
  );
}
