import { useState } from "react";
import { usePermissions, useWorkers, useWorkerSettings } from "@praxis2/hooks";
import { timeAgo } from "../lib/timeAgo.js";

// The per-worker Rig Init settings panel is intentionally hidden until
// the DB → ensureRepoInitialized wire-up lands. Today the panel saves
// to workers.repoInitSettings but nothing reads it at session start,
// which is misleading. Flip to true once the runtime honors DB settings.
const WORKER_SETTINGS_ENABLED = false;

function WorkerSettingsPanel({ workerId }: { workerId: string }) {
  const { settings, isLoading, setSettings, isSaving, error } = useWorkerSettings(workerId);
  const [mode, setMode] = useState<"ruflo" | "custom">(settings?.mode ?? "custom");
  const [scripts, setScripts] = useState(settings?.scripts?.join("\n") ?? "");
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync state when data loads
  const [lastSettingsJson, setLastSettingsJson] = useState<string | null>(null);
  const settingsJson = JSON.stringify(settings);
  if (settingsJson !== lastSettingsJson && settings !== undefined) {
    setLastSettingsJson(settingsJson);
    if (settings) {
      setMode(settings.mode);
      setScripts(settings.scripts?.join("\n") ?? "");
    }
  }

  const handleSave = async () => {
    setSaveError(null);
    setSaved(false);
    try {
      const scriptList = mode === "custom"
        ? scripts.split("\n").map((s) => s.trim()).filter(Boolean)
        : [];
      await setSettings({ workerId, settings: { mode, scripts: scriptList } });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Failed to save settings");
    }
  };

  if (isLoading) {
    return <p className="text-xs text-[var(--text-faint)] py-2">Loading settings...</p>;
  }

  return (
    <div className="mt-3 pt-3 border-t border-[var(--border-primary)]">
      <h4 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
        Rig Initialization
      </h4>

      {(saveError || error) && (
        <div className="bg-red-900/20 text-red-400 p-2 rounded mb-3 text-xs">
          {saveError || error}
        </div>
      )}
      {saved && (
        <div className="bg-green-900/20 text-green-400 p-2 rounded mb-3 text-xs">
          Settings saved.
        </div>
      )}

      <div className="space-y-2 mb-3">
        {([
          {
            value: "custom" as const,
            label: "Minimal (default)",
            description: "No orchestration layer. Praxis sets up only what sessions need. Optionally run your own initialization scripts below.",
          },
          {
            value: "ruflo" as const,
            label: "Ruflo (opt-in)",
            description: "Bootstraps the Ruflo orchestrator on session start (claude-flow init/daemon/MCP). Adds extra npm dependencies — review before enabling.",
          },
        ]).map((option) => (
          <label
            key={option.value}
            className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${
              mode === option.value
                ? "border-[var(--accent-emphasis)] bg-[var(--accent-emphasis)]/5"
                : "border-[var(--border-secondary)] bg-[var(--bg-secondary)] hover:border-[var(--border-primary)]"
            }`}
          >
            <input
              type="radio"
              name={`rigInitMode-${workerId}`}
              value={option.value}
              checked={mode === option.value}
              onChange={() => setMode(option.value)}
              className="mt-0.5 accent-[var(--accent-emphasis)]"
            />
            <div>
              <span className="text-sm font-medium text-[var(--text-primary)]">{option.label}</span>
              <p className="text-xs text-[var(--text-faint)] mt-0.5">{option.description}</p>
            </div>
          </label>
        ))}
      </div>

      {mode === "custom" && (
        <div className="mb-3">
          <label className="text-xs font-medium text-[var(--text-secondary)] block mb-1">
            Custom Scripts
          </label>
          <textarea
            value={scripts}
            onChange={(e) => setScripts(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded text-[var(--text-primary)] font-mono resize-y"
            rows={3}
            placeholder={"~/scripts/setup-tools.sh\n/usr/local/bin/init-env.sh"}
          />
          <p className="text-[10px] text-[var(--text-faint)] mt-1">
            One script per line. Paths must be absolute or start with ~/. Runs with 60s timeout, failures are non-fatal.
          </p>
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={isSaving}
        className="px-3 py-1.5 text-xs bg-[var(--accent-emphasis)] text-white rounded hover:opacity-90 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
      >
        {isSaving ? "Saving..." : "Save"}
      </button>
    </div>
  );
}

export function WorkerList() {
  const {
    workers,
    isLoading,
    renameWorker,
    removeWorker,
  } = useWorkers();
  const { hasPermission } = usePermissions();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [settingsOpenId, setSettingsOpenId] = useState<string | null>(null);

  const startEditing = (id: string, currentName: string) => {
    setEditingId(id);
    setEditName(currentName);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditName("");
  };

  const submitRename = async (id: string) => {
    const trimmed = editName.trim();
    if (!trimmed) return;
    await renameWorker({ id, data: { name: trimmed } });
    cancelEditing();
  };

  const confirmRemove = async (id: string) => {
    await removeWorker({ id });
    setConfirmDeleteId(null);
  };

  if (isLoading) {
    return (
      <p className="text-[var(--text-faint)] text-center p-8">
        Loading workers...
      </p>
    );
  }

  if (workers.length === 0) {
    return (
      <p className="text-[var(--text-faint)] text-center p-8">
        No workers registered. Generate a token from the Workers section above
        to add one.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {workers.map((worker) => (
        <div
          key={worker.id}
          className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-4"
        >
          <div className="flex items-center justify-between gap-3">
            {/* Left side: status + name */}
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  worker.status === "online" ? "bg-green-500" : "bg-gray-400"
                }`}
                title={worker.status === "online" ? "Online" : "Offline"}
              />

              {editingId === worker.id ? (
                <form
                  className="flex items-center gap-2 min-w-0 flex-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitRename(worker.id);
                  }}
                >
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    autoFocus
                    className="bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded px-2 py-1 text-sm min-w-0 flex-1"
                    onKeyDown={(e) => {
                      if (e.key === "Escape") cancelEditing();
                    }}
                  />
                  <button
                    type="submit"
                    className="text-xs text-[var(--accent)] hover:text-[var(--accent-hover)] cursor-pointer whitespace-nowrap"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={cancelEditing}
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer whitespace-nowrap"
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="min-w-0">
                  <div className="flex items-center">
                    <p className="text-sm font-medium truncate">{worker.name}</p>
                    {worker.apiKeyId && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-400 ml-2 shrink-0">
                        BYOK
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-faint)]">
                    {worker.status === "online" ? "Online" : "Offline"}
                    {" \u00b7 "}
                    {worker.lastSeenAt
                      ? `Last seen ${timeAgo(worker.lastSeenAt)}`
                      : "Never seen"}
                  </p>
                </div>
              )}
            </div>

            {/* Right side: actions (hidden for shared workers) */}
            {editingId !== worker.id && worker.userId !== null && (
              <div className="flex items-center gap-2 shrink-0">
                {confirmDeleteId === worker.id ? (
                  <span className="flex items-center gap-2 text-xs">
                    <span className="text-[var(--text-secondary)]">
                      Remove?
                    </span>
                    <button
                      onClick={() => confirmRemove(worker.id)}
                      className="text-red-500 hover:text-red-400 cursor-pointer"
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
                  <>
                    {WORKER_SETTINGS_ENABLED && (
                      <button
                        onClick={() => setSettingsOpenId(settingsOpenId === worker.id ? null : worker.id)}
                        className={`text-xs cursor-pointer ${
                          settingsOpenId === worker.id
                            ? "text-[var(--accent-emphasis)]"
                            : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                        }`}
                        title="Rig init settings"
                      >
                        Settings
                      </button>
                    )}
                    <button
                      onClick={() => startEditing(worker.id, worker.name)}
                      className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer"
                      title="Rename worker"
                    >
                      Edit
                    </button>
                    {hasPermission("worker:delete") && (
                      <button
                        onClick={() => setConfirmDeleteId(worker.id)}
                        className="text-xs text-[var(--text-muted)] hover:text-red-500 cursor-pointer"
                        title="Remove worker"
                      >
                        Remove
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Expandable settings panel — hidden behind WORKER_SETTINGS_ENABLED
              until the runtime honors per-worker DB settings. See comment
              at the top of this file. */}
          {WORKER_SETTINGS_ENABLED && settingsOpenId === worker.id && (
            <WorkerSettingsPanel workerId={worker.id} />
          )}
        </div>
      ))}
    </div>
  );
}
