import { HeroSection } from "./HeroSection.js";
import { FeatureSection } from "./FeatureSection.js";
import { AnimatedSection } from "../../components/AnimatedSection.js";
import { useAuth0 } from "@auth0/auth0-react";
import { Link } from "react-router-dom";

/* ── SVG icon helpers (inline, no external deps) ── */

function RepoIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}

function OrganizeIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  );
}

function MachineIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}

function OpenSourceIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  );
}

function IdeaIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  );
}

function PlanIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  );
}

function ExecuteIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

function TrackIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}

function SecurityIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}

function GraphIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
    </svg>
  );
}

export function MarketingPage() {
  const { loginWithRedirect } = useAuth0();

  const flowSteps: { label: string; hint: string }[] = [
    { label: "Idea", hint: "Capture intent" },
    { label: "Plan", hint: "Architect it" },
    { label: "Build", hint: "Working session" },
    { label: "Debug", hint: "Fix what breaks" },
    { label: "Ship", hint: "Merge & deploy" },
  ];

  return (
    <div>
      {/* Hero */}
      <HeroSection />

      {/* Core value props */}
      <div className="border-t border-[var(--border-primary)]">
        <FeatureSection
          badge="Why Praxis"
          heading="Everything You Need to Ship"
          subheading="Add any repo, organize your work, and let AI handle the orchestration — all on your machine."
          features={[
            {
              icon: <RepoIcon />,
              title: "Add Any Repository",
              description:
                "Connect any Git repository — GitHub, GitLab, Bitbucket, or self-hosted. Praxis works with your existing codebase, no migration needed.",
            },
            {
              icon: <OrganizeIcon />,
              title: "Project Workspaces",
              description:
                "Each repo is a self-contained workspace with its own ideas, plans, sessions, and views. Switch context instantly.",
            },
            {
              icon: <MachineIcon />,
              title: "Runs on Your Machine",
              description:
                "Your code stays on your machine. No cloud uploads, no third-party data access. Praxis orchestrates locally with full privacy.",
            },
            {
              icon: <OpenSourceIcon />,
              title: "Fully Open Source",
              description:
                "MIT licensed. Inspect the code, contribute features, fork for your team. No vendor lock-in, no hidden costs.",
            },
          ]}
          columns={4}
        />
      </div>

      {/* Flow strip — high-level loop at a glance */}
      <div className="border-t border-[var(--border-primary)]">
        <div className="max-w-5xl mx-auto px-6 py-12 md:py-16">
          <p className="text-center text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-6">
            The Praxis loop
          </p>
          <div className="flex flex-wrap items-center justify-center gap-y-4">
            {flowSteps.map((step, i) => (
              <div key={step.label} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div className="px-4 py-2 rounded-full text-sm font-semibold bg-[var(--accent-light)] text-[var(--accent)] whitespace-nowrap shadow-sm">
                    {step.label}
                  </div>
                  <div className="mt-1.5 text-xs text-[var(--text-faint)] whitespace-nowrap">
                    {step.hint}
                  </div>
                </div>
                {i < flowSteps.length - 1 && (
                  <svg
                    className="w-5 h-5 mx-2 md:mx-3 text-[var(--text-faint)] shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Workflow section */}
      <div className="border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]">
        <FeatureSection
          badge="Workflow"
          heading="From Idea to Deployment"
          subheading="A structured pipeline that turns raw ideas into shipped features through AI-assisted planning and execution."
          features={[
            {
              icon: <IdeaIcon />,
              title: "Capture Ideas",
              description:
                "Start with lightweight idea cards. Add context, size estimates, and let the backlog grow organically.",
            },
            {
              icon: <PlanIcon />,
              title: "Plan with Architecture Sessions",
              description:
                "Run 8-phase planning workshops covering business value, requirements, architecture, security, and DevOps.",
            },
            {
              icon: <ExecuteIcon />,
              title: "Execute with Working Sessions",
              description:
                "AI agents implement the plan — writing code, running tests, and committing changes — while you monitor progress.",
            },
            {
              icon: <TrackIcon />,
              title: "Track on Board & Graph",
              description:
                "Visualize progress as a kanban board or dependency graph. See blockers, velocity, and completion at a glance.",
            },
          ]}
          columns={4}
        />
      </div>

      {/* Technical details */}
      <div className="border-t border-[var(--border-primary)]">
        <FeatureSection
          badge="Collaboration"
          heading="Built for collaboration"
          subheading="Praxis is designed for teams who plan, ship, and review together."
          features={[
            {
              icon: <SecurityIcon />,
              title: "8-Phase Security Review",
              description:
                "Every architecture plan includes dedicated security and DevOps review phases — not an afterthought.",
            },
            {
              icon: <GraphIcon />,
              title: "Dependency Tracking",
              description:
                "Automatic dependency graphs show the critical path through your project, surfacing blockers before they slow you down.",
            },
            {
              icon: <ExecuteIcon />,
              title: "Structured Sessions",
              description:
                "Working sessions follow the plan with task tracking — every task has a clear lifecycle from draft to complete.",
            },
          ]}
        />
      </div>

      {/* CTA section */}
      <div className="border-t border-[var(--border-primary)]">
        <AnimatedSection className="py-24 md:py-32 text-center">
          <div className="max-w-2xl mx-auto px-6">
            <h2 className="text-3xl md:text-4xl font-extrabold text-[var(--text-primary)] tracking-tight mb-4">
              Ready to Ship Faster?
            </h2>
            <p className="text-lg text-[var(--text-muted)] mb-8">
              Start orchestrating your development workflow with AI-powered
              planning and execution — open source, on your machine.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => loginWithRedirect()}
                className="rounded-xl bg-[var(--accent)] px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-[var(--accent)]/25 transition-all hover:bg-[var(--accent-hover)] hover:shadow-xl active:scale-[0.98]"
              >
                Get Started Free
              </button>
              <Link
                to="/documentation"
                className="text-sm font-medium text-[var(--accent)] no-underline hover:underline"
              >
                Read the documentation →
              </Link>
            </div>
          </div>
        </AnimatedSection>
      </div>
    </div>
  );
}
