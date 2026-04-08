import {
  createContext,
  useContext,
  useCallback,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";

type RepoContextValue = {
  /** The ID of the currently selected repo, or null for "All Repos". */
  selectedRepoId: string | null;
  /** Set the selected repo. Pass null to select "All Repos". */
  setSelectedRepoId: (id: string | null) => void;
};

const RepoContext = createContext<RepoContextValue | null>(null);

export function RepoProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedRepoId = searchParams.get("repo") ?? null;

  const setSelectedRepoId = useCallback(
    (id: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) {
            next.set("repo", id);
          } else {
            next.delete("repo");
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return (
    <RepoContext.Provider value={{ selectedRepoId, setSelectedRepoId }}>
      {children}
    </RepoContext.Provider>
  );
}

export function useSelectedRepo(): RepoContextValue {
  const ctx = useContext(RepoContext);
  if (!ctx) {
    throw new Error("useSelectedRepo must be used within a RepoProvider");
  }
  return ctx;
}
