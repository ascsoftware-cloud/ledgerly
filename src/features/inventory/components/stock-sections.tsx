import Link from "next/link";

const SECTIONS = [
  { key: "products", label: "Products", path: "" },
  { key: "suppliers", label: "Suppliers", path: "/suppliers" },
  { key: "orders", label: "Orders", path: "/orders" },
] as const;

/** Products, the people you buy from, and what you have ordered from them. */
export function StockSections({ slug, current }: { slug: string; current: (typeof SECTIONS)[number]["key"] }) {
  return (
    <nav aria-label="Stock sections" className="inline-flex rounded-xl bg-muted p-1">
      {SECTIONS.map((s) => (
        <Link
          key={s.key}
          href={`/${slug}/stock${s.path}`}
          aria-current={current === s.key ? "page" : undefined}
          className="flex h-11 items-center rounded-lg px-4 text-sm font-medium text-muted-foreground hover:text-foreground aria-[current=page]:bg-card aria-[current=page]:text-foreground aria-[current=page]:shadow-card"
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );
}
