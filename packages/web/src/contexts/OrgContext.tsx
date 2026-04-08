import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
import { useOrganizations } from "@praxis2/hooks";

type OrgContextValue = {
  /** The ID of the currently selected organization, or null if none selected. */
  selectedOrgId: string | null;
  /** Set the selected org. Pass null to deselect. */
  setSelectedOrgId: (id: string | null) => void;
  /** The currently selected organization object (for convenience). */
  selectedOrg: { id: string; name: string; slug: string; role: string } | null;
  /** All organizations the user belongs to. */
  organizations: Array<{ id: string; name: string; slug: string; role: string; createdAt: string; updatedAt: string }>;
  /** Whether the org list is loading. */
  isLoading: boolean;
};

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { organizations, isLoading } = useOrganizations();

  const selectedOrgId = searchParams.get("org") ?? null;

  const setSelectedOrgId = useCallback(
    (id: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) {
            next.set("org", id);
          } else {
            next.delete("org");
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Auto-select the first org if none selected and orgs are loaded
  useEffect(() => {
    if (!selectedOrgId && organizations.length > 0 && !isLoading) {
      setSelectedOrgId(organizations[0].id);
    }
  }, [selectedOrgId, organizations, isLoading, setSelectedOrgId]);

  const selectedOrg = selectedOrgId
    ? organizations.find((o) => o.id === selectedOrgId) ?? null
    : null;

  return (
    <OrgContext.Provider
      value={{
        selectedOrgId,
        setSelectedOrgId,
        selectedOrg,
        organizations,
        isLoading,
      }}
    >
      {children}
    </OrgContext.Provider>
  );
}

export function useSelectedOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) {
    throw new Error("useSelectedOrg must be used within an OrgProvider");
  }
  return ctx;
}
