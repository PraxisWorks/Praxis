import { useAuth0 } from "@auth0/auth0-react";
import { EmailVerificationRequired } from "./EmailVerificationRequired.js";

type AuthGuardProps = {
  children: React.ReactNode;
};

export function AuthGuard({ children }: AuthGuardProps) {
  const { isAuthenticated, isLoading, user } = useAuth0();

  if (isLoading)
    return <div className="text-center p-8 text-[var(--text-muted)]">Loading...</div>;
  if (!isAuthenticated) return null;
  // Self-hosted deploys can opt out via VITE_DISABLE_EMAIL_VERIFICATION=true.
  const emailVerificationDisabled =
    import.meta.env.VITE_DISABLE_EMAIL_VERIFICATION === "true";
  if (!emailVerificationDisabled && user?.email_verified === false)
    return <EmailVerificationRequired />;

  return <>{children}</>;
}
