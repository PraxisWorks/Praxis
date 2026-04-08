import { useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { DocSidebar } from "./DocSidebar.js";
import { GettingStarted } from "./GettingStarted.js";
import { IdeasWorkflow } from "./IdeasWorkflow.js";
import { ArchitectSessions } from "./ArchitectSessions.js";
import { WorkingSessions } from "./WorkingSessions.js";
import { BoardAndGraph } from "./BoardAndGraph.js";
import { Questions } from "./Questions.js";
import { Deployments } from "./Deployments.js";
import { Stats } from "./Stats.js";

export function DocumentationPage() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-[calc(100vh-4rem)]">
      {/* Mobile sidebar toggle */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed bottom-4 right-4 z-40 lg:hidden w-12 h-12 rounded-full bg-[var(--accent)] text-white shadow-lg flex items-center justify-center"
        aria-label="Open navigation"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-[var(--overlay)] z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed left-0 top-16 bottom-0 z-50 lg:static lg:z-auto transition-transform duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <DocSidebar onClose={() => setMobileOpen(false)} />
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto p-6 md:p-10 lg:p-12">
        <Routes>
          <Route index element={<Navigate to="getting-started" replace />} />
          <Route path="getting-started" element={<GettingStarted />} />
          <Route path="ideas" element={<IdeasWorkflow />} />
          <Route path="architect-sessions" element={<ArchitectSessions />} />
          <Route path="working-sessions" element={<WorkingSessions />} />
          <Route path="board-and-graph" element={<BoardAndGraph />} />
          <Route path="questions" element={<Questions />} />
          <Route path="deployments" element={<Deployments />} />
          <Route path="stats" element={<Stats />} />
        </Routes>
      </div>
    </div>
  );
}
