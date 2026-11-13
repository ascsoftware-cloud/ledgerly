"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Copy, FilePlus2, FileMinus, Mail, MessageCircle, Pencil, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { convertQuote, creditNote, deleteDraft, emailDocument, sendDocument, voidDocument } from "../actions";
import type { ShownStatus } from "../status";

export function DocumentActions({
  slug,
  id,
  kind,
  status,
  number,
  role,
  shareUrl,
  whatsappText,
  clientPhone,
  clientEmail,
}: {
  slug: string;
  id: string;
  kind: "invoice" | "quote" | "credit_note";
  status: ShownStatus;
  number: string | null;
  role: "owner" | "admin" | "staff" | "accountant";
  shareUrl: string;
  whatsappText: string;
  clientPhone: string | null;
  clientEmail: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmVoid, setConfirmVoid] = useState(false);
  // A new id each time the email form opens: pressing Send twice still sends one email.
  const [emailing, setEmailing] = useState<{ requestId: string } | null>(null);
  const [to, setTo] = useState(clientEmail ?? "");
  const [message, setMessage] = useState("");
  const canWrite = role !== "accountant";
  const canManage = role === "owner" || role === "admin";
  const isDraft = status === "draft";
  const whatsapp = `https://wa.me/${clientPhone ? clientPhone.replace(/^\+/, "") : ""}?text=${encodeURIComponent(whatsappText)}`;

  const run = (fn: () => Promise<{ ok: boolean; message?: string; number?: string; warning?: string } | undefined | void>, success?: string) =>
    start(async () => {
      const res = await fn();
      if (res && !res.ok) toast.error(res.message ?? "That didn't work.");
      else {
        if (success) toast.success(success);
        if (res && "warning" in res && res.warning) toast.warning(res.warning, { duration: 10000 });
      }
      router.refresh();
    });

  if (!canWrite) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {isDraft ? (
        <>
          <Button size="touch" disabled={pending} onClick={() => run(() => sendDocument(slug, id), "Sent. Share it with your client.")}>
            <Send className="size-5" aria-hidden /> Send
          </Button>
          <Link href={`/${slug}/money/${id}/edit`} className={buttonVariants({ variant: "outline", size: "touch" })}>
            <Pencil className="size-5" aria-hidden /> Edit
          </Link>
          <Button
            variant="outline"
            size="touch"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await deleteDraft(slug, id);
                if (!res.ok) toast.error(res.message);
                else {
                  toast.success("Draft deleted");
                  router.push(`/${slug}/money`);
                }
              })
            }
          >
            <Trash2 className="size-5" aria-hidden /> Delete draft
          </Button>
        </>
      ) : (
        status !== "void" && (
          <>
            <Button
              variant="outline"
              size="touch"
              aria-expanded={!!emailing}
              onClick={() => setEmailing(emailing ? null : { requestId: crypto.randomUUID() })}
            >
              <Mail className="size-5" aria-hidden /> Email it
            </Button>
            <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size: "touch" })}>
              <MessageCircle className="size-5" aria-hidden /> Send on WhatsApp
            </a>
            <Button
              variant="outline"
              size="touch"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(shareUrl);
                  toast.success("Link copied");
                } catch {
                  toast(shareUrl);
                }
              }}
            >
              <Copy className="size-5" aria-hidden /> Copy link
            </Button>
            {kind === "quote" && (
              <Button variant="outline" size="touch" disabled={pending} onClick={() => run(() => convertQuote(slug, id))}>
                <FilePlus2 className="size-5" aria-hidden /> Turn into invoice
              </Button>
            )}
            {kind === "invoice" && canManage && (
              <Button variant="outline" size="touch" disabled={pending} onClick={() => run(() => creditNote(slug, id))}>
                <FileMinus className="size-5" aria-hidden /> Credit note
              </Button>
            )}
            {canManage &&
              (confirmVoid ? (
                <Button
                  variant="destructive"
                  size="touch"
                  disabled={pending}
                  onClick={() => run(() => voidDocument(slug, id), `${number ?? "Document"} voided`)}
                >
                  <Ban className="size-5" aria-hidden /> Yes, void {number}
                </Button>
              ) : (
                <Button variant="ghost" size="touch" onClick={() => setConfirmVoid(true)}>
                  <Ban className="size-5" aria-hidden /> Void
                </Button>
              ))}
          </>
        )
      )}
      {emailing && (
        <form
          aria-label="Email this document"
          noValidate
          className="w-full space-y-3 rounded-2xl border bg-card p-4 shadow-card"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await emailDocument(slug, id, { to, message, requestId: emailing.requestId });
              if (!res.ok) toast.error(res.message);
              else {
                toast.success(`Email on its way to ${to}`);
                setEmailing(null);
                router.refresh();
              }
            });
          }}
        >
          <label className="block space-y-1 text-sm font-medium">
            To
            <Input type="email" inputMode="email" value={to} onChange={(e) => setTo(e.target.value)} className="h-12 text-base" />
          </label>
          <label className="block space-y-1 text-sm font-medium">
            Message <span className="font-normal text-muted-foreground">(optional)</span>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className="text-base" />
          </label>
          <Button type="submit" size="touch" disabled={pending || !to}>
            {pending ? "Sending…" : "Send email"}
          </Button>
        </form>
      )}
    </div>
  );
}
