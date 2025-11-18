import { createContext, useContext, useEffect, useState } from "react";
import { useSettingsStore, type ThemePreference } from "@/store/settings-store";

type Theme = "dark" | "light" | "system";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  ...props
}: ThemeProviderProps) {
  const storeTheme = useSettingsStore((s) => s.theme);
  const setThemePreference = useSettingsStore((s) => s.setThemePreference);

  const [theme, setTheme] = useState<Theme>(
    () =>
      storeTheme ||
      ((localStorage.getItem(storageKey) as Theme | null) ?? defaultTheme),
  );

  // Keep local theme in sync if external store updates it first.
  useEffect(() => {
    if (storeTheme && storeTheme !== theme) {
      setTheme(storeTheme);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeTheme]);

  useEffect(() => {
    const root = window.document.documentElement;

    const applyTheme = () => {
      const resolvedTheme =
        theme === "system"
          ? window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"
          : theme;

      root.classList.remove("light", "dark");
      root.classList.add(resolvedTheme);
    };

    applyTheme();

    if (theme !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => applyTheme();
    media.addEventListener("change", listener);

    return () => media.removeEventListener("change", listener);
  }, [theme]);

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme);
      setTheme(theme);
      setThemePreference(theme as ThemePreference);
    },
  };

  useEffect(() => {
    setThemePreference(theme as ThemePreference);
  }, [theme, setThemePreference]);

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");

  return context;
};
