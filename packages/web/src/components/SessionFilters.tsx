import { MultiSelect } from "./MultiSelect";
import { OrgMultiSelect } from "./OrgMultiSelect";

interface SessionFiltersProps {
  typeFilter: string[];
  statusFilter: string[];
  orgFilter: string[];
  onTypeChange: (types: string[]) => void;
  onStatusChange: (statuses: string[]) => void;
  onOrgChange: (orgIds: string[]) => void;
}

const SESSION_TYPES = [
  { value: "spec", label: "Spec" },
  { value: "architecture", label: "Architecture" },
  { value: "working", label: "Working" },
  { value: "debug", label: "Debug" },
  { value: "repo", label: "Repo Chat" },
];

const SESSION_STATUSES = [
  { value: "active", label: "Active" },
  { value: "scheduled", label: "Scheduled" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
  { value: "error", label: "Error" },
];

export function SessionFilters({
  typeFilter,
  statusFilter,
  orgFilter,
  onTypeChange,
  onStatusChange,
  onOrgChange,
}: SessionFiltersProps) {
  return (
    <div className="px-4 py-2 border-b border-[var(--border-primary)] flex gap-2 shrink-0">
      <MultiSelect
        options={SESSION_TYPES}
        selected={typeFilter}
        onChange={onTypeChange}
        placeholder="Types"
        ariaLabel="Filter by type"
      />

      <MultiSelect
        options={SESSION_STATUSES}
        selected={statusFilter}
        onChange={onStatusChange}
        placeholder="Statuses"
        ariaLabel="Filter by status"
      />

      <OrgMultiSelect selectedOrgIds={orgFilter} onChange={onOrgChange} />
    </div>
  );
}
