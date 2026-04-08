import { useState, useRef, useEffect } from "react";
import { PHASES, MODE_LABELS, MODE_COLORS, PHASE_MODES } from "../lib/phaseConfig.js";
import type { PhaseMode, PhaseConfig } from "../lib/phaseConfig.js";

type PhaseConfigPopoverProps = {
  onStart: (phaseConfig: PhaseConfig) => void;
  onClose: () => void;
  isStarting: boolean;
};

export function PhaseConfigPopover({
  onStart,
  onClose,
  isStarting,
}: PhaseConfigPopoverProps) {
  const [modes, setModes] = useState<PhaseMode[]>(PHASES.map(() => "ai-assisted"));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const setAll = (mode: PhaseMode) => setModes(PHASES.map(() => mode));

  const handleStart = () => {
    onStart(PHASES.map((phase, i) => ({ phase, mode: modes[i] })));
  };

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      className="absolute right-0 top-full mt-1 z-50 w-80 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-lg p-3"
    >
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold text-[var(--text-secondary)]">
          Phase Configuration
        </h4>
        <div className="flex gap-1">
          <button
            onClick={() => setAll("ai-assisted")}
            className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-primary)] hover:bg-[var(--bg-secondary)] cursor-pointer"
          >
            All Interactive
          </button>
          <button
            onClick={() => setAll("full-ai")}
            className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-primary)] hover:bg-[var(--bg-secondary)] cursor-pointer"
          >
            All AI
          </button>
        </div>
      </div>

      <div className="space-y-1 mb-3">
        {PHASES.map((phase, i) => (
          <div
            key={phase}
            className="flex items-center justify-between py-0.5 px-1 rounded hover:bg-[var(--bg-secondary)]"
          >
            <span className="text-[11px] text-[var(--text-secondary)]">
              <span className="text-[var(--text-faint)] mr-1">{i + 1}.</span>
              {phase}
            </span>
            <div className="flex gap-0.5">
              {PHASE_MODES.map((mode) => (
                <button
                  key={mode}
                  onClick={() => {
                    const next = [...modes];
                    next[i] = mode;
                    setModes(next);
                  }}
                  className={`text-[10px] px-1.5 py-0.5 rounded border cursor-pointer transition-colors ${
                    modes[i] === mode
                      ? MODE_COLORS[mode]
                      : "border-transparent text-[var(--text-faint)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  {MODE_LABELS[mode]}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-[var(--border-primary)] pt-2">
        <button
          onClick={onClose}
          disabled={isStarting}
          className="px-2 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer"
        >
          Cancel
        </button>
        <button
          onClick={handleStart}
          disabled={isStarting}
          className="px-3 py-1 text-[11px] font-medium bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isStarting ? "Starting..." : "Start Session"}
        </button>
      </div>
    </div>
  );
}
