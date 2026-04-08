import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

// In CI the tag name is available via GITHUB_REF_NAME.
// Strip the "worker-v" or "v" prefix to get the real publish version.
const refName = process.env.GITHUB_REF_NAME ?? "";
const version = refName.startsWith("worker-v")
  ? refName.slice("worker-v".length)
  : refName.startsWith("v")
    ? refName.slice("v".length)
    : pkg.version;

export default defineConfig({
  entry: {
    "cli/praxis": "src/cli/praxis.ts",
    "cli/px": "src/cli/px.ts",
    index: "src/index.ts",
  },
  format: "esm",
  target: "node20",
  platform: "node",
  splitting: true,
  clean: true,
  outDir: "dist-publish",
  define: {
    __PRAXIS_VERSION__: JSON.stringify(version),
  },
  // Inline workspace packages — they get bundled into the output
  noExternal: ["@praxis2/shared", "@praxis2/api"],
  // Everything else stays external (installed via npm)
  external: [
    "pg-boss",
    "postgres",
    "drizzle-orm",
    "drizzle-orm/pg-core",
    "chokidar",
    "pino",
    "zod",
    "dotenv",
    "dotenv/config",
    "@anthropic-ai/sdk",
    "bcrypt",
  ],
  // Copy skill .md files into dist-publish so they're included in the npm package.
  // The worker's resolveSkillsDir() checks join(__dirname, "skills") which resolves
  // to dist-publish/skills/ in the published package.
  onSuccess: "cp -r ../shared/skills dist-publish/skills",
});
