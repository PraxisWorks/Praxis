import { useState } from "react";
import type { StructuredQuestionItem } from "@praxis2/shared";

type StructuredQuestionProps = {
  messageId: string;
  questions: StructuredQuestionItem[];
  onAnswer: (
    messageId: string,
    formattedResponse: string,
    selectedOptions: string[],
  ) => void;
  isAnswered: boolean;
  selectedOptions?: string[];
};

function OptionCard({
  label,
  description,
  selected,
  disabled,
  isMulti,
  onClick,
}: {
  label: string;
  description: string;
  selected: boolean;
  disabled: boolean;
  isMulti: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full text-left rounded border px-3 py-2 transition-colors cursor-pointer ${
        selected
          ? "border-[var(--accent)] bg-[var(--accent-light)]"
          : "border-[var(--border-secondary)] hover:bg-[var(--bg-secondary)]"
      } ${disabled ? "opacity-60 cursor-default" : ""}`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-xs text-[var(--text-faint)]">
          {isMulti ? (selected ? "\u2611" : "\u2610") : selected ? "\u25C9" : "\u25CB"}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            {label}
          </p>
          <p className="text-xs text-[var(--text-faint)] mt-0.5">
            {description}
          </p>
        </div>
      </div>
    </button>
  );
}

export function StructuredQuestion({
  messageId,
  questions,
  onAnswer,
  isAnswered,
  selectedOptions = [],
}: StructuredQuestionProps) {
  const [selections, setSelections] = useState<Record<number, string[]>>({});
  const [otherTexts, setOtherTexts] = useState<Record<number, string>>({});

  function toggleOption(
    questionIdx: number,
    label: string,
    isMulti: boolean,
  ) {
    setSelections((prev) => {
      const current = prev[questionIdx] ?? [];
      if (isMulti) {
        return {
          ...prev,
          [questionIdx]: current.includes(label)
            ? current.filter((l) => l !== label)
            : [...current, label],
        };
      }
      return {
        ...prev,
        [questionIdx]: current.includes(label) ? [] : [label],
      };
    });
  }

  function handleSubmit() {
    const allSelected: string[] = [];
    const parts: string[] = [];

    for (let i = 0; i < questions.length; i++) {
      const sel = selections[i] ?? [];
      const other = otherTexts[i]?.trim();
      const combined = other ? [...sel, other] : sel;
      allSelected.push(...combined);
      if (combined.length > 0) {
        parts.push(`Selected: ${combined.join(", ")}`);
      }
    }

    onAnswer(messageId, parts.join("; "), allSelected);
  }

  const hasSelection =
    Object.values(selections).some((s) => s.length > 0) ||
    Object.values(otherTexts).some((t) => t.trim().length > 0);

  return (
    <div className="space-y-4 py-2">
      {questions.map((q, qIdx) => {
        const currentSel = isAnswered
          ? selectedOptions
          : (selections[qIdx] ?? []);

        return (
          <div key={qIdx} className="space-y-2">
            {/* Header chip + question */}
            <div className="flex items-center gap-2 flex-wrap">
              {q.header && (
                <span className="inline-block text-[10px] font-semibold uppercase tracking-wide bg-[var(--accent)] text-white rounded-full px-2 py-0.5">
                  {q.header}
                </span>
              )}
              {isAnswered && (
                <span className="inline-block bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded">
                  Answered
                </span>
              )}
            </div>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {q.question}
            </p>

            {/* Options */}
            <div className="space-y-1.5">
              {q.options.map((opt: { label: string; description: string }) => (
                <OptionCard
                  key={opt.label}
                  label={opt.label}
                  description={opt.description}
                  selected={currentSel.includes(opt.label)}
                  disabled={isAnswered}
                  isMulti={q.multiSelect}
                  onClick={() =>
                    toggleOption(qIdx, opt.label, q.multiSelect)
                  }
                />
              ))}

              {/* Other free-text option */}
              <div
                className={`w-full rounded border px-3 py-2 transition-colors ${
                  isAnswered
                    ? "border-[var(--border-secondary)] opacity-60"
                    : "border-[var(--border-secondary)]"
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 text-xs text-[var(--text-faint)]">
                    {q.multiSelect ? "\u2610" : "\u25CB"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      Other
                    </p>
                    <input
                      type="text"
                      disabled={isAnswered}
                      placeholder="Type your answer..."
                      value={isAnswered ? "" : (otherTexts[qIdx] ?? "")}
                      onChange={(e) =>
                        setOtherTexts((prev) => ({
                          ...prev,
                          [qIdx]: e.target.value,
                        }))
                      }
                      className="mt-1 w-full text-xs bg-transparent border-b border-[var(--border-secondary)] py-0.5 text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none disabled:cursor-default"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* Submit button */}
      {!isAnswered && (
        <button
          type="button"
          disabled={!hasSelection}
          onClick={handleSubmit}
          className={`rounded px-4 py-2 text-sm font-medium text-white transition-colors ${
            hasSelection
              ? "bg-[var(--accent)] hover:bg-[var(--accent-hover)] cursor-pointer"
              : "bg-[var(--accent)] opacity-40 cursor-not-allowed"
          }`}
        >
          Submit
        </button>
      )}
    </div>
  );
}
