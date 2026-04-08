import { describe, it, expect } from "vitest";
import {
  hsvToRgb,
  rgbToHex,
  hexToRgb,
  rgbToHsv,
  hsvToHex,
  hexToHsv,
} from "./colorUtils";

describe("hsvToRgb", () => {
  it("converts pure red", () => {
    expect(hsvToRgb(0, 1, 1)).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("converts pure green", () => {
    expect(hsvToRgb(120, 1, 1)).toEqual({ r: 0, g: 255, b: 0 });
  });

  it("converts pure blue", () => {
    expect(hsvToRgb(240, 1, 1)).toEqual({ r: 0, g: 0, b: 255 });
  });

  it("converts pure white", () => {
    expect(hsvToRgb(0, 0, 1)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("converts pure black", () => {
    expect(hsvToRgb(0, 0, 0)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("converts yellow (secondary)", () => {
    expect(hsvToRgb(60, 1, 1)).toEqual({ r: 255, g: 255, b: 0 });
  });

  it("converts cyan (secondary)", () => {
    expect(hsvToRgb(180, 1, 1)).toEqual({ r: 0, g: 255, b: 255 });
  });

  it("converts magenta (secondary)", () => {
    expect(hsvToRgb(300, 1, 1)).toEqual({ r: 255, g: 0, b: 255 });
  });
});

describe("rgbToHex", () => {
  it("converts black", () => {
    expect(rgbToHex(0, 0, 0)).toBe("#000000");
  });

  it("converts white", () => {
    expect(rgbToHex(255, 255, 255)).toBe("#ffffff");
  });

  it("converts red", () => {
    expect(rgbToHex(255, 0, 0)).toBe("#ff0000");
  });

  it("converts green", () => {
    expect(rgbToHex(0, 255, 0)).toBe("#00ff00");
  });

  it("converts blue", () => {
    expect(rgbToHex(0, 0, 255)).toBe("#0000ff");
  });

  it("converts an arbitrary color", () => {
    expect(rgbToHex(171, 205, 239)).toBe("#abcdef");
  });
});

describe("hexToRgb", () => {
  it("parses black", () => {
    expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("parses white", () => {
    expect(hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("parses red", () => {
    expect(hexToRgb("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("parses an arbitrary color", () => {
    expect(hexToRgb("#abcdef")).toEqual({ r: 171, g: 205, b: 239 });
  });
});

describe("rgbToHsv", () => {
  it("converts pure white", () => {
    expect(rgbToHsv(255, 255, 255)).toEqual({ h: 0, s: 0, v: 1 });
  });

  it("converts pure black", () => {
    expect(rgbToHsv(0, 0, 0)).toEqual({ h: 0, s: 0, v: 0 });
  });

  it("converts pure red", () => {
    expect(rgbToHsv(255, 0, 0)).toEqual({ h: 0, s: 1, v: 1 });
  });

  it("converts pure green", () => {
    expect(rgbToHsv(0, 255, 0)).toEqual({ h: 120, s: 1, v: 1 });
  });

  it("converts pure blue", () => {
    expect(rgbToHsv(0, 0, 255)).toEqual({ h: 240, s: 1, v: 1 });
  });

  it("converts yellow", () => {
    expect(rgbToHsv(255, 255, 0)).toEqual({ h: 60, s: 1, v: 1 });
  });

  it("converts cyan", () => {
    expect(rgbToHsv(0, 255, 255)).toEqual({ h: 180, s: 1, v: 1 });
  });

  it("converts magenta", () => {
    expect(rgbToHsv(255, 0, 255)).toEqual({ h: 300, s: 1, v: 1 });
  });
});

describe("hsvToHex", () => {
  it("converts pure red", () => {
    expect(hsvToHex(0, 1, 1)).toBe("#ff0000");
  });

  it("converts pure green", () => {
    expect(hsvToHex(120, 1, 1)).toBe("#00ff00");
  });

  it("converts pure blue", () => {
    expect(hsvToHex(240, 1, 1)).toBe("#0000ff");
  });

  it("converts pure white", () => {
    expect(hsvToHex(0, 0, 1)).toBe("#ffffff");
  });

  it("converts pure black", () => {
    expect(hsvToHex(0, 0, 0)).toBe("#000000");
  });
});

describe("hexToHsv", () => {
  it("parses pure white", () => {
    expect(hexToHsv("#ffffff")).toEqual({ h: 0, s: 0, v: 1 });
  });

  it("parses pure black", () => {
    expect(hexToHsv("#000000")).toEqual({ h: 0, s: 0, v: 0 });
  });

  it("parses pure red", () => {
    expect(hexToHsv("#ff0000")).toEqual({ h: 0, s: 1, v: 1 });
  });

  it("parses pure green", () => {
    expect(hexToHsv("#00ff00")).toEqual({ h: 120, s: 1, v: 1 });
  });

  it("parses pure blue", () => {
    expect(hexToHsv("#0000ff")).toEqual({ h: 240, s: 1, v: 1 });
  });
});

describe("round-trip conversions", () => {
  const HEX_CASES = [
    "#000000",
    "#ffffff",
    "#ff0000",
    "#00ff00",
    "#0000ff",
    "#ffff00",
    "#00ffff",
    "#ff00ff",
    "#abcdef",
    "#123456",
    "#808080",
  ];

  it.each(HEX_CASES)("hex -> hsv -> hex preserves %s", (hex) => {
    const hsv = hexToHsv(hex);
    const result = hsvToHex(hsv.h, hsv.s, hsv.v);
    expect(result).toBe(hex);
  });

  it.each(HEX_CASES)("hex -> rgb -> hex preserves %s", (hex) => {
    const rgb = hexToRgb(hex);
    const result = rgbToHex(rgb.r, rgb.g, rgb.b);
    expect(result).toBe(hex);
  });
});
