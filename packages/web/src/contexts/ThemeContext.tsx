import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { trpc } from "@praxis2/hooks";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Theme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  isLoading: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = "praxis-theme";

function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage unavailable
  }
  return "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const initial = getStoredTheme();
    applyTheme(initial);
    return initial;
  });

  const { data: me, isLoading: isMeLoading } = trpc.user.me.useQuery(
    undefined,
    {
      // Don't refetch on window focus for theme — unnecessary
      refetchOnWindowFocus: false,
    },
  );

  const updateTheme = trpc.user.updateTheme.useMutation();

  // Sync from server when me query resolves
  useEffect(() => {
    if (me?.theme && (me.theme === "light" || me.theme === "dark")) {
      if (me.theme !== theme) {
        setThemeState(me.theme);
        applyTheme(me.theme);
        try {
          localStorage.setItem(STORAGE_KEY, me.theme);
        } catch {
          // ignore
        }
      }
    }
  }, [me?.theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const setTheme = useCallback(
    (newTheme: Theme) => {
      setThemeState(newTheme);
      applyTheme(newTheme);
      try {
        localStorage.setItem(STORAGE_KEY, newTheme);
      } catch {
        // ignore
      }
      updateTheme.mutate({ theme: newTheme });
    },
    [updateTheme],
  );

  return (
    <ThemeContext.Provider value={{ theme, setTheme, isLoading: isMeLoading }}>
      {children}
    </ThemeContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
