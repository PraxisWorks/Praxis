type RGB = { r: number; g: number; b: number };
type HSV = { h: number; s: number; v: number };

/**
 * Convert HSV color values to RGB.
 * @param h - Hue in degrees (0-360)
 * @param s - Saturation (0-1)
 * @param v - Value/brightness (0-1)
 * @returns RGB object with r, g, b in range 0-255
 */
export function hsvToRgb(h: number, s: number, v: number): RGB {
  const c = v * s;
  const hPrime = h / 60;
  const x = c * (1 - Math.abs((hPrime % 2) - 1));
  const m = v - c;

  let r1: number;
  let g1: number;
  let b1: number;

  if (hPrime < 1) {
    [r1, g1, b1] = [c, x, 0];
  } else if (hPrime < 2) {
    [r1, g1, b1] = [x, c, 0];
  } else if (hPrime < 3) {
    [r1, g1, b1] = [0, c, x];
  } else if (hPrime < 4) {
    [r1, g1, b1] = [0, x, c];
  } else if (hPrime < 5) {
    [r1, g1, b1] = [x, 0, c];
  } else {
    [r1, g1, b1] = [c, 0, x];
  }

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

/**
 * Convert RGB color values to a hex string.
 * @param r - Red channel (0-255)
 * @param g - Green channel (0-255)
 * @param b - Blue channel (0-255)
 * @returns Hex color string in #rrggbb format
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Parse a hex color string into RGB values.
 * @param hex - Hex color string in #rrggbb format
 * @returns RGB object with r, g, b in range 0-255
 */
export function hexToRgb(hex: string): RGB {
  const cleaned = hex.replace(/^#/, "");
  const value = parseInt(cleaned, 16);

  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

/**
 * Convert RGB color values to HSV.
 * @param r - Red channel (0-255)
 * @param g - Green channel (0-255)
 * @param b - Blue channel (0-255)
 * @returns HSV object with h (0-360), s (0-1), v (0-1)
 */
export function rgbToHsv(r: number, g: number, b: number): HSV {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;

  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const delta = max - min;

  let h: number;

  if (delta === 0) {
    h = 0;
  } else if (max === rNorm) {
    h = 60 * (((gNorm - bNorm) / delta) % 6);
  } else if (max === gNorm) {
    h = 60 * ((bNorm - rNorm) / delta + 2);
  } else {
    h = 60 * ((rNorm - gNorm) / delta + 4);
  }

  if (h < 0) {
    h += 360;
  }

  const s = max === 0 ? 0 : delta / max;
  const v = max;

  return { h, s, v };
}

/**
 * Convert HSV color values directly to a hex string.
 * @param h - Hue in degrees (0-360)
 * @param s - Saturation (0-1)
 * @param v - Value/brightness (0-1)
 * @returns Hex color string in #rrggbb format
 */
export function hsvToHex(h: number, s: number, v: number): string {
  const { r, g, b } = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
}

/**
 * Parse a hex color string into HSV values.
 * @param hex - Hex color string in #rrggbb format
 * @returns HSV object with h (0-360), s (0-1), v (0-1)
 */
export function hexToHsv(hex: string): HSV {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsv(r, g, b);
}
