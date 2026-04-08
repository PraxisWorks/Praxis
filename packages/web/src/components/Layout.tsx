import { useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { MessageCircle } from "lucide-react";
import { TabNav } from "./TabNav.js";
import { SessionsPanel } from "./SessionsPanel.js";
import { PraxisLogo } from "./PraxisLogo.js";
import { DeploymentFooter } from "./DeploymentFooter.js";
import { SessionsPanelProvider } from "../contexts/SessionsPanelContext.js";
import { useUnreadSessionCount, useSessions } from "@praxis2/hooks";

type LayoutProps = {
  sidebar: ReactNode;
  children: ReactNode;
};

const RIGHT_MIN = 320;
const RIGHT_MAX = 700;
const RIGHT_DEFAULT = 420;

export function Layout({ sidebar, children }: LayoutProps) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const [rightWidth, setRightWidth] = useState(RIGHT_DEFAULT);
  const dragging = useRef(false);

  // Reuse the same default filter as SessionsPanel so React Query deduplicates
  // into a single session.list call instead of two.
  const { sessions } = useSessions({ statusFilter: ["active", "paused"] });
  const { unreadSessionCount } = useUnreadSessionCount(sessions as any);
  const openRightPanel = useCallback(() => setRightOpen(true), []);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const w = window.innerWidth - e.clientX;
      setRightWidth(Math.max(RIGHT_MIN, Math.min(RIGHT_MAX, w)));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  return (
    <div className="h-screen flex flex-col">
      {/* Top bar: toggle buttons + branding */}
      <header className="h-12 border-b border-[var(--border-primary)] bg-[var(--bg-primary)] flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          {/* Left sidebar toggle */}
          <button
            onClick={() => setLeftOpen((o) => !o)}
            className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
            aria-label="Toggle repo sidebar"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
          <PraxisLogo size={20} className="text-[var(--accent)]" />
          <span className="font-semibold text-[var(--text-primary)] text-sm">Praxis</span>
        </div>
        <div className="flex items-center gap-3">
          {/* Right panel toggle */}
          <div className="relative">
            <button
              onClick={() => setRightOpen((o) => !o)}
              className={`rounded-full px-3 py-1.5 flex items-center gap-2 text-sm font-medium transition-colors ${
                rightOpen
                  ? "bg-[var(--accent-hover)] text-white ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--bg-primary)]"
                  : "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
              }`}
              aria-label="Toggle sessions panel"
            >
              <MessageCircle size={18} />
              <span className="hidden sm:inline">AI Sessions</span>
            </button>
            {unreadSessionCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 pointer-events-none">
                {unreadSessionCount}
              </span>
            )}
          </div>
        </div>
      </header>

      <SessionsPanelProvider onOpenPanel={openRightPanel}>
        <div className="flex flex-1 overflow-hidden">
          {/* Left sidebar - repo selector */}
          {leftOpen && (
            <div
              className="fixed inset-0 bg-[var(--overlay)] z-20 lg:hidden"
              onClick={() => setLeftOpen(false)}
            />
          )}
          <aside
            className={`fixed left-0 top-12 bottom-0 w-64 bg-[var(--bg-primary)] border-r border-[var(--border-primary)] z-30 lg:static lg:z-auto shrink-0 overflow-y-auto transition-transform duration-200 ${
              leftOpen ? "translate-x-0" : "-translate-x-full lg:hidden"
            }`}
          >
            {sidebar}
          </aside>

          {/* Center content */}
          <main className="flex-1 flex flex-col overflow-hidden min-w-0">
            <TabNav />
            <div className="flex-1 overflow-y-auto p-4">{children}</div>
          </main>

          {/* Right sidebar - sessions panel (resizable) */}
          {rightOpen && (
            <div
              className="fixed inset-0 bg-[var(--overlay)] z-20 lg:hidden"
              onClick={() => setRightOpen(false)}
            />
          )}
          <aside
            style={{ width: rightWidth }}
            className={`fixed right-0 top-12 bottom-0 bg-[var(--bg-primary)] border-l border-[var(--border-primary)] z-30 lg:static lg:z-auto shrink-0 overflow-hidden transition-transform duration-200 ${
              rightOpen ? "translate-x-0" : "translate-x-full lg:hidden"
            }`}
          >
            {/* Resize drag handle */}
            <div
              onMouseDown={onResizeStart}
              className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--accent)] active:bg-[var(--accent-hover)] z-10"
            />
            <SessionsPanel />
          </aside>
        </div>
      </SessionsPanelProvider>
      <DeploymentFooter />
    </div>
  );
}
