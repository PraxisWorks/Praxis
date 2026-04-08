import { z } from "zod";

export const StatsInputSchema = z.object({
  repoId: z.string().uuid().nullable(),
});

export const TimelineInputSchema = StatsInputSchema.extend({
  days: z.number().int().min(1).max(90).default(30),
});

export const StatsSummarySchema = z.object({
  ideas: z.array(z.object({ status: z.string(), count: z.number() })),
  epics: z.array(z.object({ status: z.string(), count: z.number() })),
  tasks: z.array(z.object({ status: z.string(), count: z.number() })),
  totals: z.object({
    ideas: z.number(),
    epics: z.number(),
    tasks: z.number(),
  }),
});

export const StatsTimelineSchema = z.object({
  ideas: z.array(z.object({ date: z.string(), status: z.string(), count: z.number() })),
  epics: z.array(z.object({ date: z.string(), status: z.string(), count: z.number() })),
  tasks: z.array(z.object({ date: z.string(), status: z.string(), count: z.number() })),
});

export type StatsInput = z.infer<typeof StatsInputSchema>;
export type TimelineInput = z.infer<typeof TimelineInputSchema>;
export type StatsSummary = z.infer<typeof StatsSummarySchema>;
export type StatsTimeline = z.infer<typeof StatsTimelineSchema>;
