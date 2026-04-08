import { useGhDeployments, useGhDeploymentStatus } from "@praxis2/hooks";

/* ── Status color pills ─────────────────────────────────────── */

const DEPLOY_STATUS_COLORS: Record<string, string> = {
  success: "bg-green-100 text-green-700",
  failure: "bg-red-100 text-red-700",
  error: "bg-red-100 text-red-700",
  pending: "bg-yellow-100 text-yellow-700",
  in_progress: "bg-blue-100 text-blue-700",
  queued: "bg-gray-100 text-gray-700",
  inactive: "bg-gray-100 text-gray-500",
  waiting: "bg-yellow-100 text-yellow-700",
};

/* ── Relative time helper ─────────────────────────────────── */

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

/* ── Environment sort order ───────────────────────────────── */

const ENV_ORDER: Record<string, number> = {
  production: 0,
  staging: 1,
  preview: 2,
};

function envSortKey(env: string): number {
  return ENV_ORDER[env.toLowerCase()] ?? 99;
}

/* ── Props ──────────────────────────────────────────────────── */

type DeploymentsProps = {
  repoId: string | null;
};

/* ── Empty State Diagnostics ────────────────────────────────── */

type RepoStatus = {
  id: string;
  name: string;
  hasRepo: boolean;
  hasWebhookConfig: boolean;
};

function DeploymentEmptyState({
  githubConfigured,
  repoStatuses,
  repoId,
}: {
  githubConfigured: boolean | null;
  repoStatuses: RepoStatus[];
  repoId: string | null;
}) {
  // Still loading diagnostics
  if (githubConfigured === null) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <p className="text-[var(--text-muted)] text-sm">
          No deployments tracked yet.
        </p>
      </div>
    );
  }

  // Server-level: no GitHub token
  if (!githubConfigured) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 max-w-md">
          <p className="text-yellow-800 text-sm font-medium">
            GitHub integration not configured
          </p>
          <p className="text-yellow-700 text-xs mt-1">
            A GITHUB_TOKEN environment variable is required to track deployments.
            Contact your administrator to set this up.
          </p>
        </div>
      </div>
    );
  }

  // Repo-level diagnostics
  const reposWithoutRepo = repoStatuses.filter((r) => !r.hasRepo);
  const reposWithoutWebhook = repoStatuses.filter(
    (r) => r.hasRepo && !r.hasWebhookConfig,
  );
  const reposReady = repoStatuses.filter(
    (r) => r.hasRepo && r.hasWebhookConfig,
  );

  return (
    <div className="flex flex-col items-center justify-center p-12 text-center space-y-4">
      <p className="text-[var(--text-muted)] text-sm">
        No deployments tracked yet.
      </p>

      {/* All repos have no GitHub repo set */}
      {reposWithoutRepo.length > 0 && reposReady.length === 0 && reposWithoutWebhook.length === 0 && (
        <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg p-4 max-w-md text-left">
          <p className="text-[var(--text-secondary)] text-xs font-medium">
            {repoId ? "This repo has" : `${reposWithoutRepo.length} repo${reposWithoutRepo.length > 1 ? "s have" : " has"}`} no
            GitHub repo set.
          </p>
          <p className="text-[var(--text-faint)] text-xs mt-1">
            Set a GitHub repo on your repo to start tracking deployments.
          </p>
        </div>
      )}

      {/* Some repos have repo but no webhook config */}
      {reposWithoutWebhook.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 max-w-md text-left">
          <p className="text-yellow-800 text-xs font-medium">
            Webhook registration pending
          </p>
          <p className="text-yellow-700 text-xs mt-1">
            {reposWithoutWebhook.length === 1
              ? `"${reposWithoutWebhook[0].name}" has`
              : `${reposWithoutWebhook.length} repos have`}{" "}
            a repo configured but the webhook hasn't been registered yet. This
            usually resolves within a few minutes.
          </p>
        </div>
      )}

      {/* Repos are ready but no deployments yet */}
      {reposReady.length > 0 && reposWithoutWebhook.length === 0 && (
        <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg p-4 max-w-md text-left">
          <p className="text-[var(--text-secondary)] text-xs font-medium">
            Webhooks configured — waiting for deployments
          </p>
          <p className="text-[var(--text-faint)] text-xs mt-1">
            {reposReady.length === 1
              ? `"${reposReady[0].name}" is`
              : `${reposReady.length} repos are`}{" "}
            connected to GitHub. Deployments will appear here once GitHub
            sends deployment events.
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Main Component ─────────────────────────────────────────── */

export function Deployments({ repoId }: DeploymentsProps) {
  const { deployments, isLoading, error } = useGhDeployments(repoId);
  const { githubConfigured, repos: repoStatuses } = useGhDeploymentStatus(repoId);

  // Group by environment
  const grouped = new Map<string, typeof deployments>();
  for (const d of deployments) {
    const env = d.environment;
    if (!grouped.has(env)) grouped.set(env, []);
    grouped.get(env)!.push(d);
  }

  // Sort environments: production first, then alphabetical
  const sortedEnvs = Array.from(grouped.keys()).sort(
    (a, b) => envSortKey(a) - envSortKey(b) || a.localeCompare(b),
  );

  if (error) {
    return (
      <div className="bg-red-50 text-red-600 p-3 rounded m-4">{error}</div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)]">
        <h1 className="text-lg font-bold">Deployments</h1>
      </div>

      {isLoading ? (
        <p className="text-[var(--text-faint)] text-center p-8">Loading...</p>
      ) : deployments.length === 0 ? (
        <DeploymentEmptyState
          githubConfigured={githubConfigured}
          repoStatuses={repoStatuses}
          repoId={repoId}
        />
      ) : (
        <div className="p-4 space-y-6">
          {sortedEnvs.map((env) => {
            const items = grouped.get(env)!;
            return (
              <div key={env}>
                <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
                  {env}
                </h2>
                <div className="space-y-2">
                  {items.map((d) => {
                    const statusClasses =
                      DEPLOY_STATUS_COLORS[d.status] ?? "bg-gray-100 text-gray-700";
                    return (
                      <div
                        key={d.id}
                        className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-3 flex items-center gap-3"
                      >
                        {/* Repo color dot + name (only in All Repos mode) */}
                        {!repoId && d.repoName && (
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: d.repoColor }}
                            />
                            <span className="text-xs text-[var(--text-muted)] truncate max-w-[100px]">
                              {d.repoName}
                            </span>
                          </div>
                        )}

                        {/* Status pill */}
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusClasses}`}
                        >
                          {d.status.replace(/_/g, " ")}
                        </span>

                        {/* Ref (branch/tag) */}
                        {d.ref && (
                          <span className="text-xs text-[var(--text-secondary)] font-mono bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded truncate max-w-[150px]">
                            {d.ref}
                          </span>
                        )}

                        {/* Description */}
                        {d.description && (
                          <span className="text-xs text-[var(--text-muted)] truncate flex-1">
                            {d.description}
                          </span>
                        )}

                        {/* Spacer */}
                        <span className="flex-1" />

                        {/* Creator */}
                        {d.creatorLogin && (
                          <span className="text-xs text-[var(--text-faint)]">
                            {d.creatorLogin}
                          </span>
                        )}

                        {/* Timestamp */}
                        <span className="text-xs text-[var(--text-faint)] whitespace-nowrap">
                          {relativeTime(d.updatedAt)}
                        </span>

                        {/* Link */}
                        {d.url && (
                          <a
                            href={d.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-[var(--accent)] hover:underline whitespace-nowrap"
                          >
                            View →
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
