export function UsageBadge({
  current,
  max,
  label,
}: {
  current: number;
  max: number | null;
  label: string;
}) {
  const display = max === null ? `${current}/\u221E` : `${current}/${max}`;

  let colorClass = "text-[var(--text-faint)] bg-[var(--bg-tertiary)]";
  if (max !== null) {
    const ratio = current / max;
    if (ratio >= 1) {
      colorClass = "text-red-400 bg-red-500/10";
    } else if (ratio >= 0.8) {
      colorClass = "text-yellow-400 bg-yellow-500/10";
    }
  }

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
      {display} {label}
    </span>
  );
}
