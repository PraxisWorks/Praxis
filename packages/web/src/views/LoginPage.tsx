import { useAuth0 } from "@auth0/auth0-react";

import { PraxisLogo } from "../components/PraxisLogo.js";

type LoginPageProps = {
  loading?: boolean;
};

export function LoginPage({ loading }: LoginPageProps) {
  const { loginWithRedirect } = useAuth0();

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[#4f46e5]">
      <div className="flex flex-col items-center gap-6">
        <div
          className={`flex flex-col items-center gap-3${loading ? " animate-pulse" : ""}`}
        >
          <PraxisLogo size={48} color="white" />
          <span className="text-3xl font-bold text-white">Praxis</span>
        </div>

        {loading ? (
          <span className="text-sm text-white/70">Loading...</span>
        ) : (
          <button
            type="button"
            onClick={() => loginWithRedirect()}
            className="rounded-lg bg-[var(--bg-primary)] px-8 py-3 text-lg font-semibold text-[#4f46e5] shadow-md transition-opacity hover:opacity-90 active:opacity-80"
          >
            Log in
          </button>
        )}
      </div>
    </div>
  );
}
