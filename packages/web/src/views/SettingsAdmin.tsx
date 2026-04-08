import { AdminNav } from "../components/AdminNav.js";
import { trpc } from "@praxis2/hooks";

export function SettingsAdmin() {
  const settingsQuery = trpc.admin.getSystemSettings.useQuery();

  return (
    <div className="max-w-4xl mx-auto p-6">
      <AdminNav />

      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">System Settings</h2>
      <p className="text-sm text-[var(--text-muted)] mb-6">
        Global configuration that applies to all users and workers.
      </p>

      {settingsQuery.isLoading && (
        <p className="text-sm text-[var(--text-muted)]">Loading settings...</p>
      )}

      {settingsQuery.error && (
        <div className="p-3 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-sm mb-4">
          Failed to load settings: {settingsQuery.error.message}
        </div>
      )}

      {!settingsQuery.isLoading && !settingsQuery.error && (
        <div className="p-4 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]">
          <p className="text-sm text-[var(--text-muted)]">
            No configurable settings at this time.
          </p>
        </div>
      )}
    </div>
  );
}
