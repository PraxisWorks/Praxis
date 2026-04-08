interface RepoColorDotProps {
  color: string;
  size?: "sm" | "md";
  className?: string;
}

export function RepoColorDot({ color, size = "sm", className = "" }: RepoColorDotProps) {
  const sizeClasses = size === "sm" ? "w-2.5 h-2.5" : "w-3.5 h-3.5";
  return (
    <span
      className={`inline-block rounded-full shrink-0 ${sizeClasses} ${className}`}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  );
}
