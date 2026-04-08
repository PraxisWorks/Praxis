export type PhaseMode = "ai-assisted" | "full-ai" | "skip";
export type PhaseConfig = { phase: string; mode: PhaseMode }[];

export const PHASES = [
  "Business Value",
  "User Benefits",
  "Must-Have Requirements",
  "Product Review",
  "Architecture Review",
  "DevOps Review",
  "Security Review",
  "Engineering Plan",
] as const;

export const MODE_LABELS: Record<PhaseMode, string> = {
  "ai-assisted": "Interactive",
  "full-ai": "AI Automate",
  skip: "Skip",
};

export const MODE_COLORS: Record<PhaseMode, string> = {
  "ai-assisted": "bg-indigo-100 text-indigo-700 border-indigo-300",
  "full-ai": "bg-amber-100 text-amber-700 border-amber-300",
  skip: "bg-gray-100 text-gray-500 border-gray-300",
};

export const PHASE_MODES: PhaseMode[] = ["ai-assisted", "full-ai", "skip"];
