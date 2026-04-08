import { useState, useRef, useEffect } from "react";

type SchedulePickerProps = {
  onSchedule: (scheduledFor: string | undefined) => void;
  onClose: () => void;
  isStarting: boolean;
};

export function SchedulePicker({ onSchedule, onClose, isStarting }: SchedulePickerProps) {
  const [dateTime, setDateTime] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Click-outside to close (same pattern as PhaseConfigPopover)
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  // Compute min datetime (now) and max datetime (30 days from now)
  const now = new Date();
  const minDateTime = toLocalISOString(now);
  const maxDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const maxDateTime = toLocalISOString(maxDate);

  const handleSchedule = () => {
    if (!dateTime) {
      setError("Please select a date and time");
      return;
    }

    const selected = new Date(dateTime);
    if (selected <= new Date()) {
      setError("Must be in the future");
      return;
    }
    if (selected > maxDate) {
      setError("Must be within 30 days");
      return;
    }

    setError(null);
    onSchedule(selected.toISOString());
  };

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      className="absolute right-0 top-full mt-1 z-50 w-72 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-lg p-3"
    >
      <h4 className="text-xs font-semibold text-[var(--text-secondary)] mb-2">
        Schedule Session
      </h4>

      <div className="space-y-2 mb-3">
        <input
          type="datetime-local"
          value={dateTime}
          min={minDateTime}
          max={maxDateTime}
          onChange={(e) => {
            setDateTime(e.target.value);
            setError(null);
          }}
          className="w-full px-2 py-1.5 text-[11px] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
        />
        {error && (
          <p className="text-[10px] text-red-500">{error}</p>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-[var(--border-primary)] pt-2">
        <button
          onClick={() => onSchedule(undefined)}
          disabled={isStarting}
          className="px-2 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer"
        >
          Start Now
        </button>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={isStarting}
            className="px-2 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSchedule}
            disabled={isStarting || !dateTime}
            className="px-3 py-1 text-[11px] font-medium bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isStarting ? "Scheduling..." : "Schedule"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Convert a Date to a local ISO string suitable for datetime-local inputs (YYYY-MM-DDTHH:mm) */
function toLocalISOString(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
