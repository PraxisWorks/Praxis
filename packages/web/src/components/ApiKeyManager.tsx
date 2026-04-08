import { useState, type FormEvent } from "react";
import { useApiKeys } from "@praxis2/hooks";

type ApiKey = {
  id: string;
  label: string;
  keyLastFour: string;
  status: string;
};

const MAX_KEYS = 5;

const statusBadge: Record<string, { className: string; label: string }> = {
  active: {
    className: "bg-green-500/15 text-green-400 border-green-500/30",
    label: "Active",
  },
  provisioning: {
    className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    label: "Provisioning...",
  },
  error: {
    className: "bg-red-500/15 text-red-400 border-red-500/30",
    label: "Error",
  },
  revoked: {
    className: "bg-gray-500/15 text-gray-400 border-gray-500/30",
    label: "Revoked",
  },
};

function StatusBadge({ status }: { status: string }) {
  const badge = statusBadge[status] ?? statusBadge.error;
  return (
    <span
      className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded border ${badge.className}`}
    >
      {badge.label}
    </span>
  );
}

export function ApiKeyManager() {
  const {
    apiKeys,
    isLoading,
    error,
    createKey,
    deleteKey,
    isCreating,
    isDeleting,
  } = useApiKeys();

  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const nonRevokedCount = apiKeys.filter(
    (k: ApiKey) => k.status !== "revoked",
  ).length;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedLabel = label.trim();
    if (!trimmedLabel || trimmedLabel.length > 100) {
      setFormError("Label is required (1-100 characters).");
      return;
    }

    if (!key.startsWith("sk-ant-")) {
      setFormError('API key must start with "sk-ant-".');
      return;
    }

    try {
      await createKey({ label: trimmedLabel, key });
      setLabel("");
      setKey("");
      setShowKey(false);
      setFormError(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to add key.";
      setFormError(message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteKey({ id });
    } finally {
      setConfirmDeleteId(null);
    }
  };

  if (isLoading) {
    return (
      <p className="text-[var(--text-faint)] text-center p-8">
        Loading API keys...
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Count indicator */}
      <p className="text-xs text-[var(--text-faint)]">
        {nonRevokedCount} of {MAX_KEYS} keys used
      </p>

      {/* Add key form */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <input
            type="text"
            placeholder="My Anthropic key"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={100}
            className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)]"
          />
        </div>
        <div className="relative">
          <input
            type={showKey ? "text" : "password"}
            placeholder="sk-ant-..."
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded px-3 py-2 pr-16 text-sm font-mono text-[var(--text-primary)] placeholder:text-[var(--text-faint)]"
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer"
          >
            {showKey ? "Hide" : "Show"}
          </button>
        </div>

        {(formError || error) && (
          <p className="text-xs text-red-400">
            {formError ?? error?.message}
          </p>
        )}

        <button
          type="submit"
          disabled={isCreating}
          className="px-4 py-2 text-sm border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-secondary)] cursor-pointer text-[var(--text-secondary)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isCreating ? "Adding..." : "Add Key"}
        </button>
      </form>

      {/* Key list */}
      {apiKeys.length === 0 ? (
        <p className="text-[var(--text-faint)] text-center p-8">
          No API keys configured. Add your Anthropic API key to use your own
          compute.
        </p>
      ) : (
        <div className="space-y-2">
          {apiKeys.map((apiKey: ApiKey) => (
            <div
              key={apiKey.id}
              className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-4"
            >
              <div className="flex items-center justify-between gap-3">
                {/* Left: label, masked key, badge */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">
                      {apiKey.label}
                    </p>
                    <StatusBadge status={apiKey.status} />
                  </div>
                  <p className="text-xs text-[var(--text-faint)] font-mono mt-0.5">
                    sk-ant-...{apiKey.keyLastFour}
                  </p>
                </div>

                {/* Right: delete action */}
                <div className="flex items-center gap-2 shrink-0">
                  {confirmDeleteId === apiKey.id ? (
                    <span className="flex items-center gap-2 text-xs">
                      <span className="text-[var(--text-secondary)]">
                        Remove?
                      </span>
                      <button
                        onClick={() => handleDelete(apiKey.id)}
                        disabled={isDeleting}
                        className="text-red-500 hover:text-red-400 cursor-pointer disabled:opacity-50"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer"
                      >
                        No
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(apiKey.id)}
                      className="text-xs text-[var(--text-muted)] hover:text-red-500 cursor-pointer"
                      title="Remove key"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
