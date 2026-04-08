import { useMemo } from "react";
import { useOrganizations } from "@praxis2/hooks";
import { MultiSelect } from "./MultiSelect";

type OrgMultiSelectProps = {
  selectedOrgIds: string[];
  onChange: (orgIds: string[]) => void;
};

export function OrgMultiSelect({ selectedOrgIds, onChange }: OrgMultiSelectProps) {
  const { organizations } = useOrganizations();

  const options = useMemo(
    () => organizations.map((org) => ({ value: org.id, label: org.name })),
    [organizations],
  );

  return (
    <MultiSelect
      options={options}
      selected={selectedOrgIds}
      onChange={onChange}
      placeholder="Orgs"
      ariaLabel="Filter by organization"
    />
  );
}
