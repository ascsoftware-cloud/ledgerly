"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveContact, type FormState } from "../actions";

type Values = { name: string; email: string; phone: string; company: string; address: string };

const FIELDS: { name: keyof Values; label: string; type?: string; inputMode?: "email" | "tel"; autoComplete?: string; hint?: string }[] = [
  { name: "name", label: "Name", autoComplete: "name" },
  { name: "email", label: "Email", type: "email", inputMode: "email", autoComplete: "email", hint: "Optional" },
  { name: "phone", label: "Phone", type: "tel", inputMode: "tel", autoComplete: "tel", hint: "Optional. Used for WhatsApp." },
  { name: "company", label: "Company", autoComplete: "organization", hint: "Optional" },
  { name: "address", label: "Address", autoComplete: "street-address", hint: "Optional. Shown on invoices." },
];

export function ContactForm({
  slug,
  contactId,
  initial,
  submitLabel,
}: {
  slug: string;
  contactId: string | null;
  initial?: Partial<Values>;
  submitLabel: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveContact.bind(null, slug, contactId), {
    status: "idle",
  });
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};

  return (
    <form action={action} className="space-y-5" noValidate>
      {state.status === "error" && (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          {state.message}
        </p>
      )}
      {FIELDS.map((f) => {
        const err = errors[f.name];
        return (
          <div key={f.name} className="space-y-1.5">
            <label htmlFor={f.name} className="flex items-baseline justify-between text-sm font-medium">
              {f.label}
              {f.hint && <span className="text-xs font-normal text-muted-foreground">{f.hint}</span>}
            </label>
            <Input
              id={f.name}
              name={f.name}
              type={f.type ?? "text"}
              inputMode={f.inputMode}
              autoComplete={f.autoComplete}
              defaultValue={initial?.[f.name] ?? ""}
              required={f.name === "name"}
              autoFocus={f.name === "name" && !contactId}
              aria-invalid={!!err}
              aria-describedby={err ? `${f.name}-error` : undefined}
              className="h-12 text-base"
            />
            {err && (
              <p id={`${f.name}-error`} className="text-sm text-destructive">
                {err}
              </p>
            )}
          </div>
        );
      })}
      <Button type="submit" size="touch" className="w-full sm:w-auto" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
