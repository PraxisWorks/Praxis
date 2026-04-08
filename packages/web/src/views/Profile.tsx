import { useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { trpc, useWorkers, useLimits, usePermissions } from "@praxis2/hooks";
import { UsageBadge } from "../components/UsageBadge.js";
import { WorkerList } from "../components/WorkerList.js";
import { ApiKeyManager } from "../components/ApiKeyManager.js";

export function Profile() {
  const { user, logout } = useAuth0();
  const { data: dbUser } = trpc.user.me.useQuery(undefined, {
    enabled: !!user,
  });

  const {
    workers,
    activeWorker,
    isLoading: isLoadingWorkers,
    generateToken,
    isGeneratingToken,
    setActive,
  } = useWorkers();

  const { limits, usage, isLoading: isLoadingLimits } = useLimits();
  const { hasPermission } = usePermissions();

  const [generatedToken, setGeneratedToken] = useState<{
    token: string;
    expiresAt: string;
  } | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [commandCopied, setCommandCopied] = useState(false);
  const [workerName, setWorkerName] = useState("");

  if (!user) return null;

  const handleGenerateToken = async () => {
    const result = await generateToken({});
    setGeneratedToken({
      token: result.token,
      expiresAt: new Date(result.expiresAt).toLocaleTimeString(),
    });
    setTokenCopied(false);
  };

  const handleCopyToken = async () => {
    if (!generatedToken) return;
    await navigator.clipboard.writeText(generatedToken.token);
    setTokenCopied(true);
  };

  const handleSetActive = async (workerId: string | null) => {
    await setActive({ workerId });
  };

  const apiUrl = window.location.origin;

  return (
    <div className="max-w-[700px] mx-auto">
      {/* User info section */}
      <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-6 mb-6">
        <div className="flex items-center gap-4">
          {user.picture && (
            <img
              src={user.picture}
              alt={user.name}
              className="w-16 h-16 rounded-full"
            />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold">{user.name}</h1>
            <p className="text-[var(--text-muted)] text-sm">{user.email}</p>
            {dbUser && (
              <p className="text-[var(--text-faint)] text-xs mt-1">
                Role: {dbUser.role} &middot; Joined{" "}
                {new Date(dbUser.createdAt).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>

        {/* Logout button */}
        <div className="mt-4 pt-4 border-t border-[var(--border-primary)]">
          <button
            onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}
            className="px-4 py-2 text-sm border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-secondary)] cursor-pointer text-[var(--text-secondary)]"
          >
            Log out
          </button>
        </div>
      </div>

      {/* Workers section */}
      <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-lg font-semibold">Workers</h2>
          {!isLoadingLimits && usage && (
            <UsageBadge
              current={usage.currentWorkers}
              max={limits?.maxWorkers ?? null}
              label="Workers"
            />
          )}
        </div>

        {hasPermission("worker:create:local") && (
          <>
            {/* Setup Instructions */}
            <details className="mb-6">
              <summary className="cursor-pointer text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                How to set up a local worker
              </summary>
              <div className="mt-2 p-3 bg-[var(--bg-tertiary)] rounded border border-[var(--border-primary)] text-xs text-[var(--text-muted)] space-y-2">
                <p><strong className="text-[var(--text-primary)]">1. Install the worker CLI</strong></p>
                <code className="block bg-[var(--bg-primary)] px-2 py-1 rounded text-[var(--text-primary)]">
                  npm install -g @praxwork/cli
                </code>
                <p><strong className="text-[var(--text-primary)]">2. Generate a token below, name your worker, and log in</strong></p>
                <code className="block bg-[var(--bg-primary)] px-2 py-1 rounded text-[var(--text-primary)]">
                  praxis login --token &lt;token&gt; --name &apos;{workerName || "My Laptop"}&apos; --url {apiUrl}
                </code>
                <p><strong className="text-[var(--text-primary)]">3. Start the worker</strong></p>
                <code className="block bg-[var(--bg-primary)] px-2 py-1 rounded text-[var(--text-primary)]">
                  praxis start
                </code>
                <p className="text-[var(--text-faint)]">
                  Other commands: <code className="bg-[var(--bg-primary)] px-1 py-0.5 rounded">praxis status</code>{" "}
                  <code className="bg-[var(--bg-primary)] px-1 py-0.5 rounded">praxis stop</code>
                </p>
              </div>
            </details>

            {/* Generate Worker Token */}
            <div className="mb-6">
              <h3 className="text-sm font-medium mb-2">Register a New Worker</h3>

              <div className="flex items-center gap-2 mb-3">
                <input
                  type="text"
                  value={workerName}
                  onChange={(e) => setWorkerName(e.target.value)}
                  placeholder="Worker name (e.g. My Laptop)"
                  className="flex-1 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)]"
                />
                <button
                  onClick={handleGenerateToken}
                  disabled={isGeneratingToken}
                  className="px-4 py-2 text-sm border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-secondary)] cursor-pointer text-[var(--text-secondary)] disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {isGeneratingToken ? "Generating..." : "Generate Token"}
                </button>
              </div>

              {generatedToken && (
                <div className="mt-3 p-3 bg-[var(--bg-tertiary)] rounded border border-[var(--border-primary)]">
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="text"
                      readOnly
                      value={generatedToken.token}
                      className="flex-1 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded px-2 py-1 text-xs font-mono text-[var(--text-primary)]"
                    />
                    <button
                      onClick={handleCopyToken}
                      className="px-3 py-1 text-xs border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-secondary)] cursor-pointer text-[var(--text-secondary)]"
                    >
                      {tokenCopied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mb-1">
                    Expires at {generatedToken.expiresAt} (15 minutes)
                  </p>
                  <div className="flex items-start gap-2">
                    <p className="text-xs text-[var(--text-muted)] flex-1">
                      Run on your local machine:{" "}
                      <code className="bg-[var(--bg-primary)] px-1 py-0.5 rounded text-[var(--text-primary)]">
                        praxis login --token {generatedToken.token} --name &apos;{workerName || "My Laptop"}&apos; --url {apiUrl}
                      </code>
                    </p>
                    <button
                      onClick={async () => {
                        const name = workerName || "My Laptop";
                        const cmd = `praxis login --token ${generatedToken.token} --name '${name}' --url ${apiUrl}`;
                        await navigator.clipboard.writeText(cmd);
                        setCommandCopied(true);
                        setTimeout(() => setCommandCopied(false), 2000);
                      }}
                      className="px-2 py-0.5 text-xs border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-secondary)] cursor-pointer text-[var(--text-secondary)] whitespace-nowrap shrink-0"
                    >
                      {commandCopied ? "Copied!" : "Copy command"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Active Worker Selector */}
        <div className="mb-4">
          <h3 className="text-sm font-medium mb-2">Active Worker</h3>
          {isLoadingWorkers ? (
            <p className="text-sm text-[var(--text-muted)]">Loading workers...</p>
          ) : (
            <select
              value={activeWorker?.id ?? ""}
              onChange={(e) => handleSetActive(e.target.value || null)}
              className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              <option value="">Central (default)</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.status})
                </option>
              ))}
            </select>
          )}
          {activeWorker && (
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              <span
                className={`inline-block w-2 h-2 rounded-full mr-1 ${
                  activeWorker.status === "online" ? "bg-green-500" : "bg-gray-400"
                }`}
              />
              {activeWorker.name} is {activeWorker.status}
            </p>
          )}
        </div>

        {/* Worker list with rename + remove actions */}
        <div>
          <h3 className="text-sm font-medium mb-2">Registered Workers</h3>
          <WorkerList />
        </div>
      </div>

      {/* API Keys section */}
      {hasPermission("worker:create:apikey") && (
        <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-6 mb-6">
          <h2 className="text-lg font-semibold mb-1">API Keys</h2>
          <p className="text-sm text-[var(--text-faint)] mb-4">
            Add your own Anthropic API key to use your own compute
          </p>
          <ApiKeyManager />
        </div>
      )}

    </div>
  );
}
