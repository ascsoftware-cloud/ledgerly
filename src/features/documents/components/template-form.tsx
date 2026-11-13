"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { archiveTemplate, saveTemplate, type FormResult } from "../actions";
import { BUILTIN_FIELDS, BUILTIN_HELP, customFields } from "../schema";

/** Write a contract once with {{fields}}; each new contract fills them in. */
export function TemplateForm({ slug, templateId = null, initial }: { slug: string; templateId?: string | null; initial?: { name: string; body: string } }) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState<FormResult, FormData>(async (prev, form) => {
    const r = await saveTemplate(slug, templateId, prev, form);
    if (r.status === "saved") {
      toast.success(r.message);
      router.push(`/${slug}/docs/templates`);
    }
    return r;
  }, { status: "idle" });
  const extra = customFields(body);
  return (
    <div className="space-y-4">
      <form action={action} noValidate aria-label={templateId ? "Edit template" : "New template"} className="space-y-4 rounded-2xl border bg-card p-5 shadow-card">
        <label className="block space-y-1 text-sm font-medium">
          Template name
          <Input name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Service agreement" className="h-12 text-base" autoFocus={!templateId} />
        </label>
        <label className="block space-y-1 text-sm font-medium">
          Text
          <textarea
            name="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={16}
            maxLength={20000}
            placeholder={"This agreement is between {{business_name}} and {{client_name}}.\n\nThe agreed price is {{price}}, due by {{due_date}}."}
            className="w-full rounded-xl border bg-background p-3 font-mono text-sm"
          />
        </label>
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>
            Put a field in double curly brackets, like <code className="rounded bg-muted px-1">{"{{client_name}}"}</code>. These fill in by themselves:
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {BUILTIN_FIELDS.map((f) => (
              <li key={f} title={BUILTIN_HELP[f]} className="rounded-full bg-muted px-2.5 py-1 font-mono text-xs">
                {`{{${f}}}`}
              </li>
            ))}
          </ul>
          <p>
            Anything else (lower-case letters, numbers and underscores){extra.length ? ", like " : "."}
            {extra.map((f) => (
              <code key={f} className="mx-0.5 rounded bg-muted px-1">{`{{${f}}}`}</code>
            ))}
            {extra.length ? ", is asked for when you make a contract." : ""}
          </p>
        </div>
        {state.status === "error" && (
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="touch" disabled={pending}>
            {pending ? "Saving…" : templateId ? "Save changes" : "Save template"}
          </Button>
          <Button type="button" variant="ghost" size="touch" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
      {templateId &&
        (confirming ? (
          <span className="flex flex-wrap gap-1" role="group" aria-label="Archive this template?">
            <Button
              type="button"
              variant="destructive"
              size="touch"
              onClick={async () => {
                const r = await archiveTemplate(slug, templateId);
                if (!r.ok) return void toast.error("Couldn't archive that.");
                toast.success("Template archived");
                router.push(`/${slug}/docs/templates`);
              }}
            >
              Yes, archive it
            </Button>
            <Button type="button" variant="ghost" size="touch" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </span>
        ) : (
          <Button type="button" variant="outline" size="touch" onClick={() => setConfirming(true)}>
            Archive template
          </Button>
        ))}
    </div>
  );
}
