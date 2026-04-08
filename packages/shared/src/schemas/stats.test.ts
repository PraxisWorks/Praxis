import { describe, expect, it } from "vitest";
import {
  StatsInputSchema,
  TimelineInputSchema,
  StatsSummarySchema,
  StatsTimelineSchema,
} from "./stats.js";

describe("StatsInputSchema", () => {
  it("accepts a valid uuid repoId", () => {
    const result = StatsInputSchema.parse({
      repoId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    });
    expect(result.repoId).toBe("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
  });

  it("accepts null repoId", () => {
    const result = StatsInputSchema.parse({ repoId: null });
    expect(result.repoId).toBeNull();
  });

  it("rejects non-uuid repoId", () => {
    expect(() => StatsInputSchema.parse({ repoId: "not-a-uuid" })).toThrow();
  });

  it("rejects missing repoId", () => {
    expect(() => StatsInputSchema.parse({})).toThrow();
  });
});

describe("TimelineInputSchema", () => {
  it("accepts valid input with days", () => {
    const result = TimelineInputSchema.parse({
      repoId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      days: 7,
    });
    expect(result.days).toBe(7);
    expect(result.repoId).toBe("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
  });

  it("defaults days to 30 when omitted", () => {
    const result = TimelineInputSchema.parse({
      repoId: null,
    });
    expect(result.days).toBe(30);
  });

  it("accepts null repoId", () => {
    const result = TimelineInputSchema.parse({ repoId: null, days: 10 });
    expect(result.repoId).toBeNull();
  });

  it("rejects days less than 1", () => {
    expect(() =>
      TimelineInputSchema.parse({ repoId: null, days: 0 }),
    ).toThrow();
  });

  it("rejects days greater than 90", () => {
    expect(() =>
      TimelineInputSchema.parse({ repoId: null, days: 91 }),
    ).toThrow();
  });

  it("rejects non-integer days", () => {
    expect(() =>
      TimelineInputSchema.parse({ repoId: null, days: 10.5 }),
    ).toThrow();
  });
});

describe("StatsSummarySchema", () => {
  const validSummary = {
    ideas: [{ status: "open", count: 5 }],
    epics: [{ status: "in_progress", count: 3 }],
    tasks: [{ status: "complete", count: 10 }],
    totals: { ideas: 5, epics: 3, tasks: 10 },
  };

  it("accepts valid summary data", () => {
    const result = StatsSummarySchema.parse(validSummary);
    expect(result).toEqual(validSummary);
  });

  it("accepts empty arrays", () => {
    const result = StatsSummarySchema.parse({
      ideas: [],
      epics: [],
      tasks: [],
      totals: { ideas: 0, epics: 0, tasks: 0 },
    });
    expect(result.ideas).toEqual([]);
    expect(result.totals.ideas).toBe(0);
  });

  it("accepts multiple status entries per category", () => {
    const result = StatsSummarySchema.parse({
      ideas: [
        { status: "open", count: 5 },
        { status: "closed", count: 2 },
      ],
      epics: [{ status: "in_progress", count: 3 }],
      tasks: [
        { status: "draft", count: 4 },
        { status: "complete", count: 10 },
      ],
      totals: { ideas: 7, epics: 3, tasks: 14 },
    });
    expect(result.ideas).toHaveLength(2);
    expect(result.tasks).toHaveLength(2);
  });

  it("rejects missing totals", () => {
    expect(() =>
      StatsSummarySchema.parse({
        ideas: [],
        epics: [],
        tasks: [],
      }),
    ).toThrow();
  });

  it("rejects missing category arrays", () => {
    expect(() =>
      StatsSummarySchema.parse({
        ideas: [],
        totals: { ideas: 0, epics: 0, tasks: 0 },
      }),
    ).toThrow();
  });
});

describe("StatsTimelineSchema", () => {
  const validTimeline = {
    ideas: [{ date: "2026-03-01", status: "open", count: 3 }],
    epics: [{ date: "2026-03-01", status: "in_progress", count: 2 }],
    tasks: [{ date: "2026-03-01", status: "complete", count: 5 }],
  };

  it("accepts valid timeline data", () => {
    const result = StatsTimelineSchema.parse(validTimeline);
    expect(result).toEqual(validTimeline);
  });

  it("accepts empty arrays", () => {
    const result = StatsTimelineSchema.parse({
      ideas: [],
      epics: [],
      tasks: [],
    });
    expect(result.ideas).toEqual([]);
    expect(result.epics).toEqual([]);
    expect(result.tasks).toEqual([]);
  });

  it("accepts multiple entries", () => {
    const result = StatsTimelineSchema.parse({
      ideas: [
        { date: "2026-03-01", status: "open", count: 3 },
        { date: "2026-03-02", status: "open", count: 5 },
      ],
      epics: [
        { date: "2026-03-01", status: "in_progress", count: 1 },
        { date: "2026-03-02", status: "complete", count: 3 },
      ],
      tasks: [
        { date: "2026-03-01", status: "draft", count: 2 },
        { date: "2026-03-01", status: "complete", count: 4 },
      ],
    });
    expect(result.ideas).toHaveLength(2);
    expect(result.epics).toHaveLength(2);
    expect(result.tasks).toHaveLength(2);
  });

  it("rejects missing ideas array", () => {
    expect(() =>
      StatsTimelineSchema.parse({
        epics: [],
        tasks: [],
      }),
    ).toThrow();
  });

  it("rejects missing epics array", () => {
    expect(() =>
      StatsTimelineSchema.parse({
        ideas: [],
        tasks: [],
      }),
    ).toThrow();
  });

  it("rejects missing tasks array", () => {
    expect(() =>
      StatsTimelineSchema.parse({
        ideas: [],
        epics: [],
      }),
    ).toThrow();
  });

  it("rejects entries missing date field", () => {
    expect(() =>
      StatsTimelineSchema.parse({
        ideas: [{ status: "open", count: 3 }],
        epics: [],
        tasks: [],
      }),
    ).toThrow();
  });
});
