import { describe, expect, test } from "vitest";
import { QUESTIONS } from "./questions";
import { answersSchema, type OnboardingAnswers } from "./schema";
import {
  STORAGE_KEY,
  clearDraft,
  emptyDraft,
  loadAnswers,
  loadDraft,
  saveDraft,
  type KeyValueStore,
} from "./store";

const complete: OnboardingAnswers = {
  v: 1,
  business: "freelancer",
  team: "solo",
  headaches: ["getting_paid", "admin"],
  manage: ["invoices", "clients"],
  paid: ["eft", "yoco"],
  revenue: "20k_100k",
  accent: "violet",
  mode: "dark",
  dailyMinutes: 10,
};

function memoryStore(initial?: string): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(STORAGE_KEY, initial);
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const brokenStore: KeyValueStore = {
  getItem: () => {
    throw new Error("storage disabled");
  },
  setItem: () => {
    throw new Error("storage disabled");
  },
  removeItem: () => {
    throw new Error("storage disabled");
  },
};

describe("answersSchema", () => {
  test("accepts a complete, valid set of answers", () => {
    expect(answersSchema.parse(complete)).toEqual(complete);
  });

  test.each([
    ["unknown business type", { business: "spaceship" }],
    ["empty headaches", { headaches: [] }],
    ["empty manage list", { manage: [] }],
    ["empty payment methods", { paid: [] }],
    ["unknown accent", { accent: "beige" }],
    ["daily goal that is not offered", { dailyMinutes: 7 }],
    ["old version", { v: 0 }],
    ["duplicate choices", { manage: ["invoices", "invoices"] }],
  ])("rejects %s", (_name, patch) => {
    expect(answersSchema.safeParse({ ...complete, ...patch }).success).toBe(false);
  });

  test("'Not yet' cannot be combined with a real payment method", () => {
    expect(answersSchema.safeParse({ ...complete, paid: ["none", "eft"] }).success).toBe(false);
    expect(answersSchema.safeParse({ ...complete, paid: ["none"] }).success).toBe(true);
  });

  test("drops unknown extra fields instead of storing them", () => {
    const parsed = answersSchema.parse({ ...complete, isAdmin: true });
    expect(parsed).not.toHaveProperty("isAdmin");
  });
});

describe("draft storage", () => {
  test("nothing saved gives an empty draft at step 0", () => {
    expect(loadDraft(memoryStore())).toEqual(emptyDraft());
    expect(emptyDraft().step).toBe(0);
  });

  test.each([
    ["not JSON", "not json{"],
    ["an old version", JSON.stringify({ v: 0, step: 3, answers: { business: "agency" } })],
    ["the wrong shape", JSON.stringify([1, 2, 3])],
    ["null", "null"],
  ])("%s gives an empty draft", (_name, raw) => {
    expect(loadDraft(memoryStore(raw))).toEqual(emptyDraft());
  });

  test("blocked storage gives an empty draft and saving does not throw", () => {
    expect(loadDraft(brokenStore)).toEqual(emptyDraft());
    expect(() => saveDraft(brokenStore, emptyDraft())).not.toThrow();
    expect(() => clearDraft(brokenStore)).not.toThrow();
  });

  test("a saved draft comes back with its step and answers", () => {
    const store = memoryStore();
    saveDraft(store, { v: 1, step: 3, answers: { business: "trades", team: "2_5" } });
    expect(loadDraft(store)).toEqual({ v: 1, step: 3, answers: { business: "trades", team: "2_5" } });
  });

  test("a tampered answer is dropped but the valid ones are kept", () => {
    const raw = JSON.stringify({ v: 1, step: 2, answers: { business: "spaceship", team: "solo" } });
    expect(loadDraft(memoryStore(raw)).answers).toEqual({ team: "solo" });
  });

  test("a step beyond the last question is clamped", () => {
    const raw = JSON.stringify({ v: 1, step: 99, answers: {} });
    expect(loadDraft(memoryStore(raw)).step).toBe(QUESTIONS.length);
  });

  test("clearDraft removes it", () => {
    const store = memoryStore();
    saveDraft(store, { v: 1, step: 1, answers: { business: "agency" } });
    clearDraft(store);
    expect(store.data.size).toBe(0);
  });
});

describe("loadAnswers", () => {
  test("is null until every question is answered", () => {
    const store = memoryStore();
    saveDraft(store, { v: 1, step: 4, answers: { business: "agency", team: "solo" } });
    expect(loadAnswers(store)).toBeNull();
  });

  test("returns the validated answers once complete", () => {
    const store = memoryStore();
    const answers = Object.fromEntries(Object.entries(complete).filter(([k]) => k !== "v"));
    saveDraft(store, { v: 1, step: QUESTIONS.length, answers });
    expect(loadAnswers(store)).toEqual(complete);
  });

  test("is null for missing or blocked storage (e.g. sign-in link opened on another device)", () => {
    expect(loadAnswers(memoryStore())).toBeNull();
    expect(loadAnswers(brokenStore)).toBeNull();
  });
});

describe("QUESTIONS", () => {
  test("there are eight, in the order of the spec", () => {
    expect(QUESTIONS.map((q) => q.id)).toEqual([
      "business",
      "team",
      "headaches",
      "manage",
      "paid",
      "revenue",
      "vibe",
      "dailyMinutes",
    ]);
  });

  test("every question has a title and at least two options (except the vibe picker)", () => {
    for (const q of QUESTIONS) {
      expect(q.title.length).toBeGreaterThan(5);
      if (q.kind !== "theme") expect(q.options.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("Miko has something to say about every option", () => {
    for (const q of QUESTIONS) {
      if (q.kind === "theme") continue;
      for (const o of q.options) {
        const selection = q.kind === "multi" ? [o.value] : o.value;
        expect(q.react(selection as never).length, `${q.id}/${o.value}`).toBeGreaterThan(3);
      }
    }
  });

  test("the one-person answer gets its special line", () => {
    const team = QUESTIONS.find((q) => q.id === "team")!;
    expect(team.react("solo" as never)).toBe("Nice, a one-person army!");
  });

  test("every option value is accepted by the schema", () => {
    const shape = answersSchema.shape;
    for (const q of QUESTIONS) {
      if (q.kind === "theme") continue;
      for (const o of q.options) {
        const field = shape[q.id as keyof typeof shape];
        const value = q.kind === "multi" ? [o.value] : o.value;
        expect(field.safeParse(value).success, `${q.id}/${o.value}`).toBe(true);
      }
    }
  });
});
