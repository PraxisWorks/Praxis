import { useState, useMemo } from "react";
import { X } from "lucide-react";
import { ICON_OPTIONS } from "../lib/constants.js";
import { RepoIcon } from "./RepoIcon.js";

type IconPickerProps = {
  value: string | null;
  onChange: (icon: string | null) => void;
};

/**
 * Searchable grid of Lucide icons. Selected icon is highlighted with a ring.
 * First position is a "None" button to clear the selection.
 */
export function IconPicker({ value, onChange }: IconPickerProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return ICON_OPTIONS;
    const q = search.toLowerCase().trim();
    return ICON_OPTIONS.filter((name) => name.includes(q));
  }, [search]);

  return (
    <div>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search icons..."
        className="w-full px-2 py-1 text-sm border border-[var(--border-secondary)] rounded mb-2"
      />
      <div className="grid grid-cols-8 gap-1 max-h-48 overflow-y-auto">
        {/* None button to clear selection */}
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`w-8 h-8 rounded flex items-center justify-center cursor-pointer border-2 transition-colors ${
            value === null ? "border-[var(--text-primary)] ring-2 ring-[var(--text-primary)]/20 bg-[var(--bg-tertiary)]" : "border-transparent hover:bg-[var(--bg-secondary)]"
          }`}
          aria-label="No icon"
        >
          <X size={14} className="text-[var(--text-faint)]" />
        </button>
        {filtered.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => onChange(name)}
            className={`w-8 h-8 rounded flex items-center justify-center cursor-pointer border-2 transition-colors ${
              value === name ? "border-[var(--text-primary)] ring-2 ring-[var(--text-primary)]/20 bg-[var(--bg-tertiary)]" : "border-transparent hover:bg-[var(--bg-secondary)]"
            }`}
            aria-label={`Select icon ${name}`}
            title={name}
          >
            <RepoIcon name={name} size={18} />
          </button>
        ))}
      </div>
    </div>
  );
}
