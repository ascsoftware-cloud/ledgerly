import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const CONSENT_VERSION = "v1";

/**
 * Keeps a log of when someone agreed to, or withdrew from, a specific use of their information (the AI provider,
 * push notifications). Best effort: a failure here never blocks the action it records.
 */
export async function recordConsent(
  supabase: SupabaseClient,
  i: { userId: string; workspaceId: string | null; kind: "ai_provider" | "push" | "terms"; granted: boolean },
): Promise<void> {
  try {
    await supabase.from("consents").insert({ user_id: i.userId, workspace_id: i.workspaceId, kind: i.kind, granted: i.granted, version: CONSENT_VERSION });
  } catch {
    // Not recorded; the action itself already happened.
  }
}
