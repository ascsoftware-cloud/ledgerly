import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AlertTriangle, ExternalLink, ShoppingBag } from "lucide-react";
import { EmptyState } from "@/components/states/empty-state";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { RefreshButton } from "@/features/shop/components/refresh-button";
import { formatShopMoney, salesByDay, statusWords } from "@/features/shop/format";
import {
  getShop,
  listOrders,
  listProducts,
  lowStock,
  stockByLocation,
} from "@/features/shop/queries";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Shop", robots: { index: false } };

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "products", label: "Products" },
  { key: "orders", label: "Orders" },
  { key: "stock", label: "Stock" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default function ShopPage({ params, searchParams }: PageProps<"/[ws]/shop">) {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <Shop params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const card = "rounded-2xl border bg-card p-5 shadow-card";

async function Shop({
  params,
  searchParams,
}: {
  params: PageProps<"/[ws]/shop">["params"];
  searchParams: PageProps<"/[ws]/shop">["searchParams"];
}) {
  const { ws } = await params;
  const sp = await searchParams;
  const ctx = await requireWorkspace(ws);
  const shop = await getShop(ctx);
  const manager = ctx.role === "owner" || ctx.role === "admin";

  if (!shop) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Shop</h1>
        <EmptyState
          icon={ShoppingBag}
          title="No Shopify store connected"
          body={
            manager
              ? "Connect your Shopify store to see products, stock and orders here."
              : "Ask an owner or admin to connect the Shopify store."
          }
          action={
            manager
              ? { label: "Connect Shopify", href: `/${ws}/settings/integrations` }
              : { label: "Back to home", href: `/${ws}` }
          }
        />
      </div>
    );
  }

  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "overview";
  const q = typeof sp.q === "string" ? sp.q : "";
  const money = (n: number) => formatShopMoney(n, shop.currency);
  const admin = `https://${shop.domain}/admin`;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Shop</h1>
          <p className="text-sm text-muted-foreground">
            {shop.name} ·{" "}
            {shop.syncing
              ? "refreshing from Shopify…"
              : shop.lastSync
                ? `updated ${new Date(shop.lastSync).toLocaleString("en-ZA")}`
                : "first refresh pending"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {manager && <RefreshButton slug={ws} />}
          <a
            href={admin}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center gap-1 px-3 text-sm text-muted-foreground hover:text-primary"
          >
            Shopify admin <ExternalLink className="size-4" aria-hidden />
          </a>
        </div>
      </header>

      {shop.status === "needs_reauth" && (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-xl bg-destructive/10 px-4 py-3 text-sm"
        >
          <AlertTriangle className="size-4 text-destructive" aria-hidden /> Shopify needs
          reconnecting. What you see may be out of date.
        </p>
      )}

      <nav
        aria-label="Shop sections"
        className="flex gap-1 overflow-x-auto rounded-xl bg-muted p-1"
      >
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/${ws}/shop${t.key === "overview" ? "" : `?tab=${t.key}`}`}
            aria-current={tab === t.key ? "page" : undefined}
            className="flex h-10 items-center rounded-lg px-4 text-sm font-medium text-muted-foreground aria-[current=page]:bg-card aria-[current=page]:text-foreground aria-[current=page]:shadow-card"
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <Overview
          ws={ws}
          ctx={ctx}
          shopId={shop.id}
          lowAt={shop.lowStock}
          money={money}
          admin={admin}
        />
      )}
      {tab === "products" && <Products ws={ws} ctx={ctx} shopId={shop.id} q={q} money={money} />}
      {tab === "orders" && <Orders ctx={ctx} shopId={shop.id} money={money} admin={admin} />}
      {tab === "stock" && <Stock ctx={ctx} shopId={shop.id} lowAt={shop.lowStock} />}
    </div>
  );
}

type Ctx = Awaited<ReturnType<typeof requireWorkspace>>;

async function Overview({
  ws,
  ctx,
  shopId,
  lowAt,
  money,
  admin,
}: {
  ws: string;
  ctx: Ctx;
  shopId: string;
  lowAt: number;
  money: (n: number) => string;
  admin: string;
}) {
  const [orders, low, products] = await Promise.all([
    listOrders(ctx, shopId, { sinceDays: 30, limit: 2000 }),
    lowStock(ctx, shopId, lowAt),
    listProducts(ctx, shopId, ""),
  ]);
  const live = orders.filter((o) => !o.cancelled_at);
  const days = salesByDay(orders, 14);
  const peak = Math.max(1, ...days.map((d) => d.total));
  const unfulfilled = live.filter(
    (o) => o.fulfillment_status && o.fulfillment_status !== "FULFILLED",
  ).length;

  const stat = (label: string, value: string, href?: string) => (
    <div className={card}>
      <p className="text-sm text-muted-foreground">{label}</p>
      {href ? (
        <Link href={href} className="text-2xl font-semibold tabular-nums hover:text-primary">
          {value}
        </Link>
      ) : (
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stat("Sales, last 30 days", money(live.reduce((s, o) => s + o.total, 0)))}
        {stat("Orders, last 30 days", String(live.length), `/${ws}/shop?tab=orders`)}
        {stat("Waiting to ship", String(unfulfilled), `/${ws}/shop?tab=orders`)}
        {stat(`Low stock (≤ ${lowAt})`, String(low.length), `/${ws}/shop?tab=stock`)}
      </div>

      <section aria-labelledby="sales-heading" className={card}>
        <h2 id="sales-heading" className="font-semibold">
          Sales by day
        </h2>
        <p className="text-sm text-muted-foreground">Last 14 days, cancelled orders left out.</p>
        <ol className="mt-4 space-y-2">
          {days.map((d) => (
            <li key={d.day} className="grid grid-cols-[5.5rem_1fr_7rem] items-center gap-3 text-sm">
              <span className="text-muted-foreground tabular-nums">
                {d.day.slice(5).replace("-", "/")}
              </span>
              <span className="h-3 rounded-full bg-muted" aria-hidden>
                <span
                  className="block h-3 rounded-full bg-primary"
                  style={{ width: `${Math.round((d.total / peak) * 100)}%` }}
                />
              </span>
              <span className="text-right tabular-nums">
                {money(d.total)}
                <span className="sr-only">, {d.count} orders</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="low-heading" className={card}>
          <h2 id="low-heading" className="font-semibold">
            Running low
          </h2>
          {low.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Nothing at or below {lowAt}.</p>
          ) : (
            <ul className="mt-2 divide-y text-sm">
              {low.slice(0, 8).map((v, i) => (
                <li key={`${v.product}-${v.sku}-${i}`} className="flex justify-between gap-3 py-2">
                  <span>
                    {v.product}
                    {v.variant ? (
                      <span className="text-muted-foreground"> · {v.variant}</span>
                    ) : null}
                  </span>
                  <span
                    className={`font-medium tabular-nums ${v.quantity <= 0 ? "text-destructive" : ""}`}
                  >
                    {v.quantity}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="recent-heading" className={card}>
          <h2 id="recent-heading" className="font-semibold">
            Latest orders
          </h2>
          {orders.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No orders in the last 30 days.</p>
          ) : (
            <ul className="mt-2 divide-y text-sm">
              {orders.slice(0, 8).map((o) => (
                <li key={o.id} className="flex justify-between gap-3 py-2">
                  <a
                    href={`${admin}/orders/${o.id.split("/").pop()}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-primary"
                  >
                    {o.name}{" "}
                    <span className="text-muted-foreground">
                      · {statusWords(o.fulfillment_status)}
                    </span>
                  </a>
                  <span
                    className={`tabular-nums ${o.cancelled_at ? "text-muted-foreground line-through" : "font-medium"}`}
                  >
                    {money(o.total)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <p className="text-sm text-muted-foreground">{products.length} products in the store copy.</p>
    </div>
  );
}

async function Products({
  ws,
  ctx,
  shopId,
  q,
  money,
}: {
  ws: string;
  ctx: Ctx;
  shopId: string;
  q: string;
  money: (n: number) => string;
}) {
  const products = await listProducts(ctx, shopId, q);
  return (
    <div className="space-y-4">
      <form action={`/${ws}/shop`} className="flex gap-2">
        <input type="hidden" name="tab" value="products" />
        <input
          name="q"
          defaultValue={q}
          placeholder="Search products"
          aria-label="Search products"
          className="h-12 w-full max-w-md rounded-xl border bg-background px-3 text-base"
        />
      </form>
      {products.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {q ? "No products match." : "No products yet. The first refresh may still be running."}
        </p>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card shadow-card">
          {products.map((p) => (
            <li key={p.id} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {p.title}
                  {p.status && p.status !== "ACTIVE" && (
                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">
                      {statusWords(p.status)}
                    </span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {p.total_inventory ?? 0} in stock
                </p>
              </div>
              {p.shopify_variants.length > 1 ||
              (p.shopify_variants[0]?.title && p.shopify_variants[0].title !== "Default Title") ? (
                <ul className="grid gap-1 text-sm sm:grid-cols-2">
                  {p.shopify_variants.map((v) => (
                    <li
                      key={v.id}
                      className="flex justify-between gap-3 rounded-lg bg-muted/50 px-3 py-1.5"
                    >
                      <span>
                        {v.title}
                        {v.sku && <span className="text-muted-foreground"> · {v.sku}</span>}
                      </span>
                      <span className="tabular-nums">
                        {v.price !== null ? money(v.price) : "—"} · {v.inventory_quantity ?? 0}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground tabular-nums">
                  {p.shopify_variants[0]?.sku ? `${p.shopify_variants[0].sku} · ` : ""}
                  {p.shopify_variants[0]?.price != null ? money(p.shopify_variants[0].price) : ""}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function Orders({
  ctx,
  shopId,
  money,
  admin,
}: {
  ctx: Ctx;
  shopId: string;
  money: (n: number) => string;
  admin: string;
}) {
  const orders = await listOrders(ctx, shopId, { limit: 100 });
  if (!orders.length)
    return <p className="text-sm text-muted-foreground">No orders in the store copy yet.</p>;
  return (
    <div className="overflow-x-auto rounded-2xl border bg-card shadow-card">
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="p-3 font-medium">Order</th>
            <th className="p-3 font-medium">Date</th>
            <th className="p-3 font-medium">Payment</th>
            <th className="p-3 font-medium">Shipping</th>
            <th className="p-3 text-right font-medium">Items</th>
            <th className="p-3 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {orders.map((o) => (
            <tr key={o.id} className={o.cancelled_at ? "text-muted-foreground" : ""}>
              <td className="p-3">
                <a
                  href={`${admin}/orders/${o.id.split("/").pop()}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium hover:text-primary"
                >
                  {o.name}
                </a>
                {o.cancelled_at && <span className="ml-2 text-xs">Cancelled</span>}
              </td>
              <td className="p-3 tabular-nums">
                {new Date(o.shop_created_at).toLocaleDateString("en-ZA")}
              </td>
              <td className="p-3">{statusWords(o.financial_status)}</td>
              <td className="p-3">{statusWords(o.fulfillment_status)}</td>
              <td className="p-3 text-right tabular-nums">{o.item_count ?? "—"}</td>
              <td className="p-3 text-right tabular-nums">{money(o.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="p-3 text-xs text-muted-foreground">
        Customer details stay in Shopify. Open an order there to see them.
      </p>
    </div>
  );
}

async function Stock({ ctx, shopId, lowAt }: { ctx: Ctx; shopId: string; lowAt: number }) {
  const rows = await stockByLocation(ctx, shopId);
  if (!rows.length)
    return (
      <p className="text-sm text-muted-foreground">
        No stock levels yet. The first refresh may still be running.
      </p>
    );
  const locations = [...new Set(rows.map((r) => r.location))];
  return (
    <div className="space-y-6">
      {locations.map((loc) => (
        <section key={loc} aria-label={loc} className={card}>
          <h2 className="font-semibold">{loc}</h2>
          <ul className="mt-2 divide-y text-sm">
            {rows
              .filter((r) => r.location === loc)
              .map((r, i) => (
                <li key={`${r.product}-${r.sku}-${i}`} className="flex justify-between gap-3 py-2">
                  <span>
                    {r.product}
                    {r.variant && <span className="text-muted-foreground"> · {r.variant}</span>}
                    {r.sku && <span className="text-muted-foreground"> · {r.sku}</span>}
                  </span>
                  <span
                    className={`tabular-nums ${r.available <= lowAt ? "font-semibold text-destructive" : ""}`}
                  >
                    {r.available}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
