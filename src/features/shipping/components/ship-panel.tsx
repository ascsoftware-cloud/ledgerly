"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileDown, Plus, Truck, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";
import { PROVINCES, type Rate } from "@/server/integrations/courier-guy";
import { bookShipment, quoteShipment, waybillLink } from "../actions";
import type { ShipmentView } from "../queries";

const field = "h-12 w-full rounded-xl border bg-background px-3 text-base";
const STATUS: Record<ShipmentView["status"], string> = {
  booking: "Booking…",
  booked: "Booked",
  in_transit: "On its way",
  delivered: "Delivered",
  cancelled: "Cancelled",
  failed: "Booking failed",
};

type Parcel = {
  submitted_length_cm: string;
  submitted_width_cm: string;
  submitted_height_cm: string;
  submitted_weight_kg: string;
};
const emptyParcel: Parcel = {
  submitted_length_cm: "",
  submitted_width_cm: "",
  submitted_height_cm: "",
  submitted_weight_kg: "",
};

function Shipments({ slug, list }: { slug: string; list: ShipmentView[] }) {
  const [pending, start] = useTransition();
  return (
    <ul className="divide-y text-sm">
      {list.map((s) => (
        <li key={s.id} className="space-y-1 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">
              {STATUS[s.status]} · {s.service_level_name ?? s.service_level_code}
              {s.tracking_ref && (
                <span className="text-muted-foreground"> · waybill {s.tracking_ref}</span>
              )}
            </p>
            <div className="flex items-center gap-2">
              {(s.charged_cents ?? s.quoted_cents) !== null && (
                <span className="tabular-nums">
                  {formatMoney((s.charged_cents ?? s.quoted_cents)!)}
                </span>
              )}
              {s.tracking_ref && s.status !== "failed" && (
                <Button
                  variant="ghost"
                  size="touch"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const url = await waybillLink(slug, s.id);
                      if (url) window.open(url, "_blank", "noopener,noreferrer");
                      else toast.error("The waybill isn't ready yet. Try again in a minute.");
                    })
                  }
                >
                  <FileDown className="size-4" aria-hidden /> Waybill
                </Button>
              )}
            </div>
          </div>
          {s.last_error && <p className="text-destructive">{s.last_error}</p>}
          {s.shipment_events[0] && (
            <p className="text-muted-foreground">
              {new Date(s.shipment_events[0].happened_at).toLocaleString("en-ZA")}:{" "}
              {s.shipment_events[0].message ?? s.shipment_events[0].status}
              {s.shipment_events[0].location ? `, ${s.shipment_events[0].location}` : ""}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Courier Guy on an invoice: quote, book, waybill, tracking. */
export function ShipPanel({
  slug,
  documentId,
  shipments,
  recipient,
  canBook,
  ready,
}: {
  slug: string;
  documentId: string;
  shipments: ShipmentView[];
  recipient: { name: string; email: string; mobile_number: string };
  canBook: boolean;
  ready: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [requestId, setRequestId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [rates, setRates] = useState<Rate[] | null>(null);
  const [chosen, setChosen] = useState<string>("");
  const [a, setA] = useState({
    type: "residential",
    company: "",
    street_address: "",
    local_area: "",
    city: "",
    zone: "Gauteng",
    code: "",
  });
  const [who, setWho] = useState(recipient);
  const [parcels, setParcels] = useState<Parcel[]>([{ ...emptyParcel }]);

  const input = () => ({
    delivery: {
      ...a,
      type: a.type as "residential" | "business",
      country: "ZA" as const,
      zone: a.zone as (typeof PROVINCES)[number],
    },
    recipient: who,
    // Strings are fine: the server coerces and validates them.
    parcels: parcels.map((p) => ({ ...p, parcel_description: "" })),
  });

  if (!shipments.length && !canBook) return null;

  const text = (k: keyof typeof a, label: string, extra: Record<string, string> = {}) => (
    <label className="space-y-1 text-sm font-medium">
      {label}
      <Input
        value={a[k]}
        onChange={(e) => {
          setA({ ...a, [k]: e.target.value });
          setRates(null);
        }}
        className="h-12 text-base"
        {...extra}
      />
    </label>
  );

  return (
    <section
      aria-labelledby="ship-heading"
      className="space-y-3 rounded-2xl border bg-card p-5 shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="ship-heading" className="flex items-center gap-2 font-semibold">
          <Truck className="size-5 text-primary" aria-hidden /> Courier
        </h2>
        {canBook && !open && (
          <Button
            variant="outline"
            size="touch"
            onClick={() => {
              setRequestId(crypto.randomUUID());
              setRates(null);
              setChosen("");
              setError(null);
              setOpen(true);
            }}
            disabled={!ready}
          >
            Book Courier Guy
          </Button>
        )}
      </div>
      {canBook && !ready && (
        <p className="text-sm text-muted-foreground">
          Add your collection address under{" "}
          <a href={`/${slug}/settings/integrations`} className="text-primary hover:underline">
            More → Apps
          </a>{" "}
          to book.
        </p>
      )}
      {shipments.length > 0 && <Shipments slug={slug} list={shipments} />}

      {open && (
        <div className="grid gap-3 border-t pt-4 sm:grid-cols-2">
          <h3 className="font-medium sm:col-span-2">Deliver to</h3>
          {text("street_address", "Street address")}
          {text("local_area", "Suburb")}
          {text("city", "Town or city")}
          <label className="space-y-1 text-sm font-medium">
            Province
            <select
              value={a.zone}
              onChange={(e) => {
                setA({ ...a, zone: e.target.value });
                setRates(null);
              }}
              className={field}
            >
              {PROVINCES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          {text("code", "Postal code", { inputMode: "numeric" })}
          <label className="space-y-1 text-sm font-medium">
            Address type
            <select
              value={a.type}
              onChange={(e) => {
                setA({ ...a, type: e.target.value });
                setRates(null);
              }}
              className={field}
            >
              <option value="residential">Home</option>
              <option value="business">Business</option>
            </select>
          </label>
          {a.type === "business" && text("company", "Business name")}
          <label className="space-y-1 text-sm font-medium">
            Recipient
            <Input
              value={who.name}
              onChange={(e) => setWho({ ...who, name: e.target.value })}
              className="h-12 text-base"
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            Recipient mobile
            <Input
              inputMode="tel"
              value={who.mobile_number}
              onChange={(e) => setWho({ ...who, mobile_number: e.target.value })}
              className="h-12 text-base"
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            Recipient email
            <Input
              type="email"
              value={who.email}
              onChange={(e) => setWho({ ...who, email: e.target.value })}
              className="h-12 text-base"
            />
          </label>

          <h3 className="font-medium sm:col-span-2">Parcels (cm and kg)</h3>
          {parcels.map((p, i) => (
            <fieldset key={i} className="grid grid-cols-4 gap-2 sm:col-span-2">
              <legend className="sr-only">Parcel {i + 1}</legend>
              {(
                [
                  "submitted_length_cm",
                  "submitted_width_cm",
                  "submitted_height_cm",
                  "submitted_weight_kg",
                ] as const
              ).map((k) => (
                <label key={k} className="space-y-1 text-xs font-medium">
                  {
                    {
                      submitted_length_cm: "Length",
                      submitted_width_cm: "Width",
                      submitted_height_cm: "Height",
                      submitted_weight_kg: "Weight",
                    }[k]
                  }
                  <Input
                    inputMode="decimal"
                    value={p[k]}
                    onChange={(e) => {
                      const next = [...parcels];
                      next[i] = { ...p, [k]: e.target.value.replace(",", ".") };
                      setParcels(next);
                      setRates(null);
                    }}
                    className="h-11 text-base"
                  />
                </label>
              ))}
            </fieldset>
          ))}
          <div className="flex gap-2 sm:col-span-2">
            {parcels.length < 20 && (
              <Button
                variant="ghost"
                size="touch"
                onClick={() => {
                  setParcels([...parcels, { ...emptyParcel }]);
                  setRates(null);
                }}
              >
                <Plus className="size-4" aria-hidden /> Add a parcel
              </Button>
            )}
            {parcels.length > 1 && (
              <Button
                variant="ghost"
                size="touch"
                onClick={() => {
                  setParcels(parcels.slice(0, -1));
                  setRates(null);
                }}
              >
                <X className="size-4" aria-hidden /> Remove last
              </Button>
            )}
          </div>

          {rates && (
            <fieldset className="space-y-2 sm:col-span-2">
              <legend className="font-medium">Choose a service</legend>
              {rates.map((r) => (
                <label
                  key={r.code}
                  className="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl border px-4 py-2 has-[:checked]:border-primary"
                >
                  <span className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="rate"
                      value={r.code}
                      checked={chosen === r.code}
                      onChange={() => setChosen(r.code)}
                    />
                    {r.name}
                    {r.deliveryTo && (
                      <span className="text-sm text-muted-foreground">
                        by {new Date(r.deliveryTo).toLocaleDateString("en-ZA")}
                      </span>
                    )}
                  </span>
                  <span className="font-medium tabular-nums">{formatMoney(r.cents)}</span>
                </label>
              ))}
              <p className="text-xs text-muted-foreground">
                Prices include VAT and are charged to your Courier Guy account.
              </p>
            </fieldset>
          )}

          <div className="flex flex-wrap gap-2 sm:col-span-2">
            {!rates ? (
              <Button
                size="touch"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const r = await quoteShipment(slug, input());
                    if (r.ok) {
                      // A new quote is a new booking intent; pressing Book twice reuses this id.
                      setRequestId(crypto.randomUUID());
                      setRates(r.rates);
                      setChosen(r.rates[0]?.code ?? "");
                    } else setError(r.message);
                  })
                }
              >
                {pending ? "Getting prices…" : "Get prices"}
              </Button>
            ) : (
              <Button
                size="touch"
                disabled={pending || !chosen}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const rate = rates.find((r) => r.code === chosen);
                    if (!rate) return;
                    const r = await bookShipment(slug, documentId, requestId, input(), {
                      code: rate.code,
                      name: rate.name,
                      cents: rate.cents,
                    });
                    if (r.ok) {
                      toast.success(r.message);
                      setOpen(false);
                      router.refresh();
                    } else {
                      setError(r.message);
                      setRates(null);
                      router.refresh();
                    }
                  })
                }
              >
                {pending ? "Booking…" : "Book collection"}
              </Button>
            )}
            <Button variant="ghost" size="touch" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive sm:col-span-2">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
