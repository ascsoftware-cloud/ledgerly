"use client";

import { useState, useTransition } from "react";
import { CreditCard, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { payOnline } from "../public-actions";

const LABEL = { yoco: "Pay by card (Yoco)", payfast: "Pay with PayFast", stitch: "Pay from your bank (Stitch)" } as const;
type Provider = keyof typeof LABEL;

/** Hands the payer to the business's own Yoco, PayFast or Stitch checkout. No card or bank details touch Ledgerly. */
export function PayButtons({ token, providers }: { token: string; providers: Provider[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function pay(provider: Provider) {
    setError(null);
    start(async () => {
      const r = await payOnline(token, provider);
      if (!r.ok) {
        setError(r.message);
        return;
      }
      if (r.kind === "redirect") {
        window.location.assign(r.url);
        return;
      }
      // PayFast expects a form POST to its hosted page.
      const form = document.createElement("form");
      form.method = "POST";
      form.action = r.action;
      for (const [name, value] of r.fields) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {providers.map((p) => (
          <Button key={p} size="touch" disabled={pending} onClick={() => pay(p)}>
            {p === "stitch" ? <Landmark className="size-5" aria-hidden /> : <CreditCard className="size-5" aria-hidden />}{" "}
            {pending ? "Opening…" : LABEL[p]}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
