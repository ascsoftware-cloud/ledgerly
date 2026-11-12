import "server-only";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import type { WorkspaceContext } from "@/lib/workspace";

const contactRow = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  created_at: z.string(),
  companies: z.object({ id: z.uuid(), name: z.string() }).nullable(),
});
export type ContactRow = z.infer<typeof contactRow>;

const SELECT = "id, name, email, phone, address, created_at, companies(id, name)";

/** Active clients, newest first, optionally filtered by a search phrase. RLS scopes to the workspace. */
export async function listContacts(ctx: WorkspaceContext, q?: string): Promise<ContactRow[]> {
  const supabase = await createServerClient();
  let query = supabase
    .from("contacts")
    .select(SELECT)
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  const term = q?.trim().slice(0, 80);
  if (term) {
    // Prefix search on each word: "thand mok" finds "Thandi Mokoena".
    const words = term
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.replace(/[^\p{L}\p{N}@.+]/gu, ""))
      .filter(Boolean);
    if (words.length) query = query.textSearch("search", words.map((w) => `${w}:*`).join(" & "), { config: "simple" });
  }
  const { data } = await query;
  return z.array(contactRow).catch([]).parse(data ?? []);
}

const noteRow = z.object({
  id: z.uuid(),
  body: z.string(),
  created_at: z.string(),
  author_id: z.string().nullable(),
});
const activityRow = z.object({
  id: z.uuid(),
  kind: z.string(),
  summary: z.string(),
  created_at: z.string(),
});

export type ContactDetail = ContactRow & {
  deletedAt: string | null;
  notes: z.infer<typeof noteRow>[];
  activities: z.infer<typeof activityRow>[];
};

export async function getContact(ctx: WorkspaceContext, id: string): Promise<ContactDetail | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const supabase = await createServerClient();
  const ws = ctx.workspace.id;
  const [contact, notes, activities] = await Promise.all([
    supabase.from("contacts").select(`${SELECT}, deleted_at`).eq("workspace_id", ws).eq("id", id).maybeSingle(),
    supabase
      .from("notes")
      .select("id, body, created_at, author_id")
      .eq("workspace_id", ws)
      .eq("contact_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("activities")
      .select("id, kind, summary, created_at")
      .eq("workspace_id", ws)
      .eq("contact_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const c = contactRow.extend({ deleted_at: z.string().nullable() }).safeParse(contact.data);
  if (!c.success) return null;
  return {
    ...c.data,
    deletedAt: c.data.deleted_at,
    notes: z.array(noteRow).catch([]).parse(notes.data ?? []),
    activities: z.array(activityRow).catch([]).parse(activities.data ?? []),
  };
}
