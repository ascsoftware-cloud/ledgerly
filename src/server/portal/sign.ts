import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Records a client's signature on their own contract: the portal token proves which client,
 * and the database re-checks that the contract is theirs. Uses the service-role key for exactly one call,
 * because the signature records the visitor's IP and device, which the public key must never be able to supply.
 */
export async function signContract(input: { token: string; contractId: string; name: string; image: string | null; ip: string; userAgent: string }): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await createAdminClient().rpc("sign_contract", {
    p_token: input.token,
    p_contract: input.contractId,
    p_name: input.name,
    p_image: input.image,
    p_ip: input.ip,
    p_ua: input.userAgent,
  });
  if (!error) return { ok: true };
  // LDG03 messages are written for the person; anything else is not shown.
  return { ok: false, message: error.code === "LDG03" && error.message ? error.message : "Couldn't record your signature. Try again." };
}
