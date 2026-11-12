import { z } from "zod";
import { parseDateZA, todaySAST } from "@/lib/dates";

const MAX_MINUTES = 24 * 60;

/**
 * Minutes from "1:30", "1,5", "2", "2h", "90m" or "1h 30m". A bare number is hours.
 * Returns null for nothing, zero, or more than a day.
 */
export function parseDuration(input: string): number | null {
  const s = (input ?? "").trim().toLowerCase();
  if (!s) return null;
  let minutes: number | null = null;
  let m = /^(\d{1,2}):([0-5]\d)$/.exec(s);
  if (m) minutes = Number(m[1]) * 60 + Number(m[2]);
  else if ((m = /^(\d+(?:[.,]\d+)?)\s*h?$/.exec(s))) minutes = Math.round(Number((m[1] ?? "").replace(",", ".")) * 60);
  else if ((m = /^(\d+)\s*m(?:in)?$/.exec(s))) minutes = Number(m[1]);
  else if ((m = /^(\d+)\s*h\s*(\d+)\s*m(?:in)?$/.exec(s))) minutes = Number(m[1]) * 60 + Number(m[2]);
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_MINUTES) return null;
  return minutes;
}

export function formatMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** "1:02:05" since `startedAt`. */
export function elapsedLabel(startedAt: string, now: Date = new Date()): string {
  const secs = Math.max(0, Math.floor((now.getTime() - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const mm = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return `${h}:${mm}:${ss}`;
}

export const timeEntrySchema = z.object({
  date: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v?.trim()) return todaySAST();
      const iso = parseDateZA(v);
      if (!iso) {
        ctx.addIssue({ code: "custom", message: "Use a date like 31/01/2027." });
        return z.NEVER;
      }
      if (iso > todaySAST()) {
        ctx.addIssue({ code: "custom", message: "The date cannot be in the future." });
        return z.NEVER;
      }
      return iso;
    }),
  duration: z.string().transform((v, ctx) => {
    const minutes = parseDuration(v);
    if (minutes === null) {
      ctx.addIssue({ code: "custom", message: "How long? Type 1:30, 1,5 or 90m (up to 24 hours)." });
      return z.NEVER;
    }
    return minutes;
  }),
  description: z.string().trim().max(300).optional().default(""),
  billable: z.string().optional().transform((v) => v === "on"),
  taskId: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      if (!z.uuid().safeParse(v).success) {
        ctx.addIssue({ code: "custom", message: "Choose a task from the list." });
        return z.NEVER;
      }
      return v;
    }),
  requestId: z.uuid(),
}).transform(({ duration, ...rest }) => ({ ...rest, minutes: duration }));
