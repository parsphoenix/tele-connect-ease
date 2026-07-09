import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "dark" | "light";

interface ThemeCtx {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

function apply(theme: Theme) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.classList.toggle("dark", theme === "dark");
  el.style.colorScheme = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // SSR default = dark to match server-rendered `<html>` (avoid hydration flash).
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    const saved =
      typeof window !== "undefined" ? (localStorage.getItem("theme") as Theme | null) : null;
    const initial: Theme = saved === "light" || saved === "dark" ? saved : "dark";
    setThemeState(initial);
    apply(initial);
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    apply(t);
    if (typeof window !== "undefined") localStorage.setItem("theme", t);
  };
  const toggle = () => setTheme(theme === "dark" ? "light" : "dark");

  return <Ctx.Provider value={{ theme, setTheme, toggle }}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTheme outside provider");
  return c;
}
