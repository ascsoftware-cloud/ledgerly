import "server-only";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import type { WorkspaceContext } from "@/lib/workspace";

export type Provider = "courier_guy" | "shopify" | "xero" | "sage_za";

const connectionRow = z.object({
  id: z.uuid(),
  provider: z.enum(["courier_guy", "shopify", "xero", "sage_za"]),
  status: z.enum(["active", "needs_reauth", "disabled"]),
  mode: z.enum(["test", "live"]),
  external_id: z.string().nullable(),
  external_name: z.string().nullable(),
  settings: z.record(z.string(), z.unknown()).catch({}),
  last_sync_at: z.string().nullable(),
  last_error: z.string().nullable(),
});
export type IntegrationConnection = z.infer<typeof connectionRow>;

const jobRow = z.object({
  id: z.uuid(),
  connection_id: z.uuid(),
  kind: z.string(),
  entity_id: z.uuid().nullable(),
  status: z.string(),
  attempts: z.number(),
  last_error: z.string().nullable(),
  created_at: z.string(),
});
export type IntegrationJob = z.infer<typeof jobRow>;

/** Live (or needing reconnection) apps for a workspace, keyed by provider. */
export async function getConnections(
  ctx: WorkspaceContext,
): Promise<Partial<Record<Provider, IntegrationConnection>>> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("integration_connections")
    .select(
      "id, provider, status, mode, external_id, external_name, settings, last_sync_at, last_error",
    )
    .eq("workspace_id", ctx.workspace.id)
    .neq("status", "disabled");
  const rows = z
    .array(connectionRow)
    .catch([])
    .parse(data ?? []);
  return Object.fromEntries(rows.map((r) => [r.provider, r]));
}

/** Jobs that stopped and need a person, newest first (owners, admins and accountants only). */
export async function failedJobs(ctx: WorkspaceContext, limit = 20): Promise<IntegrationJob[]> {
  if (ctx.role === "staff") return [];
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("integration_jobs")
    .select("id, connection_id, kind, entity_id, status, attempts, last_error, created_at")
    .eq("workspace_id", ctx.workspace.id)
    .eq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(limit);
  return z
    .array(jobRow)
    .catch([])
    .parse(data ?? []);
}

export async function pendingJobCount(ctx: WorkspaceContext): Promise<number> {
  if (ctx.role === "staff") return 0;
  const supabase = await createServerClient();
  const { count } = await supabase
    .from("integration_jobs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ctx.workspace.id)
    .in("status", ["pending", "running"]);
  return count ?? 0;
}

const linkRow = z.object({
  connection_id: z.uuid(),
  external_number: z.string().nullable(),
  mismatch: z.boolean(),
  synced_at: z.string(),
});

/** Where one document stands in each connected accounting app. */
export async function documentSyncStatus(ctx: WorkspaceContext, documentId: string) {
  const supabase = await createServerClient();
  const [conns, links, jobs] = await Promise.all([
    supabase
      .from("integration_connections")
      .select("id, provider, external_name, status")
      .eq("workspace_id", ctx.workspace.id)
      .in("provider", ["xero", "sage_za"])
      .neq("status", "disabled"),
    supabase
      .from("sync_links")
      .select("connection_id, external_number, mismatch, synced_at")
      .eq("workspace_id", ctx.workspace.id)
      .eq("entity_type", "document")
      .eq("local_id", documentId),
    ctx.role === "staff"
      ? Promise.resolve({ data: [] })
      : supabase
          .from("integration_jobs")
          .select("connection_id, status, last_error")
          .eq("workspace_id", ctx.workspace.id)
          .eq("entity_id", documentId)
          .in("kind", ["push_document", "void_document"]),
  ]);
  const linkList = z
    .array(linkRow)
    .catch([])
    .parse(links.data ?? []);
  const jobList = z
    .array(
      z.object({ connection_id: z.uuid(), status: z.string(), last_error: z.string().nullable() }),
    )
    .catch([])
    .parse(jobs.data ?? []);
  return z
    .array(
      z.object({
        id: z.uuid(),
        provider: z.enum(["xero", "sage_za"]),
        external_name: z.string().nullable(),
        status: z.string(),
      }),
    )
    .catch([])
    .parse(conns.data ?? [])
    .map((c) => {
      const l = linkList.find((x) => x.connection_id === c.id);
      const failed = jobList.find((j) => j.connection_id === c.id && j.status === "failed");
      const waiting = jobList.some(
        (j) => j.connection_id === c.id && (j.status === "pending" || j.status === "running"),
      );
      return {
        connectionId: c.id,
        provider: c.provider,
        name: c.external_name,
        state: l
          ? l.mismatch
            ? "mismatch"
            : "synced"
          : failed
            ? "failed"
            : waiting
              ? "waiting"
              : "not_sent",
        number: l?.external_number ?? null,
        error: failed?.last_error ?? null,
      } as const;
    });
}
