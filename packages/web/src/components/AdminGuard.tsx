import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth0 } from "@auth0/auth0-react";
import { trpc } from "@praxis2/hooks";

type AdminGuardProps = {
  children: React.ReactNode;
};

export function AdminGuard({ children }: AdminGuardProps) {
  const { isAuthenticated, isLoading: authLoading } = useAuth0();
  const navigate = useNavigate();

  const { data: me, isLoading: meLoading } = trpc.user.me.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  useEffect(() => {
    if (!authLoading && isAuthenticated && !meLoading && me && me.role !== "admin") {
      navigate("/", { replace: true });
    }
  }, [authLoading, isAuthenticated, meLoading, me, navigate]);

  if (authLoading || !isAuthenticated || meLoading)
    return <div className="text-center p-8 text-[var(--text-muted)]">Loading...</div>;

  if (!me || me.role !== "admin") return null;

  return <>{children}</>;
}
