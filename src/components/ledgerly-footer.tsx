import { Suspense } from "react";
import { connection } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

async function Footer({ kind, params }: { kind: "document" | "portal"; params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const supabase = await createServerClient();
  const { data } = await supabase.rpc(kind === "document" ? "show_footer_for_document" : "show_footer_for_portal", { p_token: token });
  // Only a clear "no" (a Pro business) hides it; anything else, including an error, shows it.
  if (data === false) return null;
  return <p className="pt-4 text-center text-xs text-muted-foreground">Sent with Ledgerly</p>;
}

/** "Sent with Ledgerly" on a Free business's public pages. Pro businesses do not show it. */
export function SentWithLedgerly({ kind, params }: { kind: "document" | "portal"; params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={null}>
      <Footer kind={kind} params={params} />
    </Suspense>
  );
}
