"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_ACCENT, isAccent, type Accent, type Mode } from "./accents";
import { ACCENT_KEY, THEME_KEY } from "./theme-script";

type ThemeContextValue = {
  accent: Accent;
  mode: Mode;
  setAccent: (accent: Accent) => void;
  setMode: (mode: Mode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or storage disabled: the choice lasts for this page only.
  }
}

function resolve(mode: Mode): "light" | "dark" {
  if (mode !== "system") return mode;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(mode: Mode, accent: Accent) {
  const root = document.documentElement;
  root.setAttribute("data-theme", resolve(mode));
  root.setAttribute("data-accent", accent);
}

export function ThemeProvider({
  children,
  accent: initialAccent = DEFAULT_ACCENT,
  mode: initialMode = "system",
}: {
  children: ReactNode;
  accent?: Accent;
  mode?: Mode;
}) {
  const [accent, setAccentState] = useState<Accent>(() => {
    if (typeof window === "undefined") return initialAccent;
    const saved = read(ACCENT_KEY);
    return isAccent(saved) ? saved : initialAccent;
  });
  const [mode, setModeState] = useState<Mode>(() => {
    if (typeof window === "undefined") return initialMode;
    const saved = read(THEME_KEY);
    return saved === "light" || saved === "dark" || saved === "system" ? saved : initialMode;
  });

  // Re-apply after hydration (React's dev remount clears attributes it does not own)
  // and follow the OS setting while in "system" mode.
  useLayoutEffect(() => {
    apply(mode, accent);
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system", accent);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode, accent]);

  const setAccent = useCallback((next: Accent) => {
    write(ACCENT_KEY, next);
    setAccentState(next);
  }, []);

  const setMode = useCallback((next: Mode) => {
    write(THEME_KEY, next);
    setModeState(next);
  }, []);

  const value = useMemo(
    () => ({ accent, mode, setAccent, setMode }),
    [accent, mode, setAccent, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
