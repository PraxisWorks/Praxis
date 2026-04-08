import { useRef, useCallback, useEffect } from "react";
import { hsvToHex } from "../lib/colorUtils.js";

type SaturationPanelProps = {
  hue: number;
  saturation: number;
  value: number;
  onChange: (saturation: number, value: number) => void;
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/**
 * Draggable saturation/brightness panel.
 * X-axis controls saturation (0-1, left to right).
 * Y-axis controls value/brightness (1-0, top to bottom).
 * Background shows the current hue with white and black gradient overlays.
 */
export function SaturationPanel({
  hue,
  saturation,
  value,
  onChange,
}: SaturationPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const computeSV = useCallback(
    (clientX: number, clientY: number) => {
      const panel = panelRef.current;
      if (!panel) return;

      const rect = panel.getBoundingClientRect();
      const offsetX = clientX - rect.left;
      const offsetY = clientY - rect.top;

      const s = clamp(offsetX / rect.width, 0, 1);
      const v = clamp(1 - offsetY / rect.height, 0, 1);

      onChange(s, v);
    },
    [onChange],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      isDragging.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      computeSV(e.clientX, e.clientY);
    },
    [computeSV],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging.current) return;
      e.preventDefault();
      computeSV(e.clientX, e.clientY);
    },
    [computeSV],
  );

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  useEffect(() => {
    const handleGlobalUp = () => {
      isDragging.current = false;
    };
    window.addEventListener("pointerup", handleGlobalUp);
    return () => window.removeEventListener("pointerup", handleGlobalUp);
  }, []);

  const baseColor = hsvToHex(hue, 1, 1);
  const cursorLeft = `${saturation * 100}%`;
  const cursorTop = `${(1 - value) * 100}%`;

  return (
    <div
      ref={panelRef}
      className="relative w-full max-w-[448px] cursor-crosshair select-none touch-none rounded-lg overflow-hidden"
      style={{
        aspectRatio: "16 / 10",
        backgroundColor: baseColor,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* White to transparent gradient (left to right) */}
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(to right, #ffffff, transparent)",
        }}
      />

      {/* Transparent to black gradient (top to bottom) */}
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(to bottom, transparent, #000000)",
        }}
      />

      {/* Cursor indicator */}
      <div
        className="absolute pointer-events-none"
        style={{
          left: cursorLeft,
          top: cursorTop,
          transform: "translate(-50%, -50%)",
          width: 14,
          height: 14,
          borderRadius: "50%",
          border: "2px solid #ffffff",
          boxShadow:
            "0 0 0 1px rgba(0, 0, 0, 0.3), 0 1px 3px rgba(0, 0, 0, 0.4)",
        }}
      />
    </div>
  );
}
