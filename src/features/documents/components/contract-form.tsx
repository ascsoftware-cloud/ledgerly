"use client";

import { useActionState, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createContract, type FormResult } from "../actions";
import { customFields } from "../schema";

/** Pick a client and a template (or write your own); fields the template needs are asked for here. */
export function NewContractForm({
  slug,
  contacts,
  templates,
  initialContact = "",
}: {
  slug: string;
  contacts: { id: string; name: string }[];
  templates: { id: string; name: string; body: string }[];
  initialContact?: string;
}) {
  const router = useRouter();
  const [contactId, setContactId] = useState(initialContact);
  const [templateId, setTemplateId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const template = templates.find((t) => t.id === templateId);
  const fields = useMemo(() => customFields(template ? template.body : body), [template, body]);

  const [state, action, pending] = useActionState<FormResult, FormData>(async (prev, form) => {
    const r = await createContract(slug, prev, form);
    if (r.status === "saved") {
      toast.success(r.message);
      router.push(`/${slug}/docs/contracts/${r.id}`);
    }
    return r;
  }, { status: "idle" });
  const field = "h-12 w-full rounded-xl border bg-background px-3 text-base";

  return (
    <form action={action} noValidate aria-label="New contract" className="space-y-4 rounded-2xl border bg-card p-5 shadow-card">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-medium">
          Client
          <select name="contactId" value={contactId} onChange={(e) => setContactId(e.target.value)} className={field}>
            <option value="">Choose a client</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          Template
          <select
            name="templateId"
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value);
              const t = templates.find((x) => x.id === e.target.value);
              if (t && !title) setTitle(t.name);
            }}
            className={field}
          >
            <option value="">Write it myself</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block space-y-1 text-sm font-medium">
        Title
        <Input name="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Service agreement" className="h-12 text-base" />
      </label>
      {!template && (
        <label className="block space-y-1 text-sm font-medium">
          Contract text <span className="font-normal text-muted-foreground">(you can use fields like {"{{client_name}}"})</span>
          <textarea name="body" value={body} onChange={(e) => setBody(e.target.value)} rows={12} maxLength={20000} className="w-full rounded-xl border bg-background p-3 text-base" />
        </label>
      )}
      {fields.length > 0 && (
        <fieldset className="space-y-3 rounded-xl border p-4">
          <legend className="px-1 text-sm font-medium">Fill in the details</legend>
          {fields.map((f) => (
            <label key={f} className="block space-y-1 text-sm font-medium">
              <span className="capitalize">{f.replace(/_/g, " ")}</span>
              <Input name={`f_${f}`} value={values[f] ?? ""} onChange={(e) => setValues({ ...values, [f]: e.target.value })} maxLength={500} className="h-12 text-base" />
            </label>
          ))}
        </fieldset>
      )}
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="touch" disabled={pending}>
          {pending ? "Making…" : "Make the contract"}
        </Button>
        <Button type="button" variant="ghost" size="touch" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
