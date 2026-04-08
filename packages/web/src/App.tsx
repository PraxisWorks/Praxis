import { useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { Routes, Route } from "react-router-dom";
import { TRPCProvider, useSessionSync } from "@praxis2/hooks";
import { Layout } from "./components/Layout.js";
import { PublicLayout } from "./components/PublicLayout.js";
import { RepoSidebar } from "./components/RepoSidebar.js";
import { AppCreatorModal } from "./components/AppCreatorModal.js";
import { AddRepoModal } from "./components/AddRepoModal.js";
import { NotificationToast } from "./components/NotificationToast.js";
import { AuthGuard } from "./components/AuthGuard.js";
import { AdminGuard } from "./components/AdminGuard.js";
import { OrgProvider } from "./contexts/OrgContext.js";
import { RepoProvider, useSelectedRepo } from "./contexts/RepoContext.js";
import { ThemeProvider } from "./contexts/ThemeContext.js";
import { TaskFilterProvider } from "./contexts/TaskFilterContext.js";
import { ToastProvider } from "./contexts/ToastContext.js";
import { Ideas } from "./views/Ideas.js";
import { IdeaDetail } from "./views/IdeaDetail.js";
import { Profile } from "./views/Profile.js";
import { OrgSettings } from "./views/OrgSettings.js";
import { Board } from "./views/Board.js";
import { Graph } from "./views/Graph.js";
import { Notifications } from "./views/Notifications.js";
import { Stats } from "./views/Stats.js";
import { Deployments } from "./views/Deployments.js";
import { QuestionQueue } from "./views/QuestionQueue.js";
import { RolesAdmin } from "./views/RolesAdmin.js";
import { UsersAdmin } from "./views/UsersAdmin.js";
import { SettingsAdmin } from "./views/SettingsAdmin.js";
import { MarketingPage } from "./views/marketing/MarketingPage.js";
import { DocumentationPage } from "./views/docs/DocumentationPage.js";

function SessionSync() {
  const { user } = useAuth0();
  useSessionSync(user ?? null);
  return null;
}

function BoardWrapper() {
  const { selectedRepoId } = useSelectedRepo();
  return <Board repoId={selectedRepoId} />;
}

function GraphWrapper() {
  const { selectedRepoId } = useSelectedRepo();
  return <Graph repoId={selectedRepoId} />;
}

function StatsWrapper() {
  const { selectedRepoId } = useSelectedRepo();
  return <Stats repoId={selectedRepoId} />;
}

function DeploymentsWrapper() {
  const { selectedRepoId } = useSelectedRepo();
  return <Deployments repoId={selectedRepoId} />;
}

function NotificationsWrapper() {
  const { selectedRepoId } = useSelectedRepo();
  return <Notifications repoId={selectedRepoId} />;
}

/** Authenticated app shell with Layout, providers, and all app routes */
function AuthenticatedApp() {
  const { getAccessTokenSilently, logout } = useAuth0();
  const [showCreator, setShowCreator] = useState(false);
  const [showAddRepo, setShowAddRepo] = useState(false);

  const getAccessToken = async () => {
    return getAccessTokenSilently();
  };

  const handleAuthError = () => {
    logout({ logoutParams: { returnTo: window.location.origin } });
  };

  return (
    <TRPCProvider apiUrl="/api/trpc" getAccessToken={getAccessToken} onAuthError={handleAuthError}>
      <ThemeProvider>
      <SessionSync />
      <NotificationToast />
      <OrgProvider>
        <RepoProvider>
          <TaskFilterProvider>
            <Layout
              sidebar={
                <RepoSidebar
                  onNewRepo={() => setShowCreator(true)}
                  onAddRepo={() => setShowAddRepo(true)}
                />
              }
            >
              <Routes>
                <Route path="/" element={<Ideas />} />
                <Route
                  path="/ideas/:ideaId"
                  element={
                    <AuthGuard>
                      <IdeaDetail />
                    </AuthGuard>
                  }
                />
                <Route
                  path="/board"
                  element={
                    <AuthGuard>
                      <BoardWrapper />
                    </AuthGuard>
                  }
                />
                <Route
                  path="/graph"
                  element={
                    <AuthGuard>
                      <GraphWrapper />
                    </AuthGuard>
                  }
                />
                <Route
                  path="/stats"
                  element={
                    <AuthGuard>
                      <StatsWrapper />
                    </AuthGuard>
                  }
                />
                <Route
                  path="/questions"
                  element={
                    <AuthGuard>
                      <QuestionQueue />
                    </AuthGuard>
                  }
                />
                <Route
                  path="/deployments"
                  element={
                    <AuthGuard>
                      <DeploymentsWrapper />
                    </AuthGuard>
                  }
                />
                <Route
                  path="/notifications"
                  element={
                    <AuthGuard>
                      <NotificationsWrapper />
                    </AuthGuard>
                  }
                />
                <Route
                  path="/org/settings"
                  element={
                    <AuthGuard>
                      <OrgSettings />
                    </AuthGuard>
                  }
                />
                <Route
                  path="/admin/roles"
                  element={
                    <AdminGuard>
                      <RolesAdmin />
                    </AdminGuard>
                  }
                />
                <Route
                  path="/admin/users"
                  element={
                    <AdminGuard>
                      <UsersAdmin />
                    </AdminGuard>
                  }
                />
                <Route
                  path="/admin/settings"
                  element={
                    <AdminGuard>
                      <SettingsAdmin />
                    </AdminGuard>
                  }
                />
                <Route
                  path="/profile"
                  element={
                    <AuthGuard>
                      <Profile />
                    </AuthGuard>
                  }
                />
              </Routes>
            </Layout>
            <AppCreatorModal
              isOpen={showCreator}
              onClose={() => setShowCreator(false)}
            />
            <AddRepoModal
              isOpen={showAddRepo}
              onClose={() => setShowAddRepo(false)}
            />
          </TaskFilterProvider>
        </RepoProvider>
      </OrgProvider>
      </ThemeProvider>
    </TRPCProvider>
  );
}

// Apply stored theme to <html> immediately (before any provider mounts)
// so CSS variables are available for public/loading pages that don't use useTheme().
(() => {
  try {
    const stored = localStorage.getItem("praxis-theme");
    const theme = stored === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch {
    // localStorage unavailable
  }
})();

export function App() {
  const { isAuthenticated, isLoading } = useAuth0();

  // Show loading state while Auth0 initializes
  if (isLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[var(--bg-primary)]">
        <div className="flex flex-col items-center gap-3 animate-pulse">
          <div className="w-12 h-12 rounded-xl bg-[var(--accent)] opacity-50" />
          <span className="text-sm text-[var(--text-muted)]">Loading...</span>
        </div>
      </div>
    );
  }

  // Unauthenticated: show public marketing + docs routes
  if (!isAuthenticated) {
    return (
      <ToastProvider>
        <Routes>
          <Route
            path="/"
            element={
              <PublicLayout>
                <MarketingPage />
              </PublicLayout>
            }
          />
          <Route
            path="/documentation/*"
            element={
              <PublicLayout>
                <DocumentationPage />
              </PublicLayout>
            }
          />
          {/* Catch-all: redirect unauthenticated users to marketing page */}
          <Route
            path="*"
            element={
              <PublicLayout>
                <MarketingPage />
              </PublicLayout>
            }
          />
        </Routes>
      </ToastProvider>
    );
  }

  // Authenticated: full app
  return (
    <ToastProvider>
      <Routes>
        {/* Documentation is accessible when authenticated too */}
        <Route
          path="/documentation/*"
          element={
            <PublicLayout>
              <DocumentationPage />
            </PublicLayout>
          }
        />
        {/* All other routes go through the authenticated app shell */}
        <Route path="/*" element={<AuthenticatedApp />} />
      </Routes>
    </ToastProvider>
  );
}
