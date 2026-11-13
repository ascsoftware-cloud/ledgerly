import { z } from "zod";

export const searchSchema = z.string().trim().max(60);

export type NavPlace = { key: string; href: string };
export type KeyContext = { slug: string; nav: NavPlace[]; canCreate: boolean };
export type KeyOutcome = { pending?: string; go?: string; help?: boolean };

const GO: Record<string, string> = { h: "home", m: "money", c: "clients", w: "work", s: "stock" };

/**
 * Two-key shortcuts ("g" then "h"). `prev` is the key waiting from a moment ago, or null.
 * Returns what to do: wait for another key, go somewhere, open help, or nothing ({}).
 * Places a business has switched off are not shortcuts.
 */
export function nextKey(prev: string | null, key: string, ctx: KeyContext): KeyOutcome {
  const k = key.length === 1 ? key.toLowerCase() : key;
  const p = prev?.toLowerCase() ?? null;
  const base = `/${ctx.slug}`;

  if (p === "g") {
    const place = GO[k] && ctx.nav.find((n) => n.key === GO[k]);
    return place ? { go: place.href } : {};
  }
  if (p === "n" && ctx.canCreate) {
    const to: Record<string, string> = {
      i: `${base}/money/new?kind=invoice`,
      c: `${base}/clients/new`,
      t: `${base}/work/tasks/new`,
      e: `${base}/money/expenses/new`,
    };
    return to[k] ? { go: to[k] } : {};
  }
  if (k === "g") return { pending: "g" };
  if (k === "n" && ctx.canCreate) return { pending: "n" };
  if (k === "?") return { help: true };
  return {};
}

/** Shortcuts must never fire while someone is typing. */
export function isTypingTarget(t: { tagName: string; isContentEditable: boolean } | null): boolean {
  if (!t) return false;
  return t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
}

export function hrefForResult(slug: string, kind: string, id: string): string | null {
  switch (kind) {
    case "client":
      return `/${slug}/clients/${id}`;
    case "invoice":
    case "quote":
      return `/${slug}/money/${id}`;
    case "task":
      return `/${slug}/work/tasks/${id}`;
    case "project":
      return `/${slug}/work/projects/${id}`;
    case "product":
      return `/${slug}/stock/${id}`;
    default:
      return null;
  }
}

export const KIND_LABEL: Record<string, string> = { client: "Client", invoice: "Invoice", quote: "Quote", task: "Task", project: "Project", product: "Product" };

export const SHORTCUT_HELP = [
  { keys: "Ctrl K", does: "Search everything (Cmd K on a Mac)" },
  { keys: "g then h", does: "Go to Home" },
  { keys: "g then m", does: "Go to Money" },
  { keys: "g then c", does: "Go to Clients" },
  { keys: "g then w", does: "Go to Work" },
  { keys: "g then s", does: "Go to Stock" },
  { keys: "n then i", does: "New invoice" },
  { keys: "n then c", does: "New client" },
  { keys: "n then t", does: "New task" },
  { keys: "n then e", does: "Log an expense" },
  { keys: "?", does: "Show this list" },
];
