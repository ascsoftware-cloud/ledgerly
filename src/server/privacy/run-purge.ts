import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { processPurge } from "./purge-core";

const BUCKETS = ["receipts", "payment-proofs", "documents"] as const;
const due = z.object({ workspaces: z.array(z.uuid()), users: z.array(z.uuid()) });

type Db = ReturnType<typeof createAdminClient>;

/** Every file path under `prefix` in a bucket, following folders. */
async function listAll(db: Db, bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 100, offset });
    if (error) throw new Error(`list ${bucket} failed`);
    if (!data?.length) break;
    for (const item of data) {
      const path = `${prefix}/${item.name}`;
      if (item.id === null) out.push(...(await listAll(db, bucket, path)));
      else out.push(path);
    }
    if (data.length < 100) break;
  }
  return out;
}

/** Deletes the businesses and accounts whose 7-day grace is over (migration 0039). */
export async function runPurge() {
  const db = createAdminClient();
  const { data, error } = await db.rpc("purge_due");
  if (error) throw new Error(`purge_due failed: ${error.code}`);
  return processPurge(due.parse(data), {
    removeFiles: async (workspaceId) => {
      for (const bucket of BUCKETS) {
        const paths = await listAll(db, bucket, workspaceId);
        for (let i = 0; i < paths.length; i += 100) {
          const { error: rmErr } = await db.storage.from(bucket).remove(paths.slice(i, i + 100));
          if (rmErr) throw new Error(`remove ${bucket} failed`);
        }
      }
    },
    deleteWorkspace: async (workspaceId) => {
      const { error: delErr } = await db.from("workspaces").delete().eq("id", workspaceId);
      if (delErr) throw new Error(`delete workspace failed: ${delErr.code}`);
    },
    deleteUser: async (userId) => {
      const { error: delErr } = await db.auth.admin.deleteUser(userId);
      if (delErr) throw new Error("delete user failed");
    },
  });
}
