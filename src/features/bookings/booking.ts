import { z } from "zod";
import { normalisePhone } from "@/lib/phone";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SAST_MS = 2 * 3600_000; // South Africa has no daylight saving.
const sast = (iso: string) => new Date(new Date(iso).getTime() + SAST_MS);
const two = (n: number) => String(n).padStart(2, "0");

/** "08:30" in SAST. */
export function slotLabel(iso: string): string {
  const d = sast(iso);
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/** "Fri 20 Nov 2026, 10:00" in SAST. */
export function whenLabel(iso: string): string {
  const d = sast(iso);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${slotLabel(iso)}`;
}

const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const escapeText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** RFC 5545 folding: no line longer than 75 octets; continuations start with a space. */
function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let current = "";
  let limit = 75;
  for (const ch of line) {
    if (enc.encode(current + ch).length > limit) {
      out.push(current);
      current = ` ${ch}`;
      limit = 75;
    } else current += ch;
  }
  out.push(current);
  return out.join("\r\n");
}

export function buildIcs(e: { uid: string; startsAt: string; endsAt: string; stamp: string; summary: string; description: string; location?: string }): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ledgerly//Bookings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${utc(e.stamp)}`,
    `DTSTART:${utc(e.startsAt)}`,
    `DTEND:${utc(e.endsAt)}`,
    `SUMMARY:${escapeText(e.summary)}`,
    ...(e.description ? [`DESCRIPTION:${escapeText(e.description)}`] : []),
    ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

export const bookingSchema = z.object({
  serviceId: z.uuid({ message: "Choose a service." }),
  startsAt: z.iso.datetime({ offset: true, message: "Choose a time from the list." }),
  name: z.string().trim().min(2, "Type your name.").max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Check your email address."),
  phone: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v?.trim()) return null;
      const p = normalisePhone(v);
      if (!p) {
        ctx.addIssue({ code: "custom", message: "Check the phone number, or leave it blank." });
        return z.NEVER;
      }
      return p;
    }),
  notes: z.string().trim().max(500, "Keep the note under 500 characters.").optional().default(""),
});
export type BookingInput = z.output<typeof bookingSchema>;
