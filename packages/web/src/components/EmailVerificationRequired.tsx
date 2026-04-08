import { useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { trpc } from "@praxis2/hooks";

export function EmailVerificationRequired() {
  const { user, logout, getAccessTokenSilently } = useAuth0();
  const [resendStatus, setResendStatus] = useState<"idle" | "success" | "error">("idle");
  const [refreshing, setRefreshing] = useState(false);

  const resend = trpc.user.resendVerification.useMutation({
    onSuccess: () => setResendStatus("success"),
    onError: () => setResendStatus("error"),
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await getAccessTokenSilently({ cacheMode: "off" });
      window.location.reload();
    } catch {
      setRefreshing(false);
    }
  };

  const handleLogout = () => {
    logout({ logoutParams: { returnTo: window.location.origin } });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] p-4">
      <div className="bg-[var(--bg-secondary)] rounded-xl p-8 max-w-md w-full space-y-6 text-center">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">
          Verify your email
        </h1>

        <p className="text-[var(--text-muted)]">
          We sent a verification link to{" "}
          <span className="font-medium text-[var(--text-primary)]">
            {user?.email}
          </span>
          . Please check your inbox and verify your email to continue.
        </p>

        <p className="text-xs text-[var(--text-faint)]">
          After verifying, click <strong>"I've verified my email"</strong> below.
          If it still says you need to verify, log out and back in to refresh
          your session.
        </p>

        {resendStatus === "success" && (
          <p className="text-sm text-green-500">
            Verification email sent! Check your inbox.
          </p>
        )}

        {resendStatus === "error" && (
          <p className="text-sm text-red-500">
            Failed to send verification email. Please try again.
          </p>
        )}

        <div className="space-y-3">
          <button
            onClick={() => resend.mutate()}
            disabled={resend.isPending}
            className="w-full py-2 px-4 rounded-lg bg-[var(--accent)] text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {resend.isPending ? "Sending..." : "Resend verification email"}
          </button>

          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="w-full py-2 px-4 rounded-lg border border-[var(--border)] text-[var(--text-primary)] font-medium hover:bg-[var(--bg-primary)] transition-colors disabled:opacity-50"
          >
            {refreshing ? "Checking..." : "I've verified my email"}
          </button>

          <button
            onClick={handleLogout}
            className="w-full py-2 px-4 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
