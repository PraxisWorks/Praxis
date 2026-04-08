/**
 * Loads skill markdown files for session system prompts.
 *
 * Each session type can have a corresponding skill file that gets passed
 * as --system-prompt to the Claude CLI. The skill file contains the full
 * behavioral instructions for that session type.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { getLogger } from "../logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the skills directory, preferring @praxis2/shared's canonical location.
 *
 * 1. Try to resolve @praxis2/shared's package.json and use its sibling skills/ dir.
 * 2. Fall back to monorepo-relative and legacy worker paths for environments where
 *    the shared package isn't resolvable (e.g. isolated builds, tests).
 */
function resolveSkillsDir(): string {
  const require = createRequire(import.meta.url);

  // Try to find @praxis2/shared's package location
  try {
    const sharedPkgPath = require.resolve("@praxis2/shared/package.json");
    const sharedRoot = dirname(sharedPkgPath);
    const sharedSkills = join(sharedRoot, "skills");
    if (existsSync(sharedSkills)) return sharedSkills;
  } catch {
    // @praxis2/shared not resolvable, try local candidates
  }

  // Fallback candidates for when shared isn't resolvable
  const candidates = [
    join(__dirname, "..", "..", "..", "shared", "skills"),  // monorepo workspace
    join(__dirname, "..", "..", "skills"),                  // legacy: worker/skills/ still exists
    join(__dirname, "skills"),
    join(__dirname, "..", "skills"),
  ];

  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }

  // Fallback — will fail gracefully in loadSkill / getSystemPromptArgs
  return candidates[0];
}

const SKILLS_DIR = resolveSkillsDir();

const SKILL_MAP: Record<string, string> = {
  spec: "spec-workshop.md",
  architecture: "architect-workshop.md",
  debug: "debug.md",
  working: "working.md",
  repo: "repo-chat.md",
};

/**
 * Returns the absolute path to the skill file for a session type, or null if
 * the session type has no skill file.
 */
export function getSkillPath(type: "spec" | "architecture" | "debug" | "working" | "repo"): string | null {
  const filename = SKILL_MAP[type];
  if (!filename) return null;
  return join(SKILLS_DIR, filename);
}

/**
 * Loads and returns the skill file contents for a session type.
 * Returns null if the file doesn't exist or can't be read.
 */
export async function loadSkill(type: "spec" | "architecture" | "debug" | "working" | "repo"): Promise<string | null> {
  const logger = getLogger();
  const skillPath = getSkillPath(type);
  if (!skillPath) return null;

  try {
    const content = await readFile(skillPath, "utf-8");
    logger.info({ type, skillPath }, "Loaded skill file for session");
    return content;
  } catch {
    logger.debug({ type, skillPath }, "Skill file not found, skipping");
    return null;
  }
}

/**
 * Returns the CLI args for --system-prompt if a skill file exists.
 * Returns an empty array if no skill file is available.
 *
 * The claude CLI --system-prompt flag expects the prompt content as a string,
 * so we read the file and return its contents (not the path).
 */
export async function getSystemPromptArgs(type: "spec" | "architecture" | "debug" | "working" | "repo"): Promise<string[]> {
  const logger = getLogger();
  const skillPath = getSkillPath(type);
  if (!skillPath) return [];

  try {
    const content = await readFile(skillPath, "utf-8");
    logger.info({ type, skillPath }, "Loaded skill file for session");
    return ["--system-prompt", content];
  } catch {
    logger.warn({ type, skillPath, skillsDir: SKILLS_DIR }, "Skill file not found for --system-prompt — falling back to hardcoded prompt. This likely means skills/ was not included in the published package.");
    return [];
  }
}
