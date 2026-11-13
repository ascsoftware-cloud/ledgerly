"use server";

import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { hrefForResult, searchSchema } from "./keys";

export type SearchHit = { kind: string; id: string; title: string; subtitle: string | null; href: string };

const rows = z.array(z.object({ kind: z.string(), id: z.uuid(), title: z.string(), subtitle: z.string().nullable() }));

/** Searches the business the person is in. The database function runs as them, so they only find what they may see. */
export async function searchWorkspace(slug: string, q: unknown): Promise<SearchHit[]> {
  const parsed = searchSchema.safeParse(q);
  if (!parsed.success || parsed.data.length < 2) return [];
  const ctx = await requireWorkspace(slug);
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("search", { p_workspace: ctx.workspace.id, p_q: parsed.data });
  if (error) return [];
  const list = rows.safeParse(data);
  if (!list.success) return [];
  return list.data.flatMap((r) => {
    const href = hrefForResult(ctx.workspace.slug, r.kind, r.id);
    return href ? [{ ...r, href }] : [];
  });
}
