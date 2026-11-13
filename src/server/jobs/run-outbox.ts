import "server-only";
import { z } from "zod";
import { siteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BookingEmailInput, DocumentEmailInput, InviteEmailInput, PortalEmailInput } from "./email-template";
import { processOutbox, type OutboxRow } from "./outbox-core";
import { logTransport, resendTransport, type Transport } from "./transport";

function transportFromEnv(): Transport {
  if (process.env.EMAIL_TRANSPORT === "log") return logTransport;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (apiKey && from) return resendTransport({ apiKey, from });
  if (process.env.NODE_ENV === "production") {
    return async () => ({ ok: false, error: "Email is not set up (RESEND_API_KEY / EMAIL_FROM)" });
  }
  return logTransport;
}

const rowSchema = z.object({
  id: z.uuid(),
  workspace_id: z.uuid(),
  template: z.enum(["document", "reminder", "booking_confirmed", "booking_reminder", "team_invite", "portal_link"]),
  to_address: z.string(),
  reply_to: z.string().nullable(),
  payload: z.object({
    document_id: z.uuid().optional(),
    booking_id: z.uuid().optional(),
    invite_id: z.uuid().optional(),
    token: z.string().max(100).optional(),
    contact_id: z.uuid().optional(),
    message: z.string().nullable().optional(),
  }),
});

const docSchema = z.object({
  kind: z.enum(["invoice", "quote", "credit_note"]),
  number: z.string(),
  status: z.string(),
  due_date: z.string().nullable(),
  total_cents: z.coerce.number(),
  paid_cents: z.coerce.number(),
  credited_cents: z.coerce.number(),
  public_token: z.string(),
  contacts: z.object({ name: z.string() }),
  workspaces: z.object({ name: z.string(), workspace_settings: z.object({ business_name: z.string().nullable() }).nullable() }),
});

const bookingSchema = z.object({
  status: z.enum(["confirmed", "cancelled"]),
  starts_at: z.string(),
  customer_name: z.string(),
  token: z.string(),
  services: z.object({ name: z.string(), duration_min: z.coerce.number() }),
  workspaces: z.object({ name: z.string(), slug: z.string(), workspace_settings: z.object({ business_name: z.string().nullable() }).nullable() }),
});

const inviteSchema = z.object({
  role: z.enum(["admin", "staff", "accountant"]),
  accepted_at: z.string().nullable(),
  expires_at: z.string(),
  invited_by: z.uuid().nullable(),
  workspaces: z.object({ name: z.string(), workspace_settings: z.object({ business_name: z.string().nullable() }).nullable() }),
});

const portalContactSchema = z.object({
  name: z.string(),
  deleted_at: z.string().nullable(),
  workspaces: z.object({ name: z.string(), workspace_settings: z.object({ business_name: z.string().nullable() }).nullable() }),
});

/** Sends what is due in the outbox. Runs from /api/jobs/outbox and right after an email is queued. */
export async function runOutbox(limit = 20) {
  const db = createAdminClient();
  await db.rpc("release_stuck_outbox");

  return processOutbox({
    claim: async () => {
      const { data, error } = await db.rpc("claim_outbox", { p_limit: limit });
      if (error) throw new Error(`claim_outbox failed: ${error.code}`);
      return z.array(rowSchema).parse(data ?? []) as OutboxRow[];
    },
    load: async (documentId, workspaceId, message): Promise<DocumentEmailInput | null> => {
      const { data } = await db
        .from("sales_documents")
        .select(
          "kind, number, status, due_date, total_cents, paid_cents, credited_cents, public_token, contacts(name), workspaces(name, workspace_settings(business_name))",
        )
        .eq("id", documentId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      const d = docSchema.safeParse(data);
      if (!d.success || d.data.status === "draft" || d.data.status === "void") return null;
      return {
        kind: d.data.kind,
        number: d.data.number,
        businessName: d.data.workspaces.workspace_settings?.business_name || d.data.workspaces.name,
        clientName: d.data.contacts.name,
        totalCents: d.data.total_cents,
        balanceCents: Math.max(0, d.data.total_cents - d.data.paid_cents - d.data.credited_cents),
        dueDate: d.data.due_date,
        link: `${siteUrl()}/p/${d.data.public_token}`,
        message,
      };
    },
    loadBooking: async (bookingId, workspaceId): Promise<BookingEmailInput | "cancelled" | null> => {
      const { data } = await db
        .from("bookings")
        .select("status, starts_at, ends_at, customer_name, token, services(name, duration_min), workspaces(name, slug, workspace_settings(business_name))")
        .eq("id", bookingId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      const b = bookingSchema.safeParse(data);
      if (!b.success) return null;
      if (b.data.status === "cancelled") return "cancelled";
      return {
        businessName: b.data.workspaces.workspace_settings?.business_name || b.data.workspaces.name,
        customerName: b.data.customer_name,
        serviceName: b.data.services.name,
        startsAt: b.data.starts_at,
        durationMin: b.data.services.duration_min,
        icsLink: `${siteUrl()}/book/${b.data.workspaces.slug}/${b.data.token}.ics`,
      };
    },
    loadInvite: async (inviteId, workspaceId, token): Promise<InviteEmailInput | "closed" | null> => {
      const { data } = await db
        .from("invites")
        .select("role, accepted_at, expires_at, invited_by, workspaces(name, workspace_settings(business_name))")
        .eq("id", inviteId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      const i = inviteSchema.safeParse(data);
      if (!i.success) return null;
      if (i.data.accepted_at !== null || Date.parse(i.data.expires_at) < Date.now()) return "closed";
      let inviterName = "";
      if (i.data.invited_by) {
        const { data: p } = await db.from("profiles").select("full_name").eq("id", i.data.invited_by).maybeSingle();
        inviterName = (p?.full_name as string | null) ?? "";
        if (!inviterName) {
          const { data: u } = await db.auth.admin.getUserById(i.data.invited_by);
          inviterName = u.user?.email ?? "";
        }
      }
      return {
        businessName: i.data.workspaces.workspace_settings?.business_name || i.data.workspaces.name,
        inviterName,
        role: i.data.role,
        link: `${siteUrl()}/invite/${encodeURIComponent(token)}`,
      };
    },
    loadPortal: async (contactId, workspaceId, message): Promise<PortalEmailInput | "closed" | null> => {
      const { data: c } = await db
        .from("contacts")
        .select("name, deleted_at, workspaces(name, workspace_settings(business_name))")
        .eq("id", contactId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      const contact = portalContactSchema.safeParse(c);
      if (!contact.success) return null;
      if (contact.data.deleted_at !== null) return "closed";
      const { data: l } = await db
        .from("portal_links")
        .select("token")
        .eq("contact_id", contactId)
        .eq("workspace_id", workspaceId)
        .is("revoked_at", null)
        .maybeSingle();
      const token = (l?.token as string | undefined) ?? null;
      if (!token) return "closed";
      return {
        businessName: contact.data.workspaces.workspace_settings?.business_name || contact.data.workspaces.name,
        clientName: contact.data.name,
        link: `${siteUrl()}/portal/${encodeURIComponent(token)}`,
        message,
      };
    },
    send: transportFromEnv(),
    finish: async (id, ok, providerId, error) => {
      await db.rpc("finish_outbox", { p_id: id, p_ok: ok, p_provider_id: providerId, p_error: error });
    },
  });
}
