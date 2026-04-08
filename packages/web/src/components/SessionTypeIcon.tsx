import { createElement } from "react";
import { icons } from "lucide-react";

const SESSION_TYPE_ICONS: Record<string, string> = {
  spec: "file-text",
  architecture: "blocks",
  working: "wrench",
  debug: "bug",
  repo: "message-circle",
};

const LABELS: Record<string, string> = {
  spec: "Spec",
  architecture: "Architecture",
  working: "Working",
  debug: "Debug",
  repo: "Repo Chat",
};

function toPascalCase(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

type SessionTypeIconProps = {
  type: string;
  size?: number;
  className?: string;
};

export function SessionTypeIcon({ type, size = 14, className }: SessionTypeIconProps) {
  const iconName = SESSION_TYPE_ICONS[type] ?? "circle-help";
  const pascalName = toPascalCase(iconName);
  const IconComponent = icons[pascalName as keyof typeof icons];

  if (!IconComponent) return null;

  return (
    <span title={LABELS[type]} aria-label={LABELS[type]}>
      {createElement(IconComponent, {
        size,
        color: "white",
        strokeWidth: 1.75,
        className,
      })}
    </span>
  );
}
