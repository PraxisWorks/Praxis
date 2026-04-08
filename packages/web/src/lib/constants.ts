/** Predefined color options for repo accent colors. */
export const COLOR_OPTIONS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#14b8a6", // teal
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#a855f7", // purple
  "#ec4899", // pink
  "#64748b", // slate
] as const;

/**
 * Curated Lucide icon names for repo identification.
 * Each entry is a lowercase hyphenated string matching Lucide naming convention.
 * Import icons in components via: import { iconName } from "lucide-react"
 * (convert hyphenated names to PascalCase: "git-branch" → GitBranch)
 */
export const ICON_OPTIONS = [
  // Development
  "code", "terminal", "git-branch", "bug", "database", "server", "cpu", "monitor",
  // Business
  "briefcase", "building", "chart-bar", "trending-up", "wallet", "receipt",
  // Creative
  "palette", "pen-tool", "camera", "music", "paintbrush", "scissors",
  // Science
  "flask", "atom", "microscope", "beaker", "dna",
  // Communication
  "message-circle", "mail", "phone", "megaphone", "send",
  // Nature
  "leaf", "sun", "moon", "cloud", "mountain", "tree-pine",
  // General
  "rocket", "star", "heart", "zap", "shield", "crown", "gem", "target",
  "flag", "compass", "anchor", "globe", "infinity", "layers", "box",
  "package", "puzzle", "wrench", "settings", "lightbulb", "book-open",
  "graduation-cap", "trophy", "home", "map", "users", "user", "key",
  "lock", "eye", "search",
] as const;

/** Type for a valid icon option. */
export type IconOption = (typeof ICON_OPTIONS)[number];
