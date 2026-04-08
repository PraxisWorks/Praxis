import { useDeployments } from "@praxis2/hooks";

function formatTimestamp(isoString: string): string {
  const d = new Date(isoString);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd}/${yy} ${hh}:${min}`;
}

function serviceLabel(service: string): string {
  switch (service) {
    case "web":
      return "UI";
    case "api":
      return "API";
    case "worker":
      return "Worker";
    case "mobile":
      return "Mobile";
    default:
      return service;
  }
}

export function DeploymentFooter() {
  const { deployments, isLoading } = useDeployments();

  if (isLoading || deployments.length === 0) return null;

  return (
    <footer className="h-6 bg-[var(--bg-secondary)] border-t border-[var(--border-primary)] flex items-center justify-center gap-4 px-4 text-xs text-[var(--text-faint)] shrink-0">
      {deployments.map((d) => (
        <span key={d.service}>
          {serviceLabel(d.service)}:{" "}
          <span className="font-mono">{d.gitSha.slice(0, 7)}</span>
          {" · "}
          {formatTimestamp(d.deployedAt)}
        </span>
      ))}
    </footer>
  );
}
