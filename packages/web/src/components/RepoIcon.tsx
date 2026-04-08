import { createElement } from "react";
import { icons } from "lucide-react";

type RepoIconProps = {
  /** Kebab-case Lucide icon name (e.g., "book-open", "rocket"). */
  name: string | null | undefined;
  /** Icon size in pixels. @default 16 */
  size?: number;
  /** Stroke / fill color (CSS value). */
  color?: string;
  /** Additional CSS classes. */
  className?: string;
};

/**
 * Converts a kebab-case icon name to PascalCase for Lucide lookup.
 * e.g., "book-open" → "BookOpen", "git-branch" → "GitBranch"
 */
function toPascalCase(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * Renders a Lucide icon by its kebab-case name.
 * Returns null if the name is falsy or doesn't match a known Lucide icon.
 */
export function RepoIcon({ name, size = 16, color, className }: RepoIconProps) {
  if (!name) return null;

  const pascalName = toPascalCase(name);
  const IconComponent = icons[pascalName as keyof typeof icons];

  if (!IconComponent) return null;

  return createElement(IconComponent, {
    size,
    color,
    strokeWidth: 1.75,
    className,
  });
}
