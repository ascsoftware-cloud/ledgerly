import { z } from "zod";
import { parseDateZA } from "@/lib/dates";

export type TaskStatus = "todo" | "doing" | "done";
export type TaskPriority = "low" | "normal" | "high";
export type TaskItem = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  project_id: string | null;
  parent_id: string | null;
  assignee_id: string | null;
};

export const STATUS_LABEL: Record<TaskStatus, string> = { todo: "To do", doing: "Doing", done: "Done" };
export const PRIORITY_LABEL: Record<TaskPriority, string> = { low: "Low", normal: "Normal", high: "High" };
const ORDER: TaskStatus[] = ["todo", "doing", "done"];
const RANK: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };

/** Open work first (soonest due, then high priority), undated after, finished last. */
export function sortForList<T extends TaskItem>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const doneA = a.status === "done" ? 1 : 0;
    const doneB = b.status === "done" ? 1 : 0;
    if (doneA !== doneB) return doneA - doneB;
    if (a.due_date !== b.due_date) {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date < b.due_date ? -1 : 1;
    }
    if (RANK[a.priority] !== RANK[b.priority]) return RANK[a.priority] - RANK[b.priority];
    return a.title.localeCompare(b.title);
  });
}

export function boardColumns<T extends TaskItem>(tasks: T[]): { key: TaskStatus; label: string; tasks: T[] }[] {
  const sorted = sortForList(tasks);
  return ORDER.map((key) => ({ key, label: STATUS_LABEL[key], tasks: sorted.filter((t) => t.status === key) }));
}

export function moveStatus(status: TaskStatus, dir: "left" | "right"): TaskStatus {
  const i = ORDER.indexOf(status) + (dir === "right" ? 1 : -1);
  return ORDER[Math.min(Math.max(i, 0), ORDER.length - 1)] ?? status;
}

const isoOf = (d: Date) => d.toISOString().slice(0, 10);

/** Monday-first weeks covering `month` ("2026-11"), each day with the tasks due on it. */
export function calendarWeeks<T extends TaskItem>(month: string, tasks: T[]): { date: string; inMonth: boolean; tasks: T[] }[][] {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // days before the 1st, Monday-first
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7;
  const byDay = new Map<string, T[]>();
  for (const t of sortForList(tasks)) if (t.due_date) byDay.set(t.due_date, [...(byDay.get(t.due_date) ?? []), t]);
  const days = Array.from({ length: cells }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1, 1 - lead + i));
    const date = isoOf(d);
    return { date, inMonth: d.getUTCMonth() === m - 1, tasks: byDay.get(date) ?? [] };
  });
  return Array.from({ length: cells / 7 }, (_, w) => days.slice(w * 7, w * 7 + 7));
}

const optionalUuid = (message: string) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      if (!z.uuid().safeParse(v).success) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return v;
    });

export const taskSchema = z.object({
  title: z.string().trim().min(1, "Give the task a name.").max(200, "Keep the name under 200 characters."),
  projectId: optionalUuid("Choose a project from the list."),
  assigneeId: optionalUuid("Choose someone from the list."),
  dueDate: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v?.trim()) return null;
      const iso = parseDateZA(v);
      if (!iso) {
        ctx.addIssue({ code: "custom", message: "Use a date like 31/01/2027." });
        return z.NEVER;
      }
      return iso;
    }),
  priority: z.enum(["low", "normal", "high"], { message: "Pick a priority." }),
  notes: z.string().trim().max(2000).optional().default(""),
});
