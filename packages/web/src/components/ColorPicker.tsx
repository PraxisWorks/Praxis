import { useState, useEffect } from "react";
import { COLOR_OPTIONS } from "../lib/constants.js";
import { hexToHsv, hsvToHex } from "../lib/colorUtils.js";
import { SaturationPanel } from "./SaturationPanel.js";
import { HueSlider } from "./HueSlider.js";
import { HexInput } from "./HexInput.js";

type ColorPickerProps = {
  value: string;
  onChange: (color: string) => void;
};

/**
 * Full-spectrum color picker composing a saturation/brightness panel,
 * hue slider, hex input, and preset swatches.
 * Selected color is communicated as a hex string via onChange.
 */
export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const [hsv, setHsv] = useState(() => hexToHsv(value));

  // Sync internal HSV state when the value prop changes externally
  useEffect(() => {
    const currentHex = hsvToHex(hsv.h, hsv.s, hsv.v);
    if (currentHex !== value.toLowerCase()) {
      setHsv(hexToHsv(value));
    }
    // Only react to external value changes, not internal hsv state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function handleSaturationChange(s: number, v: number) {
    setHsv((prev) => ({ ...prev, s, v }));
    onChange(hsvToHex(hsv.h, s, v));
  }

  function handleHueChange(h: number) {
    setHsv((prev) => ({ ...prev, h }));
    onChange(hsvToHex(h, hsv.s, hsv.v));
  }

  function handleHexChange(hex: string) {
    onChange(hex);
    setHsv(hexToHsv(hex));
  }

  function handleSwatchClick(hex: string) {
    onChange(hex);
    setHsv(hexToHsv(hex));
  }

  return (
    <div className="flex flex-col gap-3">
      <SaturationPanel
        hue={hsv.h}
        saturation={hsv.s}
        value={hsv.v}
        onChange={handleSaturationChange}
      />

      <HueSlider hue={hsv.h} onChange={handleHueChange} />

      <HexInput value={value} onChange={handleHexChange} />

      <div className="flex gap-2 flex-wrap">
        {COLOR_OPTIONS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => handleSwatchClick(c)}
            className={`w-8 h-8 rounded-full cursor-pointer border-2 transition-colors ${
              value === c
                ? "border-[var(--text-primary)] ring-2 ring-[var(--text-primary)]/20"
                : "border-transparent"
            }`}
            style={{ backgroundColor: c }}
            aria-label={`Select color ${c}`}
          />
        ))}
      </div>
    </div>
  );
}
