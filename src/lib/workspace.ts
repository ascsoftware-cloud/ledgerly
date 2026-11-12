import "server-only";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const row = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  plan: z.enum(["free", "pro"]),
  accent: z.enum(["emerald", "indigo", "coral", "amber", "violet", "sky"]),
  mode: z.enum(["light", "dark"]),
  needs_setup: z.boolean(),
  memberships: z.array(z.object({ role: z.enum(["owner", "admin", "staff", "accountant"]) })).min(1),
});

export type Role = "owner" | "admin" | "staff" | "accountant";

export type WorkspaceContext = {
  workspace: {
    id: string;
    slug: string;
    name: string;
    plan: "free" | "pro";
    accent: z.infer<typeof row>["accent"];
    mode: "light" | "dark";
    needsSetup: boolean;
  };
  role: Role;
  modules: string[];
  user: { id: string; email: string; firstName: string | null };
};

function firstNameFrom(claims: Record<string, unknown>): string | null {
  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
  const full = [meta.full_name, meta.name].find((v): v is string => typeof v === "string" && v.trim() !== "");
  const first = full?.trim().split(/\s+/)[0];
  return first ? first.slice(0, 40) : null;
}

/**
 * The signed-in user's view of one workspace. Sends signed-out visitors to sign in,
 * and shows "not found" (never someone else's data) for any workspace they are not
 * a member of: row-level security decides, this function only reports the answer.
 * Cached per request, so layout and page share one lookup.
 */
export const requireWorkspace = cache(async (slug: string): Promise<WorkspaceContext> => {
  // Workspace pages are per-request (session, clock): never part of a prerendered shell.
  await connection();
  if (!SLUG.test(slug) || slug.length < 3 || slug.length > 40) notFound();

  const supabase = await createServerClient();
  const { data: auth } = await supabase.auth.getClaims();
  const claims = auth?.claims;
  if (!claims?.sub) redirect(`/login?next=${encodeURIComponent(`/${slug}`)}`);

  const [{ data, error }, { data: mods }] = await Promise.all([
    supabase
      .from("workspaces")
      .select("id, slug, name, plan, accent, mode, needs_setup, memberships!inner(role)")
      .eq("slug", slug)
      .eq("memberships.user_id", claims.sub)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase.from("workspace_modules").select("module, workspaces!inner(slug)").eq("workspaces.slug", slug).eq("enabled", true),
  ]);
  if (error) console.error("Workspace lookup failed", { code: error.code });

  const parsed = row.safeParse(data);
  if (!parsed.success) notFound();
  const w = parsed.data;

  return {
    workspace: {
      id: w.id,
      slug: w.slug,
      name: w.name,
      plan: w.plan,
      accent: w.accent,
      mode: w.mode,
      needsSetup: w.needs_setup,
    },
    role: w.memberships[0]!.role,
    modules: (mods ?? []).map((m: { module: string }) => m.module),
    user: {
      id: claims.sub,
      email: typeof claims.email === "string" ? claims.email : "",
      firstName: firstNameFrom(claims as Record<string, unknown>),
    },
  };
});

/** Every workspace the signed-in user belongs to, for the switcher. */
export async function listMyWorkspaces(): Promise<{ slug: string; name: string }[]> {
  const supabase = await createServerClient();
  const { data } = await supabase.from("workspaces").select("slug, name").is("deleted_at", null).order("created_at");
  return z.array(z.object({ slug: z.string(), name: z.string() })).catch([]).parse(data ?? []);
}
