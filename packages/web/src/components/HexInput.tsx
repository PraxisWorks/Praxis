import { useState, useEffect } from "react";

type HexInputProps = {
  value: string;
  onChange: (hex: string) => void;
};

const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

function normalize(hex: string): string {
  return hex.toLowerCase();
}

/**
 * Text input with a color preview swatch for entering hex color values.
 * Accepts #RRGGBB format. Invalid input is ignored until a valid hex is entered.
 */
export function HexInput({ value, onChange }: HexInputProps) {
  const [text, setText] = useState(value);

  useEffect(() => {
    if (normalize(value) !== normalize(text)) {
      setText(value);
    }
    // Only sync when the external value prop changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    let input = e.target.value;

    // Ensure the value always starts with #
    if (!input.startsWith("#")) {
      input = "#" + input;
    }

    setText(input);

    if (HEX_REGEX.test(input)) {
      onChange(normalize(input));
    }
  }

  // The swatch always reflects the last valid external value
  const swatchColor = HEX_REGEX.test(value) ? value : "#000000";

  return (
    <div className="flex items-center gap-2">
      <div
        className="w-8 h-8 rounded border border-[var(--border-secondary)] shrink-0"
        style={{ backgroundColor: swatchColor }}
        aria-hidden="true"
      />
      <input
        type="text"
        value={text}
        onChange={handleChange}
        maxLength={7}
        spellCheck={false}
        autoComplete="off"
        className="px-3 py-2 border border-[var(--border-secondary)] rounded text-sm font-mono text-[var(--text-primary)] bg-[var(--bg-secondary)]"
        aria-label="Hex color value"
      />
    </div>
  );
}
