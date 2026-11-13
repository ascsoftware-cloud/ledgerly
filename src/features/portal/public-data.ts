import "server-only";
import { connection } from "next/server";
import { z } from "zod";
import { requestIp } from "@/features/sales/public-data";
import { rateLimit } from "@/lib/rate-limit";
import { createServerClient } from "@/lib/supabase/server";

const TOKEN = /^[A-Za-z0-9_-]{32}$/;

const portalSchema = z.object({
  business: z.string(),
  client: z.string(),
  documents: z.array(
    z.object({
      kind: z.enum(["invoice", "quote", "credit_note"]),
      number: z.string().nullable(),
      status: z.string(),
      issue_date: z.string(),
      due_date: z.string().nullable(),
      total_cents: z.coerce.number(),
      balance_cents: z.coerce.number().nullable(),
      token: z.string(),
    }),
  ),
  contracts: z.array(z.object({ id: z.uuid(), title: z.string(), status: z.enum(["sent", "signed"]), sent_at: z.string().nullable(), signed_at: z.string().nullable() })),
});
export type PortalData = z.infer<typeof portalSchema>;

/** A client's portal, by its link token. At most 120 loads an hour per visitor; a bad or revoked token is "missing". */
export async function loadPortal(token: string): Promise<{ kind: "ok"; portal: PortalData } | { kind: "missing" } | { kind: "busy" }> {
  await connection();
  if (!TOKEN.test(token)) return { kind: "missing" };
  if (!(await rateLimit("public-ip", await requestIp(), 120, 3600))) return { kind: "busy" };
  const supabase = await createServerClient();
  const { data } = await supabase.rpc("get_portal", { p_token: token });
  const parsed = portalSchema.safeParse(data);
  return parsed.success ? { kind: "ok", portal: parsed.data } : { kind: "missing" };
}

const contractSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  body: z.string(),
  status: z.enum(["sent", "signed"]),
  signed_at: z.string().nullable(),
  signer_name: z.string().nullable(),
  business: z.string(),
  client: z.string(),
});
export type PortalContract = z.infer<typeof contractSchema>;

export async function loadPortalContract(token: string, id: string): Promise<{ kind: "ok"; contract: PortalContract } | { kind: "missing" } | { kind: "busy" }> {
  await connection();
  if (!TOKEN.test(token) || !z.uuid().safeParse(id).success) return { kind: "missing" };
  if (!(await rateLimit("public-ip", await requestIp(), 120, 3600))) return { kind: "busy" };
  const supabase = await createServerClient();
  const { data } = await supabase.rpc("get_portal_contract", { p_token: token, p_contract: id });
  const parsed = contractSchema.safeParse(data);
  return parsed.success ? { kind: "ok", contract: parsed.data } : { kind: "missing" };
}
