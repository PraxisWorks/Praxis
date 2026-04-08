import { type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth0 } from "@auth0/auth0-react";
import { PraxisLogo } from "./PraxisLogo.js";

type PublicLayoutProps = {
  children: ReactNode;
};

export function PublicLayout({ children }: PublicLayoutProps) {
  const { loginWithRedirect } = useAuth0();
  const location = useLocation();

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-primary)]">
      {/* Marketing Header */}
      <header className="h-16 border-b border-[var(--border-primary)] bg-[var(--bg-primary)]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto h-full flex items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2.5 no-underline">
            <PraxisLogo size={28} className="text-[var(--accent)]" />
            <span className="font-bold text-[var(--text-primary)] text-lg tracking-tight">
              Praxis
            </span>
          </Link>

          <nav className="flex items-center gap-6">
            <Link
              to="/documentation"
              className={`text-sm font-medium no-underline transition-colors ${
                location.pathname.startsWith("/documentation")
                  ? "text-[var(--accent)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              Documentation
            </Link>
            <a
              href="https://github.com/PraxisWorks/Praxis"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] no-underline transition-colors"
            >
              GitHub
            </a>
            <button
              type="button"
              onClick={() => loginWithRedirect()}
              className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[var(--accent-hover)] hover:shadow-md active:scale-[0.98]"
            >
              Sign In
            </button>
          </nav>
        </div>
      </header>

      {/* Page Content */}
      <main className="flex-1">{children}</main>

      {/* Footer */}
      <footer className="border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] py-12">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="md:col-span-1">
              <div className="flex items-center gap-2 mb-3">
                <PraxisLogo size={20} className="text-[var(--accent)]" />
                <span className="font-bold text-[var(--text-primary)] text-sm">
                  Praxis
                </span>
              </div>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                AI-powered development orchestration. Fully open source.
              </p>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
                Product
              </h4>
              <ul className="space-y-2">
                <li>
                  <Link
                    to="/"
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] no-underline transition-colors"
                  >
                    Features
                  </Link>
                </li>
                <li>
                  <Link
                    to="/documentation"
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] no-underline transition-colors"
                  >
                    Documentation
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
                Community
              </h4>
              <ul className="space-y-2">
                <li>
                  <a
                    href="https://github.com/PraxisWorks/Praxis"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] no-underline transition-colors"
                  >
                    GitHub
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/PraxisWorks/Praxis/issues"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] no-underline transition-colors"
                  >
                    Issues
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
                Open Source
              </h4>
              <ul className="space-y-2">
                <li>
                  <a
                    href="https://github.com/PraxisWorks/Praxis/blob/main/LICENSE"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] no-underline transition-colors"
                  >
                    License
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/PraxisWorks/Praxis/blob/main/CONTRIBUTING.md"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] no-underline transition-colors"
                  >
                    Contributing
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-[var(--border-primary)]">
            <p className="text-xs text-[var(--text-faint)] text-center">
              Built with care. Open source forever.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
