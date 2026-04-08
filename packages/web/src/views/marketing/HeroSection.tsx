import { useAuth0 } from "@auth0/auth0-react";
import { Link } from "react-router-dom";
import { PraxisLogo } from "../../components/PraxisLogo.js";

export function HeroSection() {
  const { loginWithRedirect } = useAuth0();

  return (
    <section className="relative overflow-hidden py-24 md:py-32 lg:py-40">
      {/* Animated background gradient */}
      <div className="absolute inset-0 marketing-gradient opacity-5" />

      {/* Floating decorative elements */}
      <div className="absolute top-20 left-[10%] w-64 h-64 rounded-full bg-[var(--accent)] opacity-[0.04] blur-3xl marketing-float" />
      <div className="absolute bottom-20 right-[10%] w-96 h-96 rounded-full bg-purple-500 opacity-[0.04] blur-3xl marketing-float" style={{ animationDelay: "2s" }} />

      <div className="relative max-w-5xl mx-auto px-6 text-center">
        {/* Logo Mark */}
        <div className="hero-animate flex justify-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-[var(--accent)] flex items-center justify-center shadow-lg shadow-[var(--accent)]/20">
            <PraxisLogo size={36} color="white" />
          </div>
        </div>

        {/* Headline */}
        <h1 className="hero-animate-delay-1 text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-[var(--text-primary)] leading-[1.1] mb-6">
          AI-Powered Development
          <br />
          <span className="marketing-gradient-text">Orchestration</span>
        </h1>

        {/* Subheadline */}
        <p className="hero-animate-delay-2 text-lg md:text-xl text-[var(--text-muted)] max-w-2xl mx-auto mb-10 leading-relaxed">
          From idea to deployment in structured, AI-assisted workflows.
          Plan with architecture sessions, execute with working sessions,
          and track everything on your machine.
        </p>

        {/* CTAs */}
        <div className="hero-animate-delay-3 flex flex-col sm:flex-row items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => loginWithRedirect()}
            className="rounded-xl bg-[var(--accent)] px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-[var(--accent)]/25 transition-all hover:bg-[var(--accent-hover)] hover:shadow-xl hover:shadow-[var(--accent)]/30 active:scale-[0.98]"
          >
            Get Started Free
          </button>
          <Link
            to="/documentation"
            className="rounded-xl border border-[var(--border-secondary)] px-8 py-3.5 text-base font-semibold text-[var(--text-secondary)] no-underline transition-all hover:bg-[var(--bg-tertiary)] hover:border-[var(--border-primary)]"
          >
            Read the Docs
          </Link>
        </div>

        {/* Trust signals */}
        <div className="hero-animate-delay-3 mt-12 flex flex-wrap items-center justify-center gap-6 text-xs text-[var(--text-faint)]">
          <span className="flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            Fully Open Source
          </span>
          <span className="flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
            </svg>
            Runs on Your Machine
          </span>
          <span className="flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
            </svg>
            Any Repository
          </span>
        </div>
      </div>
    </section>
  );
}
