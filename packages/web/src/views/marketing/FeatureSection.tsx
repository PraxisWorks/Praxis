import { type ReactNode } from "react";
import { AnimatedSection } from "../../components/AnimatedSection.js";

type Feature = {
  icon: ReactNode;
  title: string;
  description: string;
};

type FeatureSectionProps = {
  badge?: string;
  heading: string;
  subheading?: string;
  features: Feature[];
  /** Number of columns in the grid. Default 3 */
  columns?: 2 | 3 | 4;
};

const colClass = {
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-2 lg:grid-cols-4",
} as const;

export function FeatureSection({
  badge,
  heading,
  subheading,
  features,
  columns = 3,
}: FeatureSectionProps) {
  return (
    <section className="py-20 md:py-28">
      <div className="max-w-6xl mx-auto px-6">
        {/* Section header */}
        <AnimatedSection className="text-center mb-16">
          {badge && (
            <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-[var(--accent-light)] text-[var(--accent)] mb-4">
              {badge}
            </span>
          )}
          <h2 className="text-3xl md:text-4xl font-extrabold text-[var(--text-primary)] tracking-tight mb-4">
            {heading}
          </h2>
          {subheading && (
            <p className="text-lg text-[var(--text-muted)] max-w-2xl mx-auto">
              {subheading}
            </p>
          )}
        </AnimatedSection>

        {/* Feature grid */}
        <div className={`grid grid-cols-1 ${colClass[columns]} gap-6`}>
          {features.map((feature, i) => (
            <AnimatedSection key={feature.title} delay={(i % 4) + 1}>
              <div className="group h-full p-6 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] transition-all hover:border-[var(--accent)]/30 hover:shadow-lg hover:shadow-[var(--accent)]/5">
                <div className="w-10 h-10 rounded-lg bg-[var(--accent-light)] flex items-center justify-center mb-4 text-[var(--accent)] transition-colors group-hover:bg-[var(--accent)] group-hover:text-white">
                  {feature.icon}
                </div>
                <h3 className="text-base font-semibold text-[var(--text-primary)] mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-[var(--text-muted)] leading-relaxed">
                  {feature.description}
                </p>
              </div>
            </AnimatedSection>
          ))}
        </div>
      </div>
    </section>
  );
}
