import { Link, useLocation } from "react-router-dom";

const ADMIN_TABS = [
  { path: "/admin/roles", label: "Roles & Permissions" },
  { path: "/admin/users", label: "User Management" },
  { path: "/admin/settings", label: "Settings" },
] as const;

export function AdminNav() {
  const location = useLocation();

  return (
    <div className="flex gap-1 mb-6 border-b border-[var(--border-primary)]">
      {ADMIN_TABS.map((tab) => {
        const isActive = location.pathname === tab.path;
        return (
          <Link
            key={tab.path}
            to={tab.path}
            className={`px-3 py-2 text-sm font-medium no-underline border-b-2 transition-colors ${
              isActive
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--border-secondary)]"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
