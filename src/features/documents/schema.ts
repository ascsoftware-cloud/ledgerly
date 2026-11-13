import { z } from "zod";
import { formatDate } from "@/lib/dates";

// ---------------------------------------------------------------------------
// Merge fields: {{client_name}}, {{ amount }} …
// ---------------------------------------------------------------------------
export const BUILTIN_FIELDS = ["client_name", "client_email", "client_phone", "client_company", "business_name", "today"] as const;
export const BUILTIN_HELP: Record<(typeof BUILTIN_FIELDS)[number], string> = {
  client_name: "The client's name",
  client_email: "Their email address",
  client_phone: "Their phone number",
  client_company: "Their company",
  business_name: "Your business name",
  today: "Today's date",
};

const FIELD = /\{\{\s*([a-z][a-z0-9_]{0,39})\s*\}\}/g;

/** Each merge field in the text, once, in order of first use. */
export function extractFields(template: string): string[] {
  const seen = new Set<string>();
  for (const m of template.matchAll(FIELD)) seen.add(m[1]!);
  return [...seen];
}

/** The fields the person fills in when making a contract (everything that is not filled from the client and business). */
export function customFields(template: string): string[] {
  return extractFields(template).filter((f) => !(BUILTIN_FIELDS as readonly string[]).includes(f));
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Fills a template. `html` (the default) escapes every value, for anything shown as HTML or put in an email.
 * `text` keeps values exactly, for storing a contract as plain text that React then shows safely.
 * One pass only: a value that itself contains {{x}} is not expanded again. A field with no value is left in place
 * so it is not missed. The template's own wording is never changed.
 */
export function renderTemplate(template: string, data: Record<string, string>, mode: "html" | "text" = "html"): string {
  return template.replace(FIELD, (whole, name: string) => {
    if (!Object.hasOwn(data, name)) return whole;
    const value = data[name]!;
    return mode === "html" ? escapeHtml(value) : value;
  });
}

export function builtinData(i: {
  client: { name: string; email: string | null; phone: string | null; company: string | null };
  businessName: string;
  today: string;
}): Record<(typeof BUILTIN_FIELDS)[number], string> {
  return {
    client_name: i.client.name,
    client_email: i.client.email ?? "",
    client_phone: i.client.phone ?? "",
    client_company: i.client.company ?? "",
    business_name: i.businessName,
    today: formatDate(i.today),
  };
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------
const text = (max: number, what: string) =>
  z
    .string()
    .max(max, `Keep ${what} under ${max.toLocaleString("en-ZA")} characters.`)
    .refine((s) => s.trim().length > 0, `Enter ${what}.`);

export const templateSchema = z.object({
  name: z.string().trim().min(1, "Name the template.").max(120, "Keep the name under 120 characters."),
  body: text(20000, "the template text"),
});

export const contractSchema = z.object({
  contactId: z.uuid({ message: "Choose a client." }),
  templateId: z.uuid().nullish(),
  title: z.string().trim().min(1, "Give the contract a title.").max(160, "Keep the title under 160 characters."),
  body: text(20000, "the contract text"),
});

export const folderSchema = z.object({
  name: z.string().trim().min(1, "Name the folder.").max(80, "Keep the folder name under 80 characters."),
});

export const MAX_SIGNATURE_CHARS = 150_000;
export const signSchema = z.object({
  name: z.string().trim().min(2, "Type your full name to sign.").max(120, "Keep your name under 120 characters."),
  image: z
    .string()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || (v.length <= MAX_SIGNATURE_CHARS && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v)), "The drawn signature isn't valid. Try again or just type your name."),
});

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const FILE_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

export function isAllowedFile(f: { name: string; type: string; size: number }): boolean {
  return Object.hasOwn(FILE_TYPES, f.type) && f.size > 0 && f.size <= MAX_FILE_BYTES;
}

/** A display name: no path pieces, trimmed, at most 200 characters (the extension survives the cut). */
export const fileSchema = z.object({
  name: z.string().transform((raw) => {
    const base = (raw.split(/[\\/]/).pop() ?? "").trim() || "file";
    if (base.length <= 200) return base;
    const dot = base.lastIndexOf(".");
    const ext = dot > 0 && base.length - dot <= 10 ? base.slice(dot) : "";
    return base.slice(0, 200 - ext.length) + ext;
  }),
});

export const CONTRACT_STATUS_LABEL = { draft: "Draft", sent: "Waiting for signature", signed: "Signed", void: "Withdrawn" } as const;
