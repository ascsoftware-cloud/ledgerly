import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

const PAGES: { path: string; priority: number }[] = [
  { path: "/", priority: 1 },
  { path: "/pricing", priority: 0.8 },
  { path: "/start", priority: 0.6 },
  { path: "/privacy", priority: 0.3 },
  { path: "/terms", priority: 0.3 },
  { path: "/popia", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return PAGES.map((p) => ({ url: `${base}${p.path === "/" ? "" : p.path}`, changeFrequency: "monthly", priority: p.priority }));
}
