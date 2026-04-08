import { useEffect, useRef, useState, type ReactNode } from "react";

type AnimatedSectionProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  /** Threshold for IntersectionObserver (0-1). Default 0.15 */
  threshold?: number;
};

/**
 * Scroll-reveal wrapper. Children fade-in-up when the element
 * scrolls into view. Uses IntersectionObserver for performance.
 */
export function AnimatedSection({
  children,
  className = "",
  delay,
  threshold = 0.15,
}: AnimatedSectionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.unobserve(el);
        }
      },
      { threshold }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return (
    <div
      ref={ref}
      className={`animated-section ${className}`}
      data-visible={visible}
      data-delay={delay}
    >
      {children}
    </div>
  );
}
