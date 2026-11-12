import "server-only";
import { headers } from "next/headers";
import { connection } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { createServerClient } from "@/lib/supabase/server";
import { isToken, publicDocumentSchema, type PublicDocument } from "./public";

export async function requestIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export type PublicLoad = { kind: "ok"; doc: PublicDocument } | { kind: "missing" } | { kind: "busy" };

/** Loads a document by its link token, at most 120 times an hour per visitor. */
export async function loadPublicDocument(token: string): Promise<PublicLoad> {
  // Per-request only: never part of a prerendered shell (the rate limit and view count must be real).
  await connection();
  if (!isToken(token)) return { kind: "missing" };
  if (!(await rateLimit("public-ip", await requestIp(), 120, 3600))) return { kind: "busy" };
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("get_public_document", { p_token: token });
  if (error) console.error("get_public_document failed", { code: error.code });
  const parsed = publicDocumentSchema.safeParse(data);
  return parsed.success ? { kind: "ok", doc: parsed.data } : { kind: "missing" };
}
