"use client";

import { useCallback, useSyncExternalStore } from "react";

const EVENT = "ledgerly:flag";
// Used only when localStorage is blocked, so toggles still work for this visit.
const memory = new Map<string, string>();

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

/**
 * A boolean preference kept in localStorage. The server and the first client render
 * use `fallback` (so hydration matches); the saved value applies immediately after.
 */
export function useStoredFlag(key: string, fallback: boolean): [boolean, (next: boolean) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  const value = raw === null ? fallback : raw === "1";

  const set = useCallback(
    (next: boolean) => {
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        memory.set(key, next ? "1" : "0");
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [key],
  );

  return [value, set];
}
