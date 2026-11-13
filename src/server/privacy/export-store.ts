import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A finished export is parked in the private "exports" bucket (only the server can reach it) and handed to the owner
 * as a 60-second download link. A function's own response is limited to a few megabytes, a stored file is not.
 * The daily job removes anything older than a day.
 */
export async function storeExport(workspaceId: string, fileName: string, zip: Uint8Array): Promise<string | null> {
  const db = createAdminClient();
  const path = `${workspaceId}/${randomUUID()}.zip`;
  const up = await db.storage.from("exports").upload(path, zip, { contentType: "application/zip", upsert: false });
  if (up.error) return null;
  const signed = await db.storage.from("exports").createSignedUrl(path, 60, { download: fileName });
  return signed.data?.signedUrl ?? null;
}
