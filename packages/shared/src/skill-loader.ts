/**
 * Loads skill markdown files and returns a Record keyed by session type.
 *
 * Uses multi-candidate path resolution so the skills directory is found
 * regardless of runtime environment (dev via tsx, local build via tsc, or
 * published bundle via tsup). Falls back to SYSTEM_INSTRUCTION_DEFAULTS
 * for any file that cannot be read.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SYSTEM_INSTRUCTION_DEFAULTS } from "./prompt-defaults.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SKILL_MAP: Record<string, string> = {
  spec: "spec-workshop.md",
  architecture: "architect-workshop.md",
  debug: "debug.md",
  working: "working.md",
  repo: "repo-chat.md",
};

/**
 * Resolve the skills directory across all runtime environments:
 *
 * - Dev (tsx):         __dirname = src/     -> ../skills
 * - Local build (tsc): __dirname = dist/    -> ../skills
 * - Published (tsup):  __dirname = <root>/  -> ./skills
 */
function resolveSkillsDir(): string {
  const candidates = [
    join(__dirname, "..", "skills"), // dev (src/) or tsc (dist/)
    join(__dirname, "skills"),      // tsup published (chunk at package root)
  ];

  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }

  return candidates[0];
}

let cache: Record<string, string> | null = null;

/**
 * Loads all skill .md files from the skills/ directory and returns a
 * Record<string, string> keyed by session type (spec, architecture, debug,
 * working, repo).
 *
 * Results are cached after the first successful load. Falls back to
 * SYSTEM_INSTRUCTION_DEFAULTS for any file that cannot be read.
 */
export async function loadSkillDefaults(): Promise<Record<string, string>> {
  if (cache) return cache;

  const skillsDir = resolveSkillsDir();
  const result: Record<string, string> = {};

  await Promise.all(
    Object.entries(SKILL_MAP).map(async ([key, filename]) => {
      try {
        result[key] = await readFile(join(skillsDir, filename), "utf-8");
      } catch {
        result[key] = SYSTEM_INSTRUCTION_DEFAULTS[key] ?? "";
      }
    }),
  );

  cache = result;
  return cache;
}
