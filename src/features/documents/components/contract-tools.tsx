"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteContractDraft, emailPortalLink, saveContract, sendContract, voidContract, type FormResult } from "../actions";

/** A copyable link with a Copy button. */
export function CopyLink({ link, label = "Link for your client" }: { link: string; label?: string }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-wrap gap-2">
        <Input readOnly value={link} aria-label={label} onFocus={(e) => e.currentTarget.select()} className="h-11 min-w-0 flex-1 text-sm" />
        <Button
          type="button"
          variant="outline"
          size="touch"
          onClick={() => navigator.clipboard.writeText(link).then(() => toast.success("Link copied"), () => toast.error("Couldn't copy. Select the link and copy it."))}
        >
          <Copy className="size-5" aria-hidden /> Copy
        </Button>
      </div>
    </div>
  );
}

/** Editing a draft: title and text. Once sent, the text is frozen. */
export function ContractDraftForm({ slug, id, title, body }: { slug: string; id: string; title: string; body: string }) {
  const router = useRouter();
  const [t, setT] = useState(title);
  const [b, setB] = useState(body);
  const [state, action, pending] = useActionState<FormResult, FormData>(async (prev, form) => {
    const r = await saveContract(slug, id, prev, form);
    if (r.status === "saved") {
      toast.success(r.message);
      router.refresh();
    }
    return r;
  }, { status: "idle" });
  return (
    <form action={action} noValidate aria-label="Edit contract" className="space-y-4 rounded-2xl border bg-card p-5 shadow-card">
      <label className="block space-y-1 text-sm font-medium">
        Title
        <Input name="title" value={t} onChange={(e) => setT(e.target.value)} className="h-12 text-base" />
      </label>
      <label className="block space-y-1 text-sm font-medium">
        Text
        <textarea name="body" value={b} onChange={(e) => setB(e.target.value)} rows={16} maxLength={20000} className="w-full rounded-xl border bg-background p-3 text-base" />
      </label>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
      <Button type="submit" variant="outline" size="touch" disabled={pending}>
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}

/** Send for signing, share the link, email it, withdraw or delete, depending on where the contract is. */
export function ContractActions({
  slug,
  id,
  contactId,
  status,
  canVoid,
  clientHasEmail,
  portalLink,
}: {
  slug: string;
  id: string;
  contactId: string;
  status: "draft" | "sent" | "signed" | "void";
  canVoid: boolean;
  clientHasEmail: boolean;
  portalLink: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [link, setLink] = useState<string | null>(portalLink);
  const [confirm, setConfirm] = useState<"void" | "delete" | null>(null);
  const [message, setMessage] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  const send = () =>
    start(async () => {
      const r = await sendContract(slug, id);
      if (!r.ok) return void toast.error(r.message);
      setLink(r.link);
      toast.success("Sent for signing. Share the link with your client.");
      router.refresh();
    });
  const email = () =>
    start(async () => {
      const r = await emailPortalLink(slug, contactId, message, requestId);
      if (!r.ok) return void toast.error(r.message ?? "Couldn't send the email.");
      toast.success("Email on its way");
      setRequestId(crypto.randomUUID());
      setMessage("");
    });

  return (
    <div className="space-y-4">
      {status === "draft" && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="touch" disabled={pending} onClick={send}>
            Send for signing
          </Button>
          {confirm === "delete" ? (
            <span className="flex gap-1" role="group" aria-label="Delete this draft?">
              <Button
                type="button"
                variant="destructive"
                size="touch"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await deleteContractDraft(slug, id);
                    if (!r.ok) return void toast.error("Couldn't delete that.");
                    toast.success("Draft deleted");
                    router.push(`/${slug}/docs/contracts`);
                  })
                }
              >
                Yes, delete the draft
              </Button>
              <Button type="button" variant="ghost" size="touch" onClick={() => setConfirm(null)}>
                Keep
              </Button>
            </span>
          ) : (
            <Button type="button" variant="ghost" size="touch" onClick={() => setConfirm("delete")}>
              Delete draft
            </Button>
          )}
        </div>
      )}

      {(status === "sent" || status === "signed") && link && (
        <div className="space-y-3 rounded-2xl border bg-card p-5 shadow-card">
          <CopyLink link={link} label={status === "sent" ? "Your client signs here (their portal link)" : "Your client's portal link"} />
          {status === "sent" && (
            <div className="space-y-2">
              <label className="block space-y-1 text-sm font-medium">
                Message with the email <span className="font-normal text-muted-foreground">(optional)</span>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} maxLength={1000} className="w-full rounded-xl border bg-background p-3 text-base" />
              </label>
              <Button type="button" variant="outline" size="touch" disabled={pending || !clientHasEmail} onClick={email}>
                Email the link
              </Button>
              {!clientHasEmail && <p className="text-sm text-muted-foreground">Add an email address to this client to email them the link.</p>}
            </div>
          )}
        </div>
      )}

      {status === "sent" && canVoid && (
        <div>
          {confirm === "void" ? (
            <span className="flex flex-wrap gap-1" role="group" aria-label="Withdraw this contract?">
              <Button
                type="button"
                variant="destructive"
                size="touch"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await voidContract(slug, id);
                    setConfirm(null);
                    if (!r.ok) return void toast.error(r.message ?? "Couldn't withdraw it.");
                    toast.success("Contract withdrawn");
                    router.refresh();
                  })
                }
              >
                Yes, withdraw it
              </Button>
              <Button type="button" variant="ghost" size="touch" onClick={() => setConfirm(null)}>
                Keep
              </Button>
            </span>
          ) : (
            <Button type="button" variant="ghost" size="touch" onClick={() => setConfirm("void")}>
              Withdraw this contract
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
