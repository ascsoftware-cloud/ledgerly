"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addOrderLine, createPurchaseOrder, deleteOrder, receiveOrder, removeOrderLine, setOrderStatus, type FormResult } from "../actions";

/** Start an order: who from, when you expect it. Products are added on the next screen. */
export function NewOrderForm({ slug, suppliers }: { slug: string; suppliers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<FormResult, FormData>(async (prev, form) => {
    const r = await createPurchaseOrder(slug, prev, form);
    if (r.status === "saved") {
      toast.success(r.message);
      router.push(`/${slug}/stock/orders/${r.id}`);
    }
    return r;
  }, { status: "idle" });
  const field = "h-12 w-full rounded-xl border bg-background px-3 text-base";
  return (
    <form action={action} noValidate aria-label="New purchase order" className="grid gap-4 rounded-2xl border bg-card p-5 shadow-card sm:grid-cols-2">
      <label className="space-y-1 text-sm font-medium">
        Supplier
        <select name="supplierId" defaultValue="" className={field}>
          <option value="">Choose…</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm font-medium">
        Expected on <span className="font-normal text-muted-foreground">(optional)</span>
        <Input name="expectedOn" inputMode="numeric" placeholder="31/01/2027" className="h-12 text-base" />
      </label>
      <label className="space-y-1 text-sm font-medium sm:col-span-2">
        Notes <span className="font-normal text-muted-foreground">(optional)</span>
        <textarea name="notes" rows={2} maxLength={1000} className="w-full rounded-xl border bg-background p-3 text-base" />
      </label>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {state.message}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="touch" disabled={pending}>
          {pending ? "Starting…" : "Start order"}
        </Button>
        <Button type="button" variant="ghost" size="touch" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function AddOrderLine({ slug, orderId, products }: { slug: string; orderId: string; products: { id: string; name: string; costCents: number }[] }) {
  const router = useRouter();
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [state, action, pending] = useActionState<FormResult, FormData>(async (prev, form) => {
    const r = await addOrderLine(slug, orderId, prev, form);
    if (r.status === "saved") {
      setProductId("");
      setQuantity("");
      setUnitCost("");
      router.refresh();
    }
    return r;
  }, { status: "idle" });
  const field = "h-12 w-full rounded-xl border bg-background px-3 text-base";
  return (
    <form action={action} noValidate aria-label="Add a product to the order" className="grid gap-3 rounded-2xl border bg-card p-5 shadow-card sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
      <label className="space-y-1 text-sm font-medium">
        Product
        <select
          name="productId"
          value={productId}
          onChange={(e) => {
            setProductId(e.target.value);
            const p = products.find((x) => x.id === e.target.value);
            if (p && !unitCost) setUnitCost((p.costCents / 100).toFixed(2).replace(".", ","));
          }}
          className={field}
        >
          <option value="">Choose…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm font-medium">
        How many
        <Input name="quantity" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="h-12 text-base" />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Cost each (R)
        <Input name="unitCost" inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} className="h-12 text-base" />
      </label>
      <Button type="submit" size="touch" disabled={pending}>
        {pending ? "Adding…" : "Add"}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive sm:col-span-4">
          {state.message}
        </p>
      )}
    </form>
  );
}

export function RemoveOrderLine({ slug, lineId, name }: { slug: string; lineId: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="touch"
      disabled={pending}
      aria-label={`Remove ${name}`}
      onClick={() =>
        start(async () => {
          const r = await removeOrderLine(slug, lineId);
          if (!r.ok) return void toast.error(r.message ?? "Couldn't remove that.");
          router.refresh();
        })
      }
    >
      Remove
    </Button>
  );
}

/** What can be done with the order right now, depending on where it is. */
export function OrderActions({ slug, orderId, status, hasLines }: { slug: string; orderId: string; status: "draft" | "sent" | "received" | "cancelled"; hasLines: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [updateCost, setUpdateCost] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, done: string, then?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.message ?? "Couldn't do that. Try again.");
      toast.success(done);
      if (then) then();
      else router.refresh();
    });

  if (status === "received" || status === "cancelled") return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "draft" && (
        <Button type="button" size="touch" disabled={pending || !hasLines} onClick={() => run(() => setOrderStatus(slug, orderId, "sent"), "Marked as sent")}>
          Mark as sent
        </Button>
      )}
      <Button type="button" size="touch" variant={status === "sent" ? "default" : "outline"} disabled={pending || !hasLines} onClick={() => run(() => receiveOrder(slug, orderId, updateCost), "Stock updated")}>
        Receive the goods
      </Button>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} className="size-5 accent-primary" />
        Update product costs
      </label>
      <Button type="button" variant="ghost" size="touch" disabled={pending} onClick={() => run(() => setOrderStatus(slug, orderId, "cancelled"), "Order cancelled")}>
        Cancel order
      </Button>
      {status === "draft" &&
        (confirmDelete ? (
          <span className="flex gap-1">
            <Button type="button" variant="destructive" size="touch" disabled={pending} onClick={() => run(() => deleteOrder(slug, orderId), "Order deleted", () => router.push(`/${slug}/stock/orders`))}>
              Yes, delete it
            </Button>
            <Button type="button" variant="ghost" size="touch" onClick={() => setConfirmDelete(false)}>
              Keep
            </Button>
          </span>
        ) : (
          <Button type="button" variant="ghost" size="touch" onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        ))}
    </div>
  );
}
