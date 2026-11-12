"use client";

import { useCallback, useSyncExternalStore } from "react";
import { STORAGE_KEY, emptyDraft, loadDraft, saveDraft, type Draft, type KeyValueStore } from "./store";

const EVENT = "ledgerly:onboarding";

// When localStorage is blocked, progress lives here for the life of the page.
const memory = new Map<string, string>();
const fallbackStore: KeyValueStore = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k),
};

function store(): KeyValueStore {
  try {
    localStorage.getItem(STORAGE_KEY);
    return localStorage;
  } catch {
    return fallbackStore;
  }
}

// useSyncExternalStore needs the same object back while nothing has changed.
let cachedRaw: string | null | undefined;
let cachedDraft: Draft = emptyDraft();

function snapshot(): Draft {
  const s = store();
  let raw: string | null;
  try {
    raw = s.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedDraft = loadDraft(s);
  }
  return cachedDraft;
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * The saved onboarding draft. `null` on the server and during hydration, so the
 * page shows a skeleton rather than flashing question one before jumping ahead.
 */
export function useDraft(): [Draft | null, (update: (draft: Draft) => Draft) => void] {
  const draft = useSyncExternalStore(subscribe, snapshot, () => null);

  const update = useCallback((fn: (draft: Draft) => Draft) => {
    saveDraft(store(), fn(snapshot()));
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return [draft, update];
}
