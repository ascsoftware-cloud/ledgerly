import type { SupabaseClient } from "@supabase/supabase-js";

export const STORAGE_FULL = "You've used all the storage on your plan (Free has 200 MB; Pro has 10 GB). Everything you have is still there to view and download.";

/**
 * Is there room for `bytes` more in this business's files? The database counts what is stored (migration 0038).
 * If the check itself fails we let the upload through: a fault on our side should not stop someone's work.
 */
export async function hasStorageRoom(supabase: SupabaseClient, workspaceId: string, bytes: number): Promise<boolean> {
  const { data, error } = await supabase.rpc("storage_room", { p_workspace: workspaceId, p_bytes: Math.max(0, Math.floor(bytes)) });
  if (error) {
    console.error("storage_room failed", { code: error.code });
    return true;
  }
  return data !== false;
}
