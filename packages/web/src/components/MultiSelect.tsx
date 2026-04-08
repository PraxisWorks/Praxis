import { useState, useRef, useEffect } from "react";

export interface MultiSelectOption {
  value: string;
  label: string;
}

export interface MultiSelectProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  ariaLabel: string;
}

export function MultiSelect({ options, selected, onChange, placeholder, ariaLabel }: MultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function toggleValue(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  const label =
    selected.length === 0
      ? `All ${placeholder}`
      : selected.length === 1
        ? options.find((o) => o.value === selected[0])?.label ?? `1 ${placeholder.replace(/s$/, "")}`
        : `${selected.length} ${placeholder}`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="text-xs border border-[var(--border-secondary)] rounded px-2 py-1 bg-[var(--bg-primary)] text-[var(--text-secondary)] focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer flex items-center gap-1"
        aria-label={ariaLabel}
      >
        <span>{label}</span>
        <svg
          className={`w-3 h-3 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-1 min-w-[180px] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded shadow-lg z-50 max-h-60 overflow-y-auto">
          {options.length === 0 ? (
            <p className="px-3 py-2 text-xs text-[var(--text-faint)]">No {placeholder.toLowerCase()}</p>
          ) : (
            <>
              {selected.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    onChange([]);
                    setIsOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-[var(--accent-emphasis)] hover:bg-[var(--bg-tertiary)] cursor-pointer border-b border-[var(--border-primary)]"
                >
                  Clear filter
                </button>
              )}
              {options.map((option) => {
                const checked = selected.includes(option.value);
                return (
                  <label
                    key={option.value}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--bg-tertiary)] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleValue(option.value)}
                      className="rounded border-[var(--border-secondary)] text-[var(--accent)] focus:ring-[var(--accent)]"
                    />
                    <span className={checked ? "text-[var(--accent-emphasis)] font-medium" : "text-[var(--text-secondary)]"}>
                      {option.label}
                    </span>
                  </label>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
