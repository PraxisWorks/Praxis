/**
 * Generate all PNG icon assets from the block-P SVG source.
 *
 * Usage:  node scripts/generate-icons.mjs
 * Requires: sharp (devDependency)
 */
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const BRAND_BLUE = "#4f46e5";

/**
 * SVG source for the block-P icon: white P on indigo rounded-rect.
 * `size` sets the viewBox and pixel output dimensions.
 */
function iconSvg(size, { borderRadius = 0 } = {}) {
  // The P mark viewBox is 18x32.  Content spans roughly [1,16] x [1,31] = 15x30.
  // We want the P centered in the square with ~20% padding on each side.
  // Scale factor to fit 30-unit-tall P into (size * 0.6) pixels:
  const padFraction = 0.2;
  const innerH = size * (1 - 2 * padFraction); // 60% of size
  const scale = innerH / 32; // scale factor for viewBox units → pixels
  const innerW = 18 * scale;
  const tx = (size - innerW) / 2;
  const ty = (size - innerH) / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${borderRadius}" fill="${BRAND_BLUE}"/>
  <g transform="translate(${tx},${ty}) scale(${scale})">
    <path fill="#fff" fill-rule="evenodd"
      d="M1 1h8a7 7 0 0 1 0 14v16H1V1zm8 3.5a3.5 3.5 0 0 1 0 7V4.5z"/>
  </g>
</svg>`;
}

async function generate(outPath, size, opts = {}) {
  const svg = Buffer.from(iconSvg(size, opts));
  await sharp(svg).png().toFile(outPath);
  console.log(`  ${outPath}  (${size}x${size})`);
}

async function main() {
  console.log("Generating icon PNGs...\n");

  // ── Web favicons ──
  const webPublic = resolve(root, "packages/web/public");
  mkdirSync(webPublic, { recursive: true });

  await generate(resolve(webPublic, "favicon-32.png"), 32, { borderRadius: 6 });
  await generate(resolve(webPublic, "favicon-16.png"), 16, { borderRadius: 3 });
  await generate(resolve(webPublic, "apple-touch-icon.png"), 180, { borderRadius: 32 });
  await generate(resolve(webPublic, "icon-192.png"), 192, { borderRadius: 32 });
  await generate(resolve(webPublic, "icon-512.png"), 512, { borderRadius: 80 });


  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
