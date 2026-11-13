import { z } from "zod";

export const TRIGGER_KEYS = ["invoice_overdue", "quote_unaccepted", "stock_below", "booking_soon", "task_overdue"] as const;
export const ACTION_KEYS = ["send_reminder", "notify_me", "create_task"] as const;
export type Trigger = (typeof TRIGGER_KEYS)[number];
export type Action = (typeof ACTION_KEYS)[number];

export const TRIGGERS: Record<Trigger, { label: string }> = {
  invoice_overdue: { label: "An invoice is overdue" },
  quote_unaccepted: { label: "A quote has had no answer" },
  stock_below: { label: "A product falls to its re-order level" },
  booking_soon: { label: "A booking is coming up" },
  task_overdue: { label: "A task is overdue" },
};
export const ACTIONS: Record<Action, string> = {
  send_reminder: "Email the client a reminder",
  notify_me: "Notify me",
  create_task: "Make a task",
};

/** What each trigger may do (the same list the database enforces). */
export function actionsFor(t: Trigger): Action[] {
  if (t === "invoice_overdue" || t === "quote_unaccepted") return ["send_reminder", "notify_me", "create_task"];
  if (t === "task_overdue") return ["notify_me"];
  return ["notify_me", "create_task"];
}

export function unitFor(t: Trigger): "days" | "hours" | null {
  return t === "stock_below" ? null : t === "booking_soon" ? "hours" : "days";
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** A rule as one plain sentence. */
export function describeRule(r: { trigger: Trigger; threshold: number; action: Action }): string {
  const n = r.threshold;
  const when = {
    invoice_overdue: n > 0 ? `an invoice is ${plural(n, "day")} overdue` : "an invoice is overdue",
    quote_unaccepted: n > 0 ? `a quote has had no answer for ${plural(n, "day")}` : "a quote has had no answer",
    stock_below: "a product falls to its re-order level",
    booking_soon: `a booking is within ${plural(n, "hour")}`,
    task_overdue: n > 0 ? `a task is ${plural(n, "day")} overdue` : "a task is overdue",
  }[r.trigger];
  const then = { send_reminder: "email the client a reminder", notify_me: "notify me", create_task: "make a task" }[r.action];
  return `When ${when}, ${then}.`;
}

export const ruleSchema = z
  .object({
    name: z.string().trim().min(1, "Name the rule.").max(80, "Keep the name under 80 characters."),
    trigger: z.enum(TRIGGER_KEYS, { message: "Choose when this should happen." }),
    threshold: z.string().optional().default("0"),
    action: z.enum(ACTION_KEYS, { message: "Choose what to do." }),
  })
  .transform((v, ctx) => {
    if (!actionsFor(v.trigger).includes(v.action)) {
      ctx.addIssue({ code: "custom", path: ["action"], message: "That trigger can't do that. Choose one of the actions offered." });
      return z.NEVER;
    }
    const unit = unitFor(v.trigger);
    let threshold = 0;
    if (unit !== null) {
      const raw = v.threshold.trim();
      const max = unit === "hours" ? 168 : 365;
      const min = unit === "hours" ? 1 : 0;
      if (!/^-?\d+(\.\d+)?$/.test(raw) && raw !== "") {
        ctx.addIssue({ code: "custom", path: ["threshold"], message: `Enter a whole number of ${unit}, from ${min} to ${max}.` });
        return z.NEVER;
      }
      const n = raw === "" ? 0 : Number(raw);
      if (!Number.isInteger(n)) {
        ctx.addIssue({ code: "custom", path: ["threshold"], message: `Enter a whole number of ${unit}, from ${min} to ${max}.` });
        return z.NEVER;
      }
      if (n < min || n > max) {
        ctx.addIssue({ code: "custom", path: ["threshold"], message: `Enter a whole number of ${unit}, from ${min} to ${max}.` });
        return z.NEVER;
      }
      threshold = n;
    }
    return { name: v.name, trigger: v.trigger, threshold, action: v.action };
  });
export type RuleInput = z.output<typeof ruleSchema>;
