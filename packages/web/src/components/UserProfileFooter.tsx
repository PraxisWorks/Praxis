import { useAuth0 } from "@auth0/auth0-react";
import { Link } from "react-router-dom";
import { usePermissions } from "@praxis2/hooks";
import { useTheme } from "../contexts/ThemeContext.js";

function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setTheme(theme === "light" ? "dark" : "light");
      }}
      className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
      aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
      title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
    >
      {theme === "light" ? (
        /* Moon icon — shown in light mode, click to go dark */
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
          />
        </svg>
      ) : (
        /* Sun icon — shown in dark mode, click to go light */
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
      )}
    </button>
  );
}

export function UserProfileFooter() {
  const { isLoading, user } = useAuth0();
  const { hasAnyPermission } = usePermissions();

  const showAdmin = hasAnyPermission(
    "admin:users:manage",
    "admin:roles:manage",
    "admin:permissions:manage",
  );

  if (isLoading) return null;

  return (
    <div className="border-t border-[var(--border-primary)]">
      <div className="flex items-center px-3 py-2.5">
        <Link
          to="/profile"
          className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-80 transition-opacity no-underline"
        >
          {user?.picture ? (
            <img
              src={user.picture}
              alt={user.name ?? "User avatar"}
              className="w-8 h-8 rounded-full shrink-0"
            />
          ) : (
            <span className="w-8 h-8 rounded-full bg-[var(--accent-light)] text-[var(--accent)] flex items-center justify-center text-sm font-medium shrink-0">
              {user?.name?.charAt(0) ?? "?"}
            </span>
          )}
          <span className="text-sm text-[var(--text-secondary)] truncate">
            {user?.name}
          </span>
        </Link>
        {showAdmin && (
          <Link
            to="/admin/roles"
            className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            title="Admin Panel"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </Link>
        )}
        <ThemeToggle />
      </div>
    </div>
  );
}
