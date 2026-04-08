import { useState } from "react";
import { NavLink } from "react-router-dom";

type DocSection = {
  title: string;
  items: { label: string; to: string }[];
};

const sections: DocSection[] = [
  {
    title: "Getting Started",
    items: [
      { label: "Quick Start Guide", to: "/documentation/getting-started" },
    ],
  },
  {
    title: "Core Workflows",
    items: [
      { label: "Ideas", to: "/documentation/ideas" },
      { label: "Architecture Sessions", to: "/documentation/architect-sessions" },
      { label: "Working Sessions", to: "/documentation/working-sessions" },
    ],
  },
  {
    title: "Views & Tools",
    items: [
      { label: "Board & Graph", to: "/documentation/board-and-graph" },
      { label: "Question Queue", to: "/documentation/questions" },
      { label: "Deployments", to: "/documentation/deployments" },
      { label: "Stats", to: "/documentation/stats" },
    ],
  },
];

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

function SidebarSection({ section }: { section: DocSection }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors rounded-md hover:bg-[var(--bg-tertiary)]"
      >
        <ChevronIcon open={open} />
        {section.title}
      </button>

      {open && (
        <ul className="ml-3 mt-0.5 space-y-0.5">
          {section.items.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end
                className={({ isActive }) =>
                  `block px-3 py-1.5 text-sm rounded-md no-underline transition-colors ${
                    isActive
                      ? "bg-[var(--accent-light)] text-[var(--accent)] font-medium"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                  }`
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DocSidebar({ onClose }: { onClose?: () => void }) {
  return (
    <nav className="w-64 shrink-0 border-r border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold text-[var(--text-primary)]">Documentation</h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="lg:hidden p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
            aria-label="Close sidebar"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <div className="space-y-1">
        {sections.map((section) => (
          <SidebarSection key={section.title} section={section} />
        ))}
      </div>

      {/* Feedback footer */}
      <div className="mt-6 pt-4 border-t border-[var(--border-primary)]">
        <a
          href="https://github.com/PraxisWorks/Praxis/issues/new"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-md transition-colors no-underline"
        >
          <svg
            className="w-3.5 h-3.5"
            fill="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
          </svg>
          <span>Have feedback? Open an issue on GitHub</span>
        </a>
      </div>
    </nav>
  );
}
