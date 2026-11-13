"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createPortalLink, emailPortalLink, revokePortalLink, rotatePortalLink } from "../actions";
import { CopyLink } from "./contract-tools";

/** On a client's page: their private portal (invoices, quotes, contracts), shared by a revocable link. */
export function PortalPanel({ slug, contactId, link: initial, hasEmail }: { slug: string; contactId: string; link: string | null; hasEmail: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [link, setLink] = useState<string | null>(initial);
  const [confirm, setConfirm] = useState<"rotate" | "revoke" | null>(null);
  const [message, setMessage] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  const run = (fn: () => Promise<{ ok: true; link: string | null } | { ok: false; message: string }>, done: string) =>
    start(async () => {
      const r = await fn();
      setConfirm(null);
      if (!r.ok) return void toast.error(r.message);
      setLink(r.link);
      toast.success(done);
      router.refresh();
    });

  return (
    <section aria-labelledby="portal-heading" className="space-y-3 rounded-2xl border bg-card p-5 shadow-card">
      <div>
        <h2 id="portal-heading" className="font-semibold">
          Client portal
        </h2>
        <p className="text-sm text-muted-foreground">One private page where this client sees their invoices, quotes and contracts, pays and signs. Anyone with the link can open it, so share it only with them.</p>
      </div>
      {link ? (
        <>
          <CopyLink link={link} label="Portal link" />
          <label className="block space-y-1 text-sm font-medium">
            Message with the email <span className="font-normal text-muted-foreground">(optional)</span>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} maxLength={1000} className="w-full rounded-xl border bg-background p-3 text-base" />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="touch"
              disabled={pending || !hasEmail}
              onClick={() =>
                start(async () => {
                  const r = await emailPortalLink(slug, contactId, message, requestId);
                  if (!r.ok) return void toast.error(r.message ?? "Couldn't send the email.");
                  toast.success("Email on its way");
                  setRequestId(crypto.randomUUID());
                  setMessage("");
                })
              }
            >
              Email the link
            </Button>
            {confirm === "rotate" ? (
              <span className="flex gap-1" role="group" aria-label="Make a new link?">
                <Button type="button" variant="destructive" size="touch" disabled={pending} onClick={() => run(() => rotatePortalLink(slug, contactId), "New link made. The old one no longer works.")}>
                  Yes, new link
                </Button>
                <Button type="button" variant="ghost" size="touch" onClick={() => setConfirm(null)}>
                  Keep
                </Button>
              </span>
            ) : (
              <Button type="button" variant="outline" size="touch" onClick={() => setConfirm("rotate")}>
                New link
              </Button>
            )}
            {confirm === "revoke" ? (
              <span className="flex gap-1" role="group" aria-label="Turn the portal off?">
                <Button type="button" variant="destructive" size="touch" disabled={pending} onClick={() => run(() => revokePortalLink(slug, contactId), "Portal turned off")}>
                  Yes, turn it off
                </Button>
                <Button type="button" variant="ghost" size="touch" onClick={() => setConfirm(null)}>
                  Keep
                </Button>
              </span>
            ) : (
              <Button type="button" variant="ghost" size="touch" onClick={() => setConfirm("revoke")}>
                Turn off
              </Button>
            )}
          </div>
          {!hasEmail && <p className="text-sm text-muted-foreground">Add an email address to this client to email them the link.</p>}
        </>
      ) : (
        <Button type="button" variant="outline" size="touch" disabled={pending} onClick={() => run(() => createPortalLink(slug, contactId), "Portal link made")}>
          Make a portal link
        </Button>
      )}
    </section>
  );
}
