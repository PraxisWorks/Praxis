import { useState } from "react";
import { useStats } from "@praxis2/hooks";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
} from "recharts";

/* ─── Status color pills (Tailwind classes) ──────────────────────── */

const IDEA_STATUS_COLORS: Record<string, string> = {
  new: "bg-gray-100 text-gray-700",
  planning: "bg-blue-100 text-blue-700",
  planned: "bg-indigo-100 text-indigo-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  complete: "bg-green-100 text-green-700",
  dismissed: "bg-red-100 text-red-700",
  archived: "bg-gray-100 text-gray-500",
};

const TASK_STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  approved: "bg-blue-100 text-blue-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  blocked: "bg-red-100 text-red-700",
  complete: "bg-green-100 text-green-700",
  archived: "bg-gray-100 text-gray-500",
};

/* ─── Hex colors for chart bars / areas ──────────────────────────── */

const CHART_COLORS: Record<string, string> = {
  // idea statuses
  new: "#9ca3af",
  planning: "#60a5fa",
  planned: "#818cf8",
  in_progress: "#fbbf24",
  complete: "#34d399",
  dismissed: "#f87171",
  archived: "#d1d5db",
  // task statuses
  draft: "#9ca3af",
  approved: "#60a5fa",
  blocked: "#f87171",
};

/* ─── Unified filter chip definitions ─────────────────────────────── */

type FilterKey =
  | "new"
  | "planning"
  | "planned"
  | "in_progress"
  | "blocked"
  | "complete"
  | "archived";

const FILTER_OPTIONS: { value: FilterKey; label: string }[] = [
  { value: "new", label: "New" },
  { value: "planning", label: "Planning" },
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In Progress" },
  { value: "blocked", label: "Blocked" },
  { value: "complete", label: "Complete" },
  { value: "archived", label: "Archived" },
];

/** Map each filter chip → raw idea statuses it includes */
const IDEA_STATUS_MAP: Record<FilterKey, string[]> = {
  new: ["new"],
  planning: ["planning"],
  planned: ["planned"],
  in_progress: ["in_progress"],
  blocked: [],
  complete: ["complete"],
  archived: ["archived", "dismissed"],
};

/** Map each filter chip → raw task/epic statuses it includes */
const TASK_STATUS_MAP: Record<FilterKey, string[]> = {
  new: ["draft"],
  planning: [],
  planned: ["approved"],
  in_progress: ["in_progress"],
  blocked: ["blocked"],
  complete: ["complete"],
  archived: ["archived"],
};

const ALL_FILTERS: FilterKey[] = FILTER_OPTIONS.map((o) => o.value);

const DEFAULT_FILTERS: FilterKey[] = ALL_FILTERS.filter(
  (f) => f !== "archived",
);

/* ─── Theme-aware tooltip styles ─────────────────────────────────── */

const TOOLTIP_STYLES = {
  contentStyle: {
    backgroundColor: "var(--bg-elevated)",
    border: "1px solid var(--border-primary)",
    borderRadius: "0.375rem",
    fontSize: "0.75rem",
  },
  labelStyle: { color: "var(--text-primary)", fontWeight: 600 as const },
  itemStyle: { color: "var(--text-secondary)" },
};

/* ─── Props ──────────────────────────────────────────────────────── */

type StatsProps = {
  repoId: string | null;
};

/* ─── Helpers ────────────────────────────────────────────────────── */

function StatusPill({
  status,
  count,
  colorMap,
}: {
  status: string;
  count: number;
  colorMap: Record<string, string>;
}) {
  const classes = colorMap[status] ?? "bg-gray-100 text-gray-700";
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${classes}`}
    >
      {status.replace(/_/g, " ")}
      <span className="font-semibold">{count}</span>
    </span>
  );
}

function SummaryCard({
  title,
  total,
  breakdowns,
  colorMap,
}: {
  title: string;
  total: number;
  breakdowns: { status: string; count: number }[];
  colorMap: Record<string, string>;
}) {
  return (
    <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-4">
      <p className="text-sm text-[var(--text-muted)] mb-1">{title}</p>
      <p className="text-3xl font-bold text-[var(--text-primary)]">{total}</p>
      <div className="flex flex-wrap gap-1.5 mt-3">
        {breakdowns.map((b) => (
          <StatusPill
            key={b.status}
            status={b.status}
            count={b.count}
            colorMap={colorMap}
          />
        ))}
      </div>
    </div>
  );
}

function StatusBarChart({
  title,
  data,
}: {
  title: string;
  data: { status: string; count: number }[];
}) {
  if (data.length === 0) return null;

  return (
    <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-4">
      <p className="text-sm font-medium text-[var(--text-muted)] mb-3">
        {title}
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data}>
          <XAxis
            dataKey="status"
            tick={{ fontSize: 11 }}
            tickFormatter={(v: string) => v.replace(/_/g, " ")}
          />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip
            {...TOOLTIP_STYLES}
            labelFormatter={(v: unknown) => String(v).replace(/_/g, " ")}
            formatter={(value: unknown) => [String(value), "Count"]}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {data.map((entry) => (
              <Cell
                key={entry.status}
                fill={CHART_COLORS[entry.status] ?? "#9ca3af"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ─── Pivot timeline rows into { date, [status]: count } for the AreaChart ─ */

export function pivotTimeline(
  rows: { date: string; status: string; count: number }[],
): Record<string, string | number>[] {
  if (rows.length === 0) return [];
  const byDate = new Map<string, Record<string, string | number>>();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, { date: r.date });
    byDate.get(r.date)![r.status] = r.count;
  }
  return Array.from(byDate.values()).sort((a, b) =>
    String(a.date).localeCompare(String(b.date)),
  );
}

/* ─── Main Component ─────────────────────────────────────────────── */

export function Stats({ repoId }: StatsProps) {
  const { summary, timeline, isLoading, error } = useStats(repoId);

  /* ── Filter state ──────────────────────────────────────────────── */
  const [selectedFilters, setSelectedFilters] = useState<Set<FilterKey>>(
    () => new Set(DEFAULT_FILTERS),
  );

  /* ── Entity type filter state ────────────────────────────────── */
  type EntityType = 'ideas' | 'epics' | 'tasks';

  const [entityFilters, setEntityFilters] = useState<Set<EntityType>>(
    () => new Set<EntityType>(['ideas', 'epics', 'tasks']),
  );

  const toggleEntity = (entity: EntityType) => {
    setEntityFilters((prev) => {
      const next = new Set(prev);
      if (next.has(entity)) next.delete(entity);
      else next.add(entity);
      return next;
    });
  };

  const isAllSelected =
    DEFAULT_FILTERS.every((f) => selectedFilters.has(f)) &&
    !selectedFilters.has("archived");

  const toggleFilter = (key: FilterKey) => {
    setSelectedFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (isAllSelected) {
      setSelectedFilters(new Set(DEFAULT_FILTERS));
    } else {
      setSelectedFilters(new Set(DEFAULT_FILTERS));
    }
  };

  /* Derive allowed raw statuses from selected filter chips */
  const allowedIdeaStatuses = new Set(
    [...selectedFilters].flatMap((f) => IDEA_STATUS_MAP[f]),
  );
  const allowedTaskStatuses = new Set(
    [...selectedFilters].flatMap((f) => TASK_STATUS_MAP[f]),
  );

  /* Filter + recount helpers */
  type StatusRow = { status: string; count: number };

  const filterRows = (rows: StatusRow[], allowed: Set<string>): StatusRow[] =>
    rows.filter((r) => allowed.has(r.status));

  const sumCounts = (rows: StatusRow[]) =>
    rows.reduce((acc, r) => acc + r.count, 0);

  /* Apply filters to summary data */
  const filteredIdeas = filterRows(summary?.ideas ?? [], allowedIdeaStatuses);
  const filteredEpics = filterRows(summary?.epics ?? [], allowedTaskStatuses);
  const filteredTasks = filterRows(summary?.tasks ?? [], allowedTaskStatuses);

  if (error) {
    return (
      <div className="bg-red-50 text-red-600 p-3 rounded m-4">{error}</div>
    );
  }

  /* Collect unique statuses that appear in the filtered timeline */
  const filteredTimelineIdeas = (timeline?.ideas ?? []).filter((r) =>
    allowedIdeaStatuses.has(r.status),
  );
  const filteredTimelineEpics = (timeline?.epics ?? []).filter((r) =>
    allowedTaskStatuses.has(r.status),
  );
  const filteredTimelineTasks = (timeline?.tasks ?? []).filter((r) =>
    allowedTaskStatuses.has(r.status),
  );

  const timelineStatuses = new Set<string>();
  if (entityFilters.has('ideas'))
    for (const row of filteredTimelineIdeas) timelineStatuses.add(row.status);
  if (entityFilters.has('epics'))
    for (const row of filteredTimelineEpics) timelineStatuses.add(row.status);
  if (entityFilters.has('tasks'))
    for (const row of filteredTimelineTasks) timelineStatuses.add(row.status);

  const trendData = pivotTimeline([
    ...(entityFilters.has('ideas') ? filteredTimelineIdeas : []),
    ...(entityFilters.has('epics') ? filteredTimelineEpics : []),
    ...(entityFilters.has('tasks') ? filteredTimelineTasks : []),
  ]);

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)]">
        <h1 className="text-lg font-bold">Stats</h1>
      </div>

      {/* ── Filter chips ──────────────────────────────────────── */}
      <div className="flex gap-2 px-4 pt-4 flex-wrap">
        <button
          onClick={toggleAll}
          className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer border transition-colors ${
            isAllSelected
              ? "bg-[var(--accent)] text-white border-[var(--accent)]"
              : "bg-[var(--bg-primary)] text-[var(--text-secondary)] border-[var(--border-secondary)] hover:border-[var(--border-secondary)]"
          }`}
        >
          All
        </button>
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => toggleFilter(opt.value)}
            className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer border transition-colors ${
              selectedFilters.has(opt.value)
                ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                : "bg-[var(--bg-primary)] text-[var(--text-secondary)] border-[var(--border-secondary)] hover:border-[var(--border-secondary)]"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-[var(--text-faint)] text-center p-8">Loading...</p>
      ) : (
        <div className="p-4 space-y-6">
          {/* ── Summary Cards ──────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <SummaryCard
              title="Ideas"
              total={sumCounts(filteredIdeas)}
              breakdowns={filteredIdeas}
              colorMap={IDEA_STATUS_COLORS}
            />
            <SummaryCard
              title="Epics"
              total={sumCounts(filteredEpics)}
              breakdowns={filteredEpics}
              colorMap={TASK_STATUS_COLORS}
            />
            <SummaryCard
              title="Tasks"
              total={sumCounts(filteredTasks)}
              breakdowns={filteredTasks}
              colorMap={TASK_STATUS_COLORS}
            />
          </div>

          {/* ── Status Distribution Charts ─────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatusBarChart
              title="Ideas by Status"
              data={filteredIdeas}
            />
            <StatusBarChart
              title="Epics by Status"
              data={filteredEpics}
            />
            <StatusBarChart
              title="Tasks by Status"
              data={filteredTasks}
            />
          </div>

          {/* ── Timeline Trend Chart ──────────────────────────── */}
          {timeline && trendData.length > 0 && (
            <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-4">
              <div className="flex gap-2 mb-3 flex-wrap">
                {(['Ideas', 'Epics', 'Tasks'] as const).map((label) => {
                  const key = label.toLowerCase() as EntityType;
                  return (
                    <button
                      key={key}
                      onClick={() => toggleEntity(key)}
                      className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer border transition-colors ${
                        entityFilters.has(key)
                          ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                          : "bg-[var(--bg-primary)] text-[var(--text-secondary)] border-[var(--border-secondary)] hover:border-[var(--border-secondary)]"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="text-sm font-medium text-[var(--text-muted)] mb-3">
                Trend Over Time
              </p>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip
                    {...TOOLTIP_STYLES}
                    labelFormatter={(v: unknown) =>
                      String(v).replace(/_/g, " ")
                    }
                  />
                  {Array.from(timelineStatuses).map((status) => (
                    <Area
                      key={status}
                      type="monotone"
                      dataKey={status}
                      stackId="1"
                      stroke={CHART_COLORS[status] ?? "#9ca3af"}
                      fill={CHART_COLORS[status] ?? "#9ca3af"}
                      fillOpacity={0.6}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
