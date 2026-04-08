import { useRef, useCallback, useEffect, useState } from "react";

type HueSliderProps = {
  hue: number;
  onChange: (hue: number) => void;
};

const HUE_GRADIENT =
  "linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)";

function clampHue(value: number): number {
  return Math.max(0, Math.min(360, value));
}

function hueFromClientX(clientX: number, bar: HTMLDivElement): number {
  const rect = bar.getBoundingClientRect();
  const offsetX = clientX - rect.left;
  const ratio = offsetX / rect.width;
  return clampHue(Math.round(ratio * 360));
}

/**
 * Horizontal hue slider spanning 0-360 degrees with a draggable thumb.
 */
export function HueSlider({ hue, onChange }: HueSliderProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleUpdate = useCallback(
    (clientX: number) => {
      if (!barRef.current) return;
      onChange(hueFromClientX(clientX, barRef.current));
    },
    [onChange],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setDragging(true);
      handleUpdate(e.clientX);
    },
    [handleUpdate],
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      setDragging(true);
      handleUpdate(e.touches[0].clientX);
    },
    [handleUpdate],
  );

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      handleUpdate(e.clientX);
    };

    const handleMouseUp = () => {
      setDragging(false);
    };

    const handleTouchMove = (e: TouchEvent) => {
      handleUpdate(e.touches[0].clientX);
    };

    const handleTouchEnd = () => {
      setDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("touchmove", handleTouchMove);
    window.addEventListener("touchend", handleTouchEnd);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [dragging, handleUpdate]);

  const thumbLeft = `${(hue / 360) * 100}%`;

  return (
    <div
      ref={barRef}
      className="relative w-full h-4 rounded-lg cursor-pointer select-none"
      style={{
        background: HUE_GRADIENT,
        border: "1px solid var(--border-secondary)",
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      role="slider"
      aria-label="Hue"
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={hue}
      tabIndex={0}
    >
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full pointer-events-none"
        style={{
          left: thumbLeft,
          width: 20,
          height: 20,
          border: "3px solid white",
          boxShadow: "0 0 2px rgba(0,0,0,0.4)",
          backgroundColor: `hsl(${hue}, 100%, 50%)`,
        }}
      />
    </div>
  );
}
