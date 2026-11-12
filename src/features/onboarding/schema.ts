import { z } from "zod";

/**
 * The answers a new user taps through on /start. Stored in the browser until sign-in,
 * then sent to the database, so this schema is also what the server validates.
 * Bump `v` whenever the shape changes; older saved drafts are then discarded.
 */

export const ANSWERS_VERSION = 1;

export const BUSINESS = ["service", "online_store", "freelancer", "agency", "food", "trades", "other"] as const;
export const TEAM = ["solo", "2_5", "6_20", "20_plus"] as const;
export const HEADACHES = [
  "getting_paid",
  "tracking_money",
  "finding_clients",
  "managing_tasks",
  "stock",
  "admin",
] as const;
export const MANAGE = ["invoices", "clients", "projects", "expenses", "inventory", "team", "bookings"] as const;
export const PAID = ["cash", "eft", "card", "yoco", "payfast", "none"] as const;
export const REVENUE = ["none", "under_20k", "20k_100k", "100k_500k", "500k_plus"] as const;
export const ACCENT = ["emerald", "indigo", "coral", "amber", "violet", "sky"] as const;
export const DAILY_MINUTES = [5, 10, 15] as const;

function pickSome<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .array(z.enum(values))
    .min(1)
    .refine((list) => new Set(list).size === list.length, "Choices must be unique");
}

export const answersSchema = z.object({
  v: z.literal(ANSWERS_VERSION),
  business: z.enum(BUSINESS),
  team: z.enum(TEAM),
  headaches: pickSome(HEADACHES),
  manage: pickSome(MANAGE),
  paid: pickSome(PAID).refine(
    (list) => !list.includes("none") || list.length === 1,
    "'Not yet' cannot be combined with a payment method",
  ),
  revenue: z.enum(REVENUE),
  accent: z.enum(ACCENT),
  mode: z.enum(["light", "dark"]),
  dailyMinutes: z.union([z.literal(5), z.literal(10), z.literal(15)]),
});

export type OnboardingAnswers = z.infer<typeof answersSchema>;
export type AnswerKey = Exclude<keyof OnboardingAnswers, "v">;
export type PartialAnswers = Partial<Omit<OnboardingAnswers, "v">>;

export const ANSWER_KEYS = Object.keys(answersSchema.shape).filter((k) => k !== "v") as AnswerKey[];
