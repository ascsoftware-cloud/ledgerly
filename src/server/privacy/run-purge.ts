import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/ops/log";
import { reportError } from "@/lib/ops/report";
import { processPurge } from "./purge-core";

const BUCKETS = ["receipts", "payment-proofs", "documents", "exports"] as const;
const due = z.object({ workspaces: z.array(z.uuid()), users: z.array(z.uuid()), blocked: z.array(z.uuid()).default([]) });

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
  const parsed = due.parse(data);
  // A business PayFast is still charging for is never deleted: say so, so the owner can be asked to cancel.
  if (parsed.blocked.length) {
    log.warn("purge_blocked_by_subscription", { count: parsed.blocked.length });
    await reportError({ error: new Error("Businesses waiting to be deleted still have an active subscription"), route: "/api/jobs/purge", method: "POST" });
  }
  await removeOldExports(db);
  const result = await processPurge({ workspaces: parsed.workspaces, users: parsed.users }, {
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
  if (result.failed > 0) {
    log.error("purge_failures", { failed: result.failed });
    await reportError({ error: new Error("The daily deletion job could not delete everything that was due"), route: "/api/jobs/purge", method: "POST" });
  }
  return { ...result, blocked: parsed.blocked.length };
}

/** Export downloads are only needed for a few minutes: anything older than a day goes. */
async function removeOldExports(db: Db): Promise<void> {
  const cutoff = Date.now() - 24 * 3600_000;
  const { data: folders } = await db.storage.from("exports").list("", { limit: 100 });
  for (const folder of folders ?? []) {
    if (folder.id !== null) continue;
    const { data: files } = await db.storage.from("exports").list(folder.name, { limit: 100 });
    const old = (files ?? []).filter((f) => f.created_at && Date.parse(f.created_at) < cutoff).map((f) => `${folder.name}/${f.name}`);
    if (old.length) await db.storage.from("exports").remove(old);
  }
}
