import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

/** A fresh secret for one invitation link: 32 random bytes, URL-safe. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What the database stores. Same as `encode(sha256(convert_to(token, 'utf8')), 'hex')` in SQL. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export const INVITE_ROLES = ["admin", "staff", "accountant"] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

export const ROLE_LABEL = { owner: "Owner", admin: "Admin", staff: "Staff", accountant: "Accountant" } as const;

/** In plain words, what each role can do (spec §3). */
export const ROLE_HELP: Record<InviteRole | "owner", string> = {
  owner: "Everything, including the plan, billing and deleting the business.",
  admin: "Everything except billing and deleting the business, including reports and the team.",
  staff: "Creates and edits invoices, clients, expenses, tasks and stock. No reports, team, settings or payment keys.",
  accountant: "Read-only on everything financial, and can export reports. Cannot change anything.",
};

export const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(200, "That email address is too long.")
    .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "That email address doesn't look right."),
  role: z.enum(INVITE_ROLES, { message: "Choose admin, staff or accountant." }),
});
export type InviteInput = z.output<typeof inviteSchema>;

export const roleSchema = z.enum(["admin", "staff", "accountant", "owner"], { message: "Choose a role." });
