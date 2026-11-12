import { QUESTIONS } from "./questions";
import {
  ANSWERS_VERSION,
  ANSWER_KEYS,
  answersSchema,
  type OnboardingAnswers,
  type PartialAnswers,
} from "./schema";

/**
 * Saves onboarding progress in the browser so a refresh, or leaving to sign in,
 * loses nothing. Every function tolerates missing, corrupt, tampered or blocked
 * storage: the worst case is starting the questions again.
 */

export const STORAGE_KEY = "ledgerly-onboarding";

export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type Draft = {
  v: typeof ANSWERS_VERSION;
  /** Index of the question being shown; QUESTIONS.length means "all answered". */
  step: number;
  answers: PartialAnswers;
};

export function emptyDraft(): Draft {
  return { v: ANSWERS_VERSION, step: 0, answers: {} };
}

export function loadDraft(storage: KeyValueStore): Draft {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return emptyDraft();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return emptyDraft();

  const raw = parsed as { v?: unknown; step?: unknown; answers?: unknown };
  if (raw.v !== ANSWERS_VERSION) return emptyDraft();

  // Keep each answer only if it is individually valid.
  const answers: Record<string, unknown> = {};
  const source = typeof raw.answers === "object" && raw.answers !== null ? raw.answers : {};
  for (const key of ANSWER_KEYS) {
    const result = answersSchema.shape[key].safeParse((source as Record<string, unknown>)[key]);
    if (result.success) answers[key] = result.data;
  }

  const step =
    typeof raw.step === "number" && Number.isInteger(raw.step)
      ? Math.min(Math.max(raw.step, 0), QUESTIONS.length)
      : 0;

  return { v: ANSWERS_VERSION, step, answers: answers as PartialAnswers };
}

export function saveDraft(storage: KeyValueStore, draft: Draft): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Storage blocked or full: progress lasts for this page view only.
  }
}

export function clearDraft(storage: KeyValueStore): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** The finished answers, or null if any question is unanswered or storage is unavailable. */
export function loadAnswers(storage: KeyValueStore): OnboardingAnswers | null {
  const draft = loadDraft(storage);
  const result = answersSchema.safeParse({ v: ANSWERS_VERSION, ...draft.answers });
  return result.success ? result.data : null;
}
