import { describe, it, expect } from "vitest";
import { pivotTimeline } from "./Stats";

describe("pivotTimeline", () => {
  it("returns empty array for empty input", () => {
    expect(pivotTimeline([])).toEqual([]);
  });

  it("returns a single entry for a single date", () => {
    const rows = [{ date: "2026-03-10", status: "new", count: 3 }];
    expect(pivotTimeline(rows)).toEqual([{ date: "2026-03-10", new: 3 }]);
  });

  it("sorts non-overlapping dates chronologically", () => {
    // Simulates the reported bug: March 25 appearing before March 3
    const rows = [
      { date: "2026-03-25", status: "new", count: 1 },
      { date: "2026-03-03", status: "new", count: 2 },
      { date: "2026-03-15", status: "new", count: 4 },
    ];
    const result = pivotTimeline(rows);
    expect(result.map((r) => r.date)).toEqual([
      "2026-03-03",
      "2026-03-15",
      "2026-03-25",
    ]);
  });

  it("sorts overlapping dates from ideas and tasks chronologically", () => {
    // Ideas array (sorted independently)
    const ideas = [
      { date: "2026-03-01", status: "new", count: 2 },
      { date: "2026-03-10", status: "planning", count: 1 },
    ];
    // Tasks array (sorted independently, with overlapping + non-overlapping dates)
    const tasks = [
      { date: "2026-03-05", status: "draft", count: 3 },
      { date: "2026-03-10", status: "in_progress", count: 1 },
    ];
    const result = pivotTimeline([...ideas, ...tasks]);
    expect(result).toEqual([
      { date: "2026-03-01", new: 2 },
      { date: "2026-03-05", draft: 3 },
      { date: "2026-03-10", planning: 1, in_progress: 1 },
    ]);
  });

  it("merges multiple statuses on the same date", () => {
    const rows = [
      { date: "2026-03-10", status: "new", count: 5 },
      { date: "2026-03-10", status: "complete", count: 3 },
    ];
    const result = pivotTimeline(rows);
    expect(result).toEqual([{ date: "2026-03-10", new: 5, complete: 3 }]);
  });
});
