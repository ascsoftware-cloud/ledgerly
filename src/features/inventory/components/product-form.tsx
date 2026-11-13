"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveProduct, type FormResult } from "../actions";

export type ProductInitial = {
  name: string;
  sku: string;
  kind: "product" | "service";
  cost: string;
  price: string;
  vat: "0" | "15";
  trackStock: boolean;
  reorderLevel: string;
  supplierId: string;
};

const EMPTY: ProductInitial = { name: "", sku: "", kind: "product", cost: "", price: "", vat: "0", trackStock: false, reorderLevel: "", supplierId: "" };

/** Add or edit a product or service. Opening stock is asked only when adding. */
export function ProductForm({
  slug,
  productId = null,
  suppliers,
  initial,
  vatRegistered,
}: {
  slug: string;
  productId?: string | null;
  suppliers: { id: string; name: string }[];
  initial?: ProductInitial;
  vatRegistered: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState<ProductInitial>(initial ?? { ...EMPTY, vat: vatRegistered ? "15" : "0" });
  const [opening, setOpening] = useState("");
  const set = (k: keyof ProductInitial) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV({ ...v, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  const isProduct = v.kind === "product";

  const [state, action, pending] = useActionState<FormResult, FormData>(async (prev, form) => {
    const r = await saveProduct(slug, productId, prev, form);
    if (r.status === "saved") {
      toast.success(r.message);
      router.push(productId ? `/${slug}/stock` : `/${slug}/stock/${r.id}`);
    }
    return r;
  }, { status: "idle" });

  const field = "h-12 w-full rounded-xl border bg-background px-3 text-base";
  return (
    <form action={action} noValidate aria-label={productId ? "Edit product" : "Add a product"} className="grid gap-4 rounded-2xl border bg-card p-5 shadow-card sm:grid-cols-2">
      <label className="space-y-1 text-sm font-medium sm:col-span-2">
        Name
        <Input name="name" value={v.name} onChange={set("name")} placeholder="Floor tile, haircut, consulting hour…" className="h-12 text-base" autoFocus={!productId} />
      </label>
      <label className="space-y-1 text-sm font-medium">
        This is a
        <select name="kind" value={v.kind} onChange={set("kind")} className={field}>
          <option value="product">Product (something you stock)</option>
          <option value="service">Service (no stock)</option>
        </select>
      </label>
      <label className="space-y-1 text-sm font-medium">
        SKU or code <span className="font-normal text-muted-foreground">(optional)</span>
        <Input name="sku" value={v.sku} onChange={set("sku")} className="h-12 text-base" />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Selling price (R)
        <Input name="price" inputMode="decimal" value={v.price} onChange={set("price")} placeholder="95,00" className="h-12 text-base" />
      </label>
      <label className="space-y-1 text-sm font-medium">
        What it costs you (R) <span className="font-normal text-muted-foreground">(optional)</span>
        <Input name="cost" inputMode="decimal" value={v.cost} onChange={set("cost")} placeholder="60,00" className="h-12 text-base" />
      </label>
      <label className="space-y-1 text-sm font-medium">
        VAT on invoices
        <select name="vat" value={v.vat} onChange={set("vat")} className={field}>
          <option value="0">No VAT</option>
          <option value="15">15% VAT</option>
        </select>
      </label>
      {suppliers.length > 0 && (
        <label className="space-y-1 text-sm font-medium">
          Usual supplier <span className="font-normal text-muted-foreground">(optional)</span>
          <select name="supplierId" value={v.supplierId} onChange={set("supplierId")} className={field}>
            <option value="">None</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {isProduct && (
        <>
          <label className="flex items-center gap-3 text-sm font-medium sm:col-span-2">
            <input type="checkbox" name="trackStock" checked={v.trackStock} onChange={set("trackStock")} className="size-5 accent-primary" />
            Keep count of how many I have
          </label>
          {v.trackStock && (
            <>
              <label className="space-y-1 text-sm font-medium">
                Warn me when I am down to <span className="font-normal text-muted-foreground">(re-order level)</span>
                <Input name="reorderLevel" inputMode="decimal" value={v.reorderLevel} onChange={set("reorderLevel")} placeholder="5" className="h-12 text-base" />
              </label>
              {!productId && (
                <label className="space-y-1 text-sm font-medium">
                  How many do you have now?
                  <Input name="openingStock" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="12" className="h-12 text-base" />
                </label>
              )}
            </>
          )}
        </>
      )}
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {state.message}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="touch" disabled={pending}>
          {pending ? "Saving…" : productId ? "Save changes" : "Add product"}
        </Button>
        <Button type="button" variant="ghost" size="touch" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
