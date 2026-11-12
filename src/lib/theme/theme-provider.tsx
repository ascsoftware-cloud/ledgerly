"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
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
const EVENT = "ledgerly:theme";

// Used only when localStorage is blocked, so choices still work for this visit.
const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    memory.set(key, value);
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange); // another tab changed it
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function isMode(v: unknown): v is Mode {
  return v === "light" || v === "dark" || v === "system";
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

/**
 * Holds the user's colour mode and accent. The saved values live in localStorage and are
 * read through useSyncExternalStore: the server and the first client render both use the
 * defaults (so hydration matches), then React re-renders with the saved values. The
 * inline THEME_SCRIPT has already applied them to <html>, so there is no visual flash.
 */
export function ThemeProvider({
  children,
  accent: defaultAccent = DEFAULT_ACCENT,
  mode: defaultMode = "system",
}: {
  children: ReactNode;
  accent?: Accent;
  mode?: Mode;
}) {
  const savedMode = useSyncExternalStore(
    subscribe,
    () => read(THEME_KEY),
    () => null,
  );
  const savedAccent = useSyncExternalStore(
    subscribe,
    () => read(ACCENT_KEY),
    () => null,
  );
  const mode = isMode(savedMode) ? savedMode : defaultMode;
  const accent = isAccent(savedAccent) ? savedAccent : defaultAccent;

  // Keep <html> in step with state, and follow the OS setting while in "system" mode.
  useLayoutEffect(() => {
    apply(mode, accent);
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system", accent);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode, accent]);

  const setAccent = useCallback((next: Accent) => write(ACCENT_KEY, next), []);
  const setMode = useCallback((next: Mode) => write(THEME_KEY, next), []);

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
